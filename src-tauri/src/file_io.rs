//! 打开与保存（SPEC F1.1、§4.1、ADR-08）。
//!
//! 保存流程的顺序不是风格问题而是正确性问题：任何一步换位置，
//! 断电或 kill -9 都可能留下一个被截断的原文件。见 `save_atomic`。

use crate::constants;
use crate::error::{path_hint, AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs::{File, Metadata};
use std::io::Write;
use std::path::{Path, PathBuf};

/// 文件指纹，用于外部变更检测（SPEC F1.5）。
/// 带 inode 才能识别「文件被替换而非被修改」——`git checkout`、
/// 构建产物覆盖都是这个形态，只看 mtime 会漏判。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub size: u64,
    /// Unix epoch 毫秒；取不到时为 0
    pub mtime_ms: i64,
    pub inode: u64,
}

impl FileFingerprint {
    pub fn from_metadata(metadata: &Metadata) -> Self {
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        Self {
            size: metadata.len(),
            mtime_ms,
            inode: inode_of(metadata),
        }
    }

    pub fn read(path: &Path) -> AppResult<Self> {
        let metadata = std::fs::metadata(path).map_err(|error| AppError::from_io(&error, path))?;
        Ok(Self::from_metadata(&metadata))
    }
}

#[cfg(unix)]
fn inode_of(metadata: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.ino()
}

#[cfg(windows)]
fn inode_of(metadata: &Metadata) -> u64 {
    use std::os::windows::fs::MetadataExt;
    // Windows 上 file_index 需要打开句柄才拿得到；元数据里可用的近似量是
    // 创建时间，它在「文件被替换」时同样会变，足以满足 F1.5 的判别需求。
    metadata.creation_time()
}

/// 打开文件时的校验结果。二进制探测与档位判定都在这里完成，
/// 前端拿到它才决定用哪种加载策略（SPEC §4.1）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPlan {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub fingerprint: FileFingerprint,
    /// 前 8 KiB 含 NUL 字节即疑似二进制（SPEC F1.1）
    pub looks_binary: bool,
    pub read_only: bool,
}

/// 规范化并校验路径（SPEC §10.4）。
///
/// 默认**不跟随符号链接**：`symlink_metadata` 先判类型，是链接就拒绝。
/// 否则一个指向 `/etc/shadow` 的链接就能绕过作用域校验。
pub fn resolve_path(path: &Path, follow_symlinks: bool) -> AppResult<PathBuf> {
    let link_metadata =
        std::fs::symlink_metadata(path).map_err(|error| AppError::from_io(&error, path))?;

    if link_metadata.file_type().is_symlink() && !follow_symlinks {
        return Err(AppError::PermissionDenied {
            path_hint: path_hint(path),
        });
    }

    let canonical = std::fs::canonicalize(path).map_err(|error| AppError::from_io(&error, path))?;
    let metadata =
        std::fs::metadata(&canonical).map_err(|error| AppError::from_io(&error, &canonical))?;
    if metadata.is_dir() {
        return Err(AppError::IsDirectory {
            path_hint: path_hint(&canonical),
        });
    }
    Ok(canonical)
}

/// 只读前 8 KiB 做二进制探测，避免为了一个判断把 1 GB 文件读进内存。
fn sniff_binary(path: &Path) -> AppResult<bool> {
    use std::io::Read;
    let mut file = File::open(path).map_err(|error| AppError::from_io(&error, path))?;
    let mut buffer = vec![0u8; constants::BINARY_DETECT_SAMPLE];
    let read = file
        .read(&mut buffer)
        .map_err(|error| AppError::from_io(&error, path))?;
    Ok(buffer[..read].contains(&0))
}

