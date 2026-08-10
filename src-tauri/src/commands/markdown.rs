//! Markdown 预览命令（SPEC F8.1）。

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderMarkdownArgs {
    pub document_id: String,
    /// 拦截远程图片（SPEC F8.2）。在渲染时就不写 `src`，
    /// 前端拿到 HTML 再改已经晚一拍：请求在插入那一刻就发出去了。
    #[serde(default)]
    pub block_remote_images: bool,
}

#[tauri::command]
pub async fn render_markdown_preview(
    args: RenderMarkdownArgs,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<String> {
    let block_remote_images = args.block_remote_images;
    let (text, document_dir) = {
        let document = state.documents.get(&args.document_id).ok_or({
            AppError::DocumentNotFound {
                document_id: args.document_id,
            }
        })?;
        let document = document
            .read()
            .map_err(|_| AppError::Io { os_code: None })?;
        // 未命名文档没有同目录可言，相对图片路径因此一律不解析
        let dir = document
            .path
            .as_ref()
            .and_then(|path| path.parent().map(std::path::Path::to_path_buf));
        (document.text(), dir)
    };
    // asset 作用域逐目录授权：配置里是空白名单，只放行用户真正打开过的文档所在目录，
    // 而不是给整个磁盘开一个 `**`（SPEC §10.4）
    if let Some(dir) = document_dir.as_ref() {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_directory(dir, false);
    }

    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, AppError>(crate::markdown::render_with(
            &text,
            crate::markdown::RenderOptions {
                block_remote_images,
                document_dir,
            },
        ))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })?
}
