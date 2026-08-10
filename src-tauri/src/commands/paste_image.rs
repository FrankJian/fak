//! 粘贴图片落盘（SPEC F3.4）。
//!
//! 图片字节以 base64 传入而不是 `Vec<u8>`：Tauri 会把字节数组序列化成 JSON 数字
//! 数组，约 3.5 倍膨胀（AGENTS.md §6）。
//!
//! 只写文档同目录下的 `assets/`，文件名由时间戳生成——**不接受调用方指定文件名**，
//! 否则 `../` 就能把任意位置的文件覆盖掉（SPEC §10.4）。

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use std::path::PathBuf;

/// 单张粘贴图片的上限。超过这个大小的「截图」多半是误操作，
/// 而内嵌回退会让文档瞬间膨胀到没法编辑。
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePastedImageArgs {
    pub document_id: String,
    /// base64 编码的图片字节
    pub data: String,
    /// 扩展名，如 `png`；只取字母数字，其余一律拒绝
    pub extension: String,
}

/// 落盘并返回**相对文档目录**的路径，调用方直接把它写进 Markdown。
#[tauri::command]
pub fn save_pasted_image(
    args: SavePastedImageArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let extension = sanitize_extension(&args.extension)?;

    let bytes = STANDARD
        .decode(args.data.as_bytes())
        .map_err(|_| AppError::UnsupportedFormat {
            syntax: "base64".to_string(),
            operation: "pasteImage".to_string(),
        })?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::FileTooLarge {
            size_bytes: bytes.len() as u64,
            limit_bytes: MAX_IMAGE_BYTES as u64,
        });
    }

    let directory = document_dir(&state, &args.document_id)?;
    let assets = directory.join("assets");
    std::fs::create_dir_all(&assets).map_err(|error| AppError::from_io(&error, &assets))?;

    let name = format!("{}.{extension}", timestamp_name());
    let target = assets.join(&name);
    std::fs::write(&target, &bytes).map_err(|error| AppError::from_io(&error, &target))?;

    Ok(format!("assets/{name}"))
}

fn sanitize_extension(raw: &str) -> AppResult<String> {
    let extension = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    let allowed = matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
    allowed
        .then_some(extension)
        .ok_or(AppError::UnsupportedFormat {
            syntax: raw.to_string(),
            operation: "pasteImage".to_string(),
        })
}

/// 未命名文档没有同目录，调用方据此回退为内嵌 Base64（SPEC F3.4 步骤 4）。
fn document_dir(state: &AppState, document_id: &str) -> AppResult<PathBuf> {
    let entry = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
    document
        .path
        .as_ref()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
        .ok_or(AppError::Cancelled)
}

fn timestamp_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("paste-{now}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_image_extensions_are_accepted() {
        assert_eq!(sanitize_extension("PNG").expect("png"), "png");
        assert_eq!(sanitize_extension(".jpeg").expect("jpeg"), "jpeg");
        assert!(sanitize_extension("exe").is_err());
        assert!(sanitize_extension("").is_err());
    }

    #[test]
    fn extensions_cannot_smuggle_a_path() {
        assert!(sanitize_extension("../evil.exe").is_err());
        assert!(sanitize_extension("png/../..").is_err());
    }
}