/// 打开前的体检：规范化、判目录、判大小、判二进制。
/// 不读正文——正文按档位由调用方决定怎么读。
pub fn plan_open(path: &Path) -> AppResult<OpenPlan> {
    let canonical = resolve_path(path, false)?;
    let metadata =
        std::fs::metadata(&canonical).map_err(|error| AppError::from_io(&error, &canonical))?;
    let size_bytes = metadata.len();

    if size_bytes > constants::MAX_OPEN_BYTES {
        return Err(AppError::FileTooLarge {
            size_bytes,
            limit_bytes: constants::MAX_OPEN_BYTES,
        });
    }

    Ok(OpenPlan {
        looks_binary: sniff_binary(&canonical)?,
        read_only: metadata.permissions().readonly(),
        fingerprint: FileFingerprint::from_metadata(&metadata),
        size_bytes,
        path: canonical,
    })
}

/// 保存冲突的处理方式（SPEC F1.1 三分支）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// 磁盘上有变更就报错，交给 UI 去问用户
    Abort,
    /// 用户已确认覆盖
    Overwrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub fingerprint: FileFingerprint,
    pub bytes_written: u64,
}

/// 保存前的磁盘空间预检（SPEC F1.1 第 4 条）：
/// **写不下就不要开始写**，否则会留下一个半截的临时文件加一个满的磁盘。
fn check_disk_space(directory: &Path, needed: u64) -> AppResult<()> {
    let available = match available_space(directory) {
        Some(available) => available,
        // 取不到可用空间不该阻止保存，让真正的写入去报错
        None => return Ok(()),
    };
    // 留 20% 余量：临时文件与原文件会同时存在
    let required = needed.saturating_add(needed / 5);
    if available < required {
        return Err(AppError::DiskFull);
    }
    Ok(())
}

fn available_space(directory: &Path) -> Option<u64> {
    fs4::available_space(directory).ok()
}

/// 原子保存（SPEC ADR-08）。**步骤顺序不可调整**：
///
/// 1. 同目录建临时文件——跨目录 rename 不是原子的，还会跨设备失败；
/// 2. 写入并 `sync_all()`——不 fsync 就 rename，掉电后可能得到一个长度正确但内容全零的文件；
/// 3. `persist()`（rename 覆盖）——这一步才是原子的分界点；
/// 4. 父目录 fsync（Unix）——让目录项本身落盘，否则 rename 也可能丢。
pub fn save_atomic(
    path: &Path,
    bytes: &[u8],
    expected: Option<FileFingerprint>,
    policy: ConflictPolicy,
) -> AppResult<SaveOutcome> {
    let directory = path.parent().unwrap_or_else(|| Path::new("."));

    if policy == ConflictPolicy::Abort {
        if let (Some(expected), Ok(current)) = (expected, FileFingerprint::read(path)) {
            if current != expected {
                // 用版本冲突表达「磁盘上的文件已经不是你打开的那个」，
                // UI 据此弹三分支：覆盖 / 重新加载 / 另存
                return Err(AppError::VersionConflict {
                    expected: expected.mtime_ms.unsigned_abs(),
                    actual: current.mtime_ms.unsigned_abs(),
                });
            }
        }
    }

    check_disk_space(directory, bytes.len() as u64)?;

    let original_metadata = std::fs::metadata(path).ok();
    let original_permissions = original_metadata
        .as_ref()
        .map(std::fs::Metadata::permissions);

    let mut temp = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| AppError::from_io(&error, path))?;
    temp.write_all(bytes)
        .map_err(|error| AppError::from_io(&error, path))?;
    temp.as_file()
        .sync_all()
        .map_err(|error| AppError::from_io(&error, path))?;

    // 权限要在 persist 之前设好，否则会有一小段窗口期文件是 0600
    if let Some(permissions) = original_permissions.clone() {
        let _ = temp.as_file().set_permissions(permissions);
    }
    if let Some(metadata) = original_metadata.as_ref() {
        preserve_owner(temp.as_file(), metadata, path)?;
    }

    temp.persist(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::StorageFull {
            AppError::DiskFull
        } else {
            AppError::from_io(&error.error, path)
        }
    })?;

    sync_directory(directory);

    Ok(SaveOutcome {
        fingerprint: FileFingerprint::read(path)?,
        bytes_written: bytes.len() as u64,
    })
}

