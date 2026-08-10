//! 文档内查找与替换命令（SPEC F4.4、F4.6、P3 会话分页、ADR-07 可取消）。
//!
//! **会话机制**：一次 `start_search` 扫完整篇并把命中留在服务端，前端按需
//! 分页取。这样 UI 能立刻显示「共 1,204 处」，而不必先把一万条命中塞进
//! 一次 invoke 响应里（SPEC §3.5 单次响应 256 KiB 硬上限）。
//!
//! 会话带文档版本。文档一改就作废，返回 `SessionExpired`——过期的行号
//! 指向的位置已经不是用户看到的那一行了，返回它比返回空更糟。

use crate::error::{AppError, AppResult};
use crate::search::{
    build_rows, build_rows_with_filter, compile, filter_matches_by_line, find_all,
    parse_escape_sequences, plan_replacements, preserve_case, step_from, Match, MatchRow,
    ResultFilter, SearchOptions,
};
use crate::state::AppState;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

/// 每页条数（SPEC F4.4：每页 300 条，滚动加载下一页）。
pub const MAX_PAGE: usize = crate::constants::SEARCH_CHUNK_SIZE;

/// 一次最多回传多少个用于画装饰的裸区间。
///
/// 全部回传会撞穿 SPEC §3.5 的单次响应上限（20 万处命中约 8 MB），
/// 而超过这个量的装饰本来也看不过来。计数用 `total`，不受此限。
pub const MAX_POSITIONS: usize = 5000;

#[derive(Debug)]
pub struct SearchSession {
    document_id: String,
    document_version: u64,
    matches: Vec<Match>,
    result_filter: Option<ResultFilter>,
}

