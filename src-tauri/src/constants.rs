//! 阈值常量集中在这里，与 SPEC 附录 B 一一对应（AGENTS.md §5.1）。

// ── 档位（SPEC §4.1 / §8.2）
pub const TIER_A_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub const TIER_A_MAX_LINE_LEN: usize = 8 * 1024;
pub const TIER_B_MAX_BYTES: u64 = 64 * 1024 * 1024;
pub const TIER_B_MAX_LINE_LEN: usize = 256 * 1024;
pub const TIER_B_MAX_LINES: usize = 2_000_000;
pub const HIGHLIGHT_MAX_BYTES: u64 = 16 * 1024 * 1024;
pub const STREAM_VIEWPORT_OVERSCAN: usize = 300;
pub const PROMOTE_CONFIRM_BYTES: u64 = 256 * 1024 * 1024;
/// Tier C 之上的硬上限。SPEC 附录 B 只给出 ADR-02 的验证目标（1 GB 可用），
/// 未给出拒绝阈值；这里取 2 GiB 作为工程取值，超出返回 `FileTooLarge`。
pub const MAX_OPEN_BYTES: u64 = 2 * 1024 * 1024 * 1024;

// ── 大纲（SPEC F6.3）
pub const OUTLINE_MAX_SOURCE_BYTES: usize = 1024 * 1024;
pub const OUTLINE_MAX_SYMBOLS: usize = 5000;
/// 名字总量的软上限。5000 个符号即便每个名字都顶到 `MAX_NAME_CHARS`，
/// 单次响应也不能撞破 SPEC §3.5 的 256 KiB —— 先到先得，撞上就算截断。
pub const OUTLINE_MAX_NAME_BYTES: usize = 128 * 1024;

// ── 解析与扫描
pub const ENCODING_DETECT_SAMPLE: usize = 1024 * 1024;
pub const BINARY_DETECT_SAMPLE: usize = 8 * 1024;
pub const LINE_PREVIEW_MAX_BYTES: usize = 2048;

// ── 差异
pub const DIFF_INLINE_MAX_LINE: usize = 4 * 1024;
pub const DIFF_COARSE_ALIGN_LINES: usize = 500_000;
/// 单个 modify 行的行内片段上限。超过就退化为纯行级——
/// 一行里两百段各自变色，看起来跟整行变色没有区别，白付计算与 DOM 代价（SPEC F5.4）
pub const DIFF_INLINE_MAX_SEGMENTS: usize = 200;

// ── 分页
pub const SEARCH_CHUNK_SIZE: usize = 300;
pub const DIFF_CHUNK_SIZE: usize = 500;
pub const CROSS_FILE_CHUNK_SIZE: usize = 200;
pub const WORKSPACE_INDEX_PAGE_SIZE: usize = 100;
pub const WORKSPACE_INDEX_PROGRESS_STEP: usize = 500;
pub const TEXT_TRANSFER_CHUNK: usize = 64 * 1024;

// ── 编辑与撤销
pub const EDIT_SYNC_COALESCE_WINDOW_MS: u64 = 16;
pub const UNDO_COALESCE_IDLE_MS: u64 = 500;
pub const UNDO_MAX_DEPTH: usize = 2000;
pub const UNDO_MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;

// ── 备份
pub const BACKUP_IDLE_MS: u64 = 1500;
pub const BACKUP_INTERVAL_MS: u64 = 20_000;
pub const BACKUP_MAX_PER_DOC: u64 = 64 * 1024 * 1024;
pub const BACKUP_MAX_TOTAL: u64 = 512 * 1024 * 1024;

// ── 外部工具（SPEC F15）
pub const EXTERNAL_TOOL_TIMEOUT_MS: u64 = 10_000;
pub const EXTERNAL_TOOL_STDERR_MAX_CHARS: usize = 2_000;
/// 留出 JSON 转义与结果元数据空间，避免 `invoke` 响应超过 SPEC §3.5 的 256 KiB。
pub const EXTERNAL_TOOL_STDOUT_MAX_BYTES: usize = 240 * 1024;

// ── 日志（SPEC §10.2）
/// 单个日志文件的上限。超过就轮转，只保留上一份——日志是排障用的，
/// 不是审计留档，攒几百 MB 只会挤占用户的磁盘。
pub const LOG_MAX_FILE_BYTES: u128 = 8 * 1024 * 1024;