/// 流式原子写入：与 `save_atomic` 保持相同的临时文件、fsync、权限和 rename 语义，
/// 但正文由回调分块写入，内存不会随目标文件大小增长。
pub fn save_atomic_stream(
    path: &Path,
    expected_size: u64,
    write_content: impl FnOnce(&mut File) -> AppResult<u64>,
) -> AppResult<SaveOutcome> {
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    check_disk_space(directory, expected_size)?;

    let original_metadata = std::fs::metadata(path).ok();
    let original_permissions = original_metadata
        .as_ref()
        .map(std::fs::Metadata::permissions);
    let mut temp = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| AppError::from_io(&error, path))?;
    let bytes_written = write_content(temp.as_file_mut())?;
    temp.as_file()
        .sync_all()
        .map_err(|error| AppError::from_io(&error, path))?;

    if let Some(permissions) = original_permissions {
        let _ = temp.as_file().set_permissions(permissions);
    }
    if let Some(metadata) = original_metadata.as_ref() {
        preserve_owner(temp.as_file(), metadata, path)?;
    }
    temp.persist(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::StorageFull {
            AppError::DiskFull
        } else {
            AppError::from_io(&error.error, path)
        }
    })?;
    sync_directory(directory);

    Ok(SaveOutcome {
        fingerprint: FileFingerprint::read(path)?,
        bytes_written,
    })
}

#[cfg(unix)]
fn sync_directory(directory: &Path) {
    // 目录 fsync 失败不该让一次成功的保存被报成失败，最坏是掉电时丢目录项
    if let Ok(handle) = File::open(directory) {
        let _ = handle.sync_all();
    }
}

#[cfg(unix)]
fn preserve_owner(temp: &File, original: &Metadata, path: &Path) -> AppResult<()> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    // `persist` 前在临时 inode 上设置属主，避免 rename 后出现属主短暂错误的窗口。
    // 保存无权保留属主时直接失败，原文件保持不变，比静默换属主更安全。
    let result = unsafe { libc::fchown(temp.as_raw_fd(), original.uid(), original.gid()) };
    if result == 0 {
        Ok(())
    } else {
        Err(AppError::from_io(&std::io::Error::last_os_error(), path))
    }
}