#[derive(Default)]
pub struct SearchState {
    sessions: DashMap<String, SearchSession>,
    next_id: AtomicU64,
    /// 正在跑的那次扫描的取消令牌。同一时刻只允许一次扫描：
    /// 输入即搜的场景下，新查询到来时旧查询的结果已经没人要了
    running: Mutex<Option<CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSearchArgs {
    pub document_id: String,
    pub query: String,
    pub options: SearchOptions,
    /// 「选区内查找」的范围，UTF-16 偏移。None 为整篇
    pub within: Option<crate::search::Utf16Range>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStarted {
    pub session_id: String,
    pub total: usize,
    pub document_version: u64,
    /// 第一页命中，省掉一次往返：绝大多数查找的结果都不到一页
    pub first_page: Vec<MatchRow>,
    /// 全部命中的裸区间，供编辑器画高亮装饰。
    /// 与 `first_page` 分开是因为装饰要的是**全部**位置，而预览只要**当页**
    pub positions: Vec<Match>,
}

/// 开始一次查找。
///
/// 扫描整段跑在 blocking 线程池上（ADR-07）；新查询到来会取消上一次，
/// 所以「输入即搜」不会让一串废弃的扫描把 CPU 占满。
#[tauri::command]
pub async fn start_search(
    args: StartSearchArgs,
    state: tauri::State<'_, AppState>,
    search: tauri::State<'_, Arc<SearchState>>,
) -> AppResult<SearchStarted> {
    let regex = compile(&args.query, args.options)?;

    let (text, document_version) =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            (document.text(), document.document_version)
        };

    let token = search.begin()?;
    let within = args.within.map(|range| (range.start, range.end));
    let scan_token = token.clone();

    // UTF-16 范围要换成字节范围才能喂给 find_all。做在这里而不是在
    // find_all 里，是因为只有这里还拿得到 rope
    let within_bytes = within.map(|(start, end)| utf16_range_to_bytes(&text, start, end));

    // 扫描与首页预览一起在 blocking 线程池上做完，省得为了拼预览
    // 再把整篇文本搬回异步线程一次（ADR-07）
    let (matches, first_page) = tauri::async_runtime::spawn_blocking(move || {
        let matches = find_all(&text, &regex, within_bytes, || scan_token.is_cancelled())?;
        let head = matches.iter().take(MAX_PAGE).cloned().collect::<Vec<_>>();
        let rows = build_rows(&text, &head);
        Ok::<_, AppError>((matches, rows))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    search.finish(&token);

    let total = matches.len();
    let positions = matches.iter().take(MAX_POSITIONS).cloned().collect();
    let session_id = search.store(SearchSession {
        document_id: args.document_id,
        document_version,
        matches,
        result_filter: None,
    });

    Ok(SearchStarted {
        session_id,
        total,
        document_version,
        first_page,
        positions,
    })
}

/// UTF-16 偏移 → 字节偏移。线性扫描，只在开始查找时跑一次。
fn utf16_range_to_bytes(text: &str, start: usize, end: usize) -> (usize, usize) {
    let mut units = 0;
    let (mut from, mut to) = (None, None);
    for (byte, ch) in text.char_indices() {
        if from.is_none() && units >= start {
            from = Some(byte);
        }
        if to.is_none() && units >= end {
            to = Some(byte);
        }
        units += ch.len_utf16();
    }
    (
        from.unwrap_or(text.len()),
        to.unwrap_or(text.len()).max(from.unwrap_or(0)),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResultsArgs {
    pub session_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultPage {
    pub offset: usize,
    pub matches: Vec<MatchRow>,
    pub total: usize,
}

#[tauri::command]
pub fn fetch_results(
    args: FetchResultsArgs,
    state: tauri::State<'_, AppState>,
    search: tauri::State<'_, Arc<SearchState>>,
) -> AppResult<ResultPage> {
    let session = search.valid_session(&args.session_id, &state)?;
    let total = session.matches.len();
    let offset = args.offset.min(total);
    let end = (offset + args.limit.min(MAX_PAGE)).min(total);
    let page = session.matches[offset..end].to_vec();

    let text = state
        .documents
        .get(&session.document_id)
        .ok_or_else(|| AppError::SessionExpired {
            session_id: args.session_id.clone(),
        })?
        .read()
        .map_err(|_| AppError::Io { os_code: None })?
        .text();

    Ok(ResultPage {
        offset,
        matches: build_rows_with_filter(&text, &page, session.result_filter.as_ref()),
        total,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResultFilterArgs {
    pub session_id: String,
    pub query: String,
    pub case_sensitive: bool,
}

/// 从已有主查找会话派生结果内筛选会话（SPEC F4.8）。
#[tauri::command]
pub async fn start_result_filter(
    args: StartResultFilterArgs,
    state: tauri::State<'_, AppState>,
    search: tauri::State<'_, Arc<SearchState>>,
) -> AppResult<SearchStarted> {
    if args.query.is_empty() {
        return Err(AppError::InvalidRegex {
            position: None,
            detail: "empty result filter query".to_string(),
        });
    }
    let filter = ResultFilter::new(&args.query, args.case_sensitive)?;
    let source = search.valid_session(&args.session_id, &state)?;
    let document_id = source.document_id.clone();
    let document_version = source.document_version;
    let source_matches = source.matches.clone();
    let positions = source_matches.iter().take(MAX_POSITIONS).cloned().collect();
    drop(source);

    let text = state
        .documents
        .get(&document_id)
        .ok_or_else(|| AppError::SessionExpired {
            session_id: args.session_id.clone(),
        })?
        .read()
        .map_err(|_| AppError::Io { os_code: None })?
        .text();
    let token = search.begin()?;
    let scan_token = token.clone();
    let filter_for_scan = filter.clone();
    let (matches, first_page) = tauri::async_runtime::spawn_blocking(move || {
        let matches = filter_matches_by_line(&text, &source_matches, &filter_for_scan, || {
            scan_token.is_cancelled()
        })?;
        let head = matches.iter().take(MAX_PAGE).cloned().collect::<Vec<_>>();
        let rows = build_rows_with_filter(&text, &head, Some(&filter_for_scan));
        Ok::<_, AppError>((matches, rows))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;
    search.finish(&token);

    let total = matches.len();
    let session_id = search.store(SearchSession {
        document_id,
        document_version,
        matches,
        result_filter: Some(filter),
    });
    Ok(SearchStarted {
        session_id,
        total,
        document_version,
        first_page,
        positions,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepArgs {
    pub session_id: String,
    /// 光标位置，UTF-16 偏移
    pub cursor: usize,
    pub forward: bool,
}

/// 从光标处走到下一 / 上一处命中，到头绕回（SPEC F4.4）。
#[tauri::command]
pub fn step_search(
    args: StepArgs,
    state: tauri::State<'_, AppState>,
    search: tauri::State<'_, Arc<SearchState>>,
) -> AppResult<Option<(usize, Match)>> {
    let session = search.valid_session(&args.session_id, &state)?;
    Ok(
        step_from(&session.matches, args.cursor, args.forward).and_then(|index| {
            session
                .matches
                .get(index)
                .map(|found| (index, found.clone()))
        }),
    )
}

#[tauri::command]
pub fn dispose_search(session_id: String, search: tauri::State<'_, Arc<SearchState>>) {
    search.sessions.remove(&session_id);
}

/// 取消正在跑的扫描（ADR-07）。取消是**用户动作**，不是错误。
#[tauri::command]
pub fn cancel_search(search: tauri::State<'_, Arc<SearchState>>) {
    search.cancel_running();
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAllArgs {
    pub document_id: String,
    pub query: String,
    pub replacement: String,
    pub options: SearchOptions,
    pub within: Option<crate::search::Utf16Range>,
    /// 仅字面量模式有效（SPEC F4.3）
    pub preserve_case: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreview {
    pub count: usize,
    /// 预览用的前若干条，UI 拿它显示「将把 X 换成 Y」
    pub sample: Vec<crate::search::ReplaceEdit>,
}

/// 只算不改：SPEC F4.6 要求替换前给出影响计数，且该计数必须与真正落下去的
/// 改动完全一致。所以预览与执行**共用同一个 `plan_replacements`**。
#[tauri::command]
pub async fn preview_replace_all(
    args: ReplaceAllArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<ReplacePreview> {
    let edits = plan(&args, &state)?;
    Ok(ReplacePreview {
        count: edits.len(),
        sample: edits.into_iter().take(20).collect(),
    })
}

fn plan(args: &ReplaceAllArgs, state: &AppState) -> AppResult<Vec<crate::search::ReplaceEdit>> {
    let regex = compile(&args.query, args.options)?;
    let replacement = if args.options.parse_escapes {
        parse_escape_sequences(&args.replacement)
    } else {
        args.replacement.clone()
    };
    let text =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            document.text()
        };

    let within = args
        .within
        .map(|range| utf16_range_to_bytes(&text, range.start, range.end));

    let mut edits = plan_replacements(&text, &regex, &replacement, args.options, within, || false)?;

    if args.preserve_case && args.options.mode == crate::search::MatchMode::Literal {
        // 保留大小写要看原文，所以在这里按每处命中的原文再修一遍替换串
        let matched = find_all(&text, &regex, within, || false)?;
        for (edit, found) in edits.iter_mut().zip(matched.iter()) {
            if let Some(original) = slice_utf16(&text, found.start, found.end) {
                edit.insert = preserve_case(&original, &replacement);
            }
        }
    }
    Ok(edits)
}

fn slice_utf16(text: &str, start: usize, end: usize) -> Option<String> {
    let mut units = 0;
    let mut out = String::new();
    for ch in text.chars() {
        if units >= end {
            break;
        }
        if units >= start {
            out.push(ch);
        }
        units += ch.len_utf16();
    }
    (!out.is_empty()).then_some(out)
}

/// 算出替换全部的改动，交给前端**当作一次编辑批次**下发。
///
/// 不在这里直接改文档，是为了让替换走与普通编辑同一条路径：
/// 撤销栈、版本号、备份触发都不必各写一遍（SPEC F4.6 要求替换全部是单个撤销步骤，
/// 而 `apply_edits` 的一批本就是一步）。
#[tauri::command]
pub async fn plan_replace_all(
    args: ReplaceAllArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<crate::search::ReplaceEdit>> {
    plan(&args, &state)
}

/// 直接在服务端把「替换全部」落到文档上，返回改动处数。
///
/// 只给**没有挂载编辑器**的已打开文档用（跨文件替换会碰到它们）：有编辑器的
/// 文档必须走 `plan_replace_all` + 编辑队列，否则 CodeMirror 与 Rust 的正文会分叉。
#[tauri::command]
pub async fn replace_all_in_document(
    args: ReplaceAllArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<usize> {
    let edits = plan(&args, &state)?;
    let changes: Vec<crate::commands::editing::Utf16Change> = edits
        .iter()
        .map(|edit| crate::commands::editing::Utf16Change {
            from: edit.start,
            to: edit.end,
            insert: edit.insert.clone(),
        })
        .collect();

    let entry =
        state
            .documents
            .get(&args.document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: args.document_id.clone(),
            })?;
    let mut document = entry.write().map_err(|_| AppError::Io { os_code: None })?;
    crate::commands::editing::apply_batch_to_document(
        &mut document,
        &changes,
        crate::undo::EditKind::Replace,
    )
}

impl SearchState {
    fn begin(&self) -> AppResult<CancellationToken> {
        let token = CancellationToken::new();
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?;
        if let Some(previous) = running.replace(token.clone()) {
            previous.cancel();
        }
        Ok(token)
    }

    fn finish(&self, token: &CancellationToken) {
        if let Ok(mut running) = self.running.lock() {
            // 只有还是自己那次才清：期间可能已经被新查询顶替
            if running.as_ref().is_some_and(|current| current == token) {
                *running = None;
            }
        }
    }

    fn cancel_running(&self) {
        if let Ok(running) = self.running.lock() {
            if let Some(token) = running.as_ref() {
                token.cancel();
            }
        }
    }

    fn store(&self, session: SearchSession) -> String {
        let id = format!("search-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        self.sessions.insert(id.clone(), session);
        id
    }

    /// 取会话并校验文档版本。版本对不上就**连同会话一起丢掉**：
    /// 留着只会让下一次调用重复失败一次
    fn valid_session<'a>(
        &'a self,
        session_id: &str,
        state: &AppState,
    ) -> AppResult<dashmap::mapref::one::Ref<'a, String, SearchSession>> {
        let expired = || AppError::SessionExpired {
            session_id: session_id.to_string(),
        };
        let session = self.sessions.get(session_id).ok_or_else(expired)?;

        let current = state
            .documents
            .get(&session.document_id)
            .ok_or_else(expired)?
            .read()
            .map_err(|_| AppError::Io { os_code: None })?
            .document_version;

        if current != session.document_version {
            drop(session);
            self.sessions.remove(session_id);
            return Err(expired());
        }
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::MatchMode;
    use crate::state::Document;
    use std::sync::RwLock;

    fn state_with(text: &str) -> (AppState, String) {
        let state = AppState::default();
        let id = "doc-1".to_string();
        let document = Document::new(id.clone(), None, text);
        state.documents.insert(id.clone(), RwLock::new(document));
        (state, id)
    }

    fn args(document_id: &str, query: &str) -> ReplaceAllArgs {
        ReplaceAllArgs {
            document_id: document_id.to_string(),
            query: query.to_string(),
            replacement: "bar".to_string(),
            options: SearchOptions {
                mode: MatchMode::Literal,
                ..SearchOptions::default()
            },
            within: None,
            preserve_case: false,
        }
    }

    #[test]
    fn planning_a_replacement_does_not_touch_the_document() {
        let (state, id) = state_with("foo foo");
        let edits = plan(&args(&id, "foo"), &state).expect("计划");

        assert_eq!(edits.len(), 2);
        let entry = state.documents.get(&id).expect("文档还在");
        assert_eq!(entry.read().expect("读锁").text(), "foo foo");
    }

    #[test]
    fn preserve_case_applies_per_match() {
        let (state, id) = state_with("foo FOO Foo");
        let mut request = args(&id, "foo");
        request.preserve_case = true;

        let edits = plan(&request, &state).expect("计划");

        assert_eq!(edits[0].insert, "bar");
        assert_eq!(edits[1].insert, "BAR");
        assert_eq!(edits[2].insert, "Bar");
    }

    #[test]
    fn replacement_mode_parses_escapes_on_both_sides() {
        let (state, id) = state_with("left\nright");
        let mut request = args(&id, r"\n");
        request.replacement = r"\t".to_string();
        request.options.parse_escapes = true;

        let edits = plan(&request, &state).expect("计划");

        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].insert, "\t");
    }

    #[test]
    fn a_missing_document_is_an_error_not_a_panic() {
        let state = AppState::default();
        let error = plan(&args("nope", "foo"), &state).expect_err("应当失败");
        assert!(matches!(error, AppError::DocumentNotFound { .. }));
    }

    #[test]
    fn an_invalid_regex_fails_before_touching_the_document() {
        let (state, id) = state_with("foo");
        let mut request = args(&id, "(unclosed");
        request.options.mode = MatchMode::Regex;

        assert!(matches!(
            plan(&request, &state).expect_err("应当失败"),
            AppError::InvalidRegex { .. }
        ));
    }

    #[test]
    fn utf16_range_maps_to_byte_range_across_multibyte_text() {
        let text = "中文abc";
        assert_eq!(utf16_range_to_bytes(text, 2, 5), (6, 9));
    }

    #[test]
    fn slicing_by_utf16_offsets_returns_the_matched_text() {
        assert_eq!(slice_utf16("中文abc", 2, 5).as_deref(), Some("abc"));
    }

    #[test]
    fn a_session_expires_when_the_document_changes() {
        let (state, id) = state_with("foo");
        let search = SearchState::default();
        let session_id = search.store(SearchSession {
            document_id: id.clone(),
            document_version: 0,
            matches: Vec::new(),
            result_filter: None,
        });

        {
            let entry = state.documents.get(&id).expect("文档还在");
            entry.write().expect("写锁").document_version = 7;
        }

        assert!(matches!(
            search
                .valid_session(&session_id, &state)
                .expect_err("应当过期"),
            AppError::SessionExpired { .. }
        ));
        assert!(
            search.sessions.get(&session_id).is_none(),
            "过期会话要顺手清掉，不然每次调用都白失败一次"
        );
    }

    #[test]
    fn a_fresh_session_is_valid() {
        let (state, id) = state_with("foo");
        let version = state
            .documents
            .get(&id)
            .expect("文档还在")
            .read()
            .expect("读锁")
            .document_version;
        let search = SearchState::default();
        let session_id = search.store(SearchSession {
            document_id: id,
            document_version: version,
            matches: Vec::new(),
            result_filter: None,
        });

        assert!(search.valid_session(&session_id, &state).is_ok());
    }

    #[test]
    fn starting_a_new_scan_cancels_the_previous_one() {
        let search = SearchState::default();
        let first = search.begin().expect("第一次");
        let _second = search.begin().expect("第二次");

        assert!(first.is_cancelled(), "旧扫描的结果已经没人要了");
    }
}
