//! 大纲命令（SPEC F6、P8）。
//!
//! 与高亮共用 `SyntaxCache` 里的那一棵树：文档版本没变时这里只跑一次 query，
//! 是微秒级的；版本变了才重解析，而那一次解析高亮也要付，两边合起来只付一次。
//!
//! 解析可能超过 50 ms，整段跑在 blocking 线程池上（AGENTS.md §5.1）。

use crate::constants::{OUTLINE_MAX_SOURCE_BYTES, OUTLINE_MAX_SYMBOLS};
use crate::error::{AppError, AppResult};
use crate::outline::{
    ancestors_at, build, build_after_edit, build_snapshot, siblings_of, OutlineNode,
};
use crate::state::AppState;
use crate::syntax::{parse_standalone, SyntaxCache, SyntaxKey};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineArgs {
    pub document_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineResult {
    /// `None` 表示这门语言没有大纲支持。前端据此显示一句解释而不是空列表
    /// （SPEC F6 步骤 5）
    pub syntax: Option<SyntaxKey>,
    pub symbols: Vec<OutlineNode>,
    /// 撞上符号数或源文本上限被截断（SPEC F6.3）。
    /// UI 要说出来，否则用户会以为文件就这么大
    pub truncated: bool,
    /// 与请求时的文档版本一致才可采用
    pub document_version: u64,
}

impl OutlineResult {
    fn none(document_version: u64) -> Self {
        Self {
            syntax: None,
            symbols: Vec::new(),
            truncated: false,
            document_version,
        }
    }
}

/// 截断位置：不超过 1 MiB 的最大字符边界（SPEC F6.3）。
/// 按字节切会切进多字节字符中间，切片会 panic。
fn source_limit(text: &str) -> usize {
    if text.len() <= OUTLINE_MAX_SOURCE_BYTES {
        return text.len();
    }
    let mut cut = OUTLINE_MAX_SOURCE_BYTES;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

/// 一份文档的大纲。
///
/// 认不出语言时返回**空结果而不是错误**：日志与纯文本是最常见的情形，
/// 报成错误会把错误通道淹掉。
#[tauri::command]
pub async fn get_outline(
    args: OutlineArgs,
    state: tauri::State<'_, AppState>,
    cache: tauri::State<'_, Arc<SyntaxCache>>,
) -> AppResult<OutlineResult> {
    // 先在锁内取快照再放锁：解析期间不该把文档锁住，否则打字会被大纲堵住
    let snapshot =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            let syntax = document
                .path
                .as_deref()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str())
                .and_then(SyntaxKey::from_file_name);
            match syntax {
                Some(syntax) => (syntax, document.text(), document.document_version),
                None => return Ok(OutlineResult::none(document.document_version)),
            }
        };

    let (syntax, text, version) = snapshot;
    let document_id = args.document_id;
    let cache = Arc::clone(&cache);
    let len = text.len();
    let cut = source_limit(&text);

    let symbols = tauri::async_runtime::spawn_blocking(move || {
        if cut < text.len() {
            // 超过 1 MiB 的部分不进大纲（SPEC F6.3）。这一份**不进共享缓存**：
            // 缓存里那棵树是高亮在用的，塞一棵截断的树进去会让高亮跟着断在 1 MiB
            let parsed = parse_standalone(syntax, &text[..cut])?;
            return build(&parsed.tree, &parsed.source, syntax);
        }
        cache.with_parsed_mut(&document_id, syntax, &text, version, |parsed| {
            // 三条路：正文没动就直接用上一版；只改了一处就单查那棵子树；
            // 换了语言或第一次见到这份文档才全量跑一遍
            let snapshot = match (parsed.outline.take(), parsed.last_edit) {
                (Some(previous), Some(edit)) => {
                    build_after_edit(&parsed.tree, &parsed.source, syntax, &previous, &edit)?
                }
                (Some(previous), None) => Some(previous),
                (None, _) => build_snapshot(&parsed.tree, &parsed.source, syntax)?,
            };
            let symbols = snapshot.as_ref().map(|snapshot| snapshot.nodes.clone());
            parsed.outline = snapshot;
            Ok(symbols)
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    Ok(match symbols {
        Some(symbols) => OutlineResult {
            syntax: Some(syntax),
            truncated: symbols.len() >= OUTLINE_MAX_SYMBOLS || cut < len,
            symbols,
            document_version: version,
        },
        None => OutlineResult::none(version),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyArgs {
    pub document_id: String,
    /// 光标位置，UTF-16 偏移
    pub cursor: usize,
    /// 最多回传几层（SPEC F3.2：粘性滚动最多 3 层）
    pub max_depth: usize,
}

/// 光标所处的祖先符号链，最外层在前（SPEC F3.2 粘性滚动与面包屑、§3.6）。
///
/// 复用大纲数据，不另跑一次查询：粘性头每次滚动都要更新，重算一遍大纲
/// 会把滚动拖成幻灯片。
#[tauri::command]
pub async fn get_sticky_context(
    args: StickyArgs,
    state: tauri::State<'_, AppState>,
    cache: tauri::State<'_, Arc<SyntaxCache>>,
) -> AppResult<Vec<OutlineNode>> {
    let outline = get_outline(
        OutlineArgs {
            document_id: args.document_id,
        },
        state,
        cache,
    )
    .await?;

    let chain = ancestors_at(&outline.symbols, args.cursor);
    // 超过上限时留**最内层**的几个：外层是 `mod` / 顶层类这种一眼能想起来的，
    // 真正会忘的是自己现在在哪个方法里
    let keep = chain.len().saturating_sub(args.max_depth.max(1));
    Ok(chain[keep..]
        .iter()
        .map(|&index| outline.symbols[index].clone())
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingArgs {
    pub document_id: String,
    /// 目标符号定义的起点，UTF-16 偏移。用它而不是行号：
    /// 同一行上可能有多个定义，行号定位不唯一
    pub start: usize,
}

/// 某个符号的同级符号列表（SPEC F3.2 面包屑下拉）。
///
/// 符号已不在（大纲在两次请求之间重算过）时返回空列表而不是错误——
/// 用户点开一个空下拉，比收到一条报错更接近「刚才那个符号没了」的事实。
#[tauri::command]
pub async fn get_symbol_siblings(
    args: SiblingArgs,
    state: tauri::State<'_, AppState>,
    cache: tauri::State<'_, Arc<SyntaxCache>>,
) -> AppResult<Vec<OutlineNode>> {
    let outline = get_outline(
        OutlineArgs {
            document_id: args.document_id,
        },
        state,
        cache,
    )
    .await?;

    let Some(index) = outline
        .symbols
        .iter()
        .position(|node| node.start == args.start)
    else {
        return Ok(Vec::new());
    };

    Ok(siblings_of(&outline.symbols, index)
        .into_iter()
        .map(|index| outline.symbols[index].clone())
        .collect())
}