#[cfg(not(unix))]
fn preserve_owner(_temp: &File, _original: &Metadata, _path: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) {
    // Windows 无法 fsync 目录；MoveFileEx 的替换本身由文件系统保证原子性
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("建临时目录")
    }

    #[test]
    fn missing_file_reports_file_not_found() {
        let dir = temp_dir();
        let error = plan_open(&dir.path().join("nope.txt")).expect_err("应当报错");
        assert!(matches!(error, AppError::FileNotFound { .. }));
    }

    #[test]
    fn directory_is_rejected() {
        let dir = temp_dir();
        let error = plan_open(dir.path()).expect_err("应当报错");
        assert!(matches!(error, AppError::IsDirectory { .. }));
    }

    #[test]
    fn nul_bytes_in_head_flag_binary() {
        let dir = temp_dir();
        let path = dir.path().join("blob.bin");
        std::fs::write(&path, [0x89, 0x50, 0x00, 0x4E]).expect("写文件");
        assert!(plan_open(&path).expect("体检").looks_binary);
    }

    #[test]
    fn plain_text_is_not_flagged_binary() {
        let dir = temp_dir();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "中文与 emoji 🙈 都不是二进制").expect("写文件");
        assert!(!plan_open(&path).expect("体检").looks_binary);
    }

    #[test]
    fn atomic_save_writes_exact_bytes() {
        let dir = temp_dir();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "old").expect("写文件");

        let outcome =
            save_atomic(&path, b"new content", None, ConflictPolicy::Overwrite).expect("保存");
        assert_eq!(outcome.bytes_written, 11);

        let mut written = Vec::new();
        File::open(&path)
            .expect("打开")
            .read_to_end(&mut written)
            .expect("读取");
        assert_eq!(written, b"new content");
    }

    #[test]
    fn atomic_save_leaves_no_temp_files_behind() {
        let dir = temp_dir();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "old").expect("写文件");
        save_atomic(&path, b"new", None, ConflictPolicy::Overwrite).expect("保存");

        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .expect("列目录")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(entries.len(), 1, "临时文件必须已被 rename 掉：{entries:?}");
    }

    #[test]
    fn streaming_atomic_save_writes_chunks_without_a_full_buffer() {
        let dir = temp_dir();
        let path = dir.path().join("stream.txt");
        let outcome = save_atomic_stream(&path, 6, |writer| {
            writer
                .write_all(b"abc")
                .map_err(|error| AppError::from_io(&error, &path))?;
            writer
                .write_all(b"def")
                .map_err(|error| AppError::from_io(&error, &path))?;
            Ok(6)
        })
        .expect("流式保存");
        assert_eq!(outcome.bytes_written, 6);
        assert_eq!(std::fs::read(&path).expect("读取"), b"abcdef");
    }

    #[test]
    fn failed_streaming_save_keeps_the_original_file() {
        let dir = temp_dir();
        let path = dir.path().join("stream.txt");
        std::fs::write(&path, b"original").expect("原文件");
        let result = save_atomic_stream(&path, 6, |writer| {
            writer
                .write_all(b"partial")
                .map_err(|error| AppError::from_io(&error, &path))?;
            Err(AppError::Cancelled)
        });
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert_eq!(std::fs::read(&path).expect("读取"), b"original");
    }

    #[test]
    fn bom_and_crlf_bytes_are_written_verbatim() {
        let dir = temp_dir();
        let path = dir.path().join("bom.txt");
        let bytes = [0xEF, 0xBB, 0xBF, b'a', b'\r', b'\n'];
        save_atomic(&path, &bytes, None, ConflictPolicy::Overwrite).expect("保存");
        assert_eq!(std::fs::read(&path).expect("读取"), bytes);
    }

    #[test]
    fn external_change_is_detected_before_overwriting() {
        let dir = temp_dir();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "original").expect("写文件");
        let opened_as = FileFingerprint::read(&path).expect("指纹");

        // 模拟别的程序改了同一个文件
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, "changed by someone else").expect("写文件");

        let error = save_atomic(&path, b"mine", Some(opened_as), ConflictPolicy::Abort)
            .expect_err("应当拒绝");
        assert!(matches!(error, AppError::VersionConflict { .. }));
        assert_eq!(
            std::fs::read_to_string(&path).expect("读取"),
            "changed by someone else",
            "拒绝保存时不得动磁盘上的内容"
        );
    }

    #[test]
    fn overwrite_policy_ignores_external_change() {
        let dir = temp_dir();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "original").expect("写文件");
        let opened_as = FileFingerprint::read(&path).expect("指纹");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, "changed").expect("写文件");

        save_atomic(&path, b"mine", Some(opened_as), ConflictPolicy::Overwrite).expect("保存");
        assert_eq!(std::fs::read_to_string(&path).expect("读取"), "mine");
    }

    #[test]
    fn saving_a_brand_new_file_works() {
        let dir = temp_dir();
        let path = dir.path().join("fresh.txt");
        save_atomic(&path, b"hello", None, ConflictPolicy::Abort).expect("保存新文件");
        assert_eq!(std::fs::read_to_string(&path).expect("读取"), "hello");
    }

    #[test]
    fn fingerprint_changes_when_content_changes() {
        let dir = temp_dir();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "a").expect("写文件");
        let before = FileFingerprint::read(&path).expect("指纹");
        std::fs::write(&path, "much longer content").expect("写文件");
        let after = FileFingerprint::read(&path).expect("指纹");
        assert_ne!(before, after);
    }

    #[test]
    fn disk_space_precheck_rejects_absurd_sizes() {
        let dir = temp_dir();
        // 预检拿不到可用空间的平台会直接放行，所以只在拿得到时断言
        if available_space(dir.path()).is_some() {
            assert!(matches!(
                check_disk_space(dir.path(), u64::MAX / 4),
                Err(AppError::DiskFull)
            ));
        }
    }
}
