pub mod backup;
pub mod bookmarks;
pub mod commands;
pub mod config;
pub mod config_watch;
pub mod constants;
pub mod coord;
pub mod diff;
pub mod edit_sync_protocol;
pub mod encoding;
pub mod error;
pub mod external_tools;
pub mod file_io;
pub mod filter;
pub mod format;
pub mod line_ending;
pub mod line_index;
pub mod logging;
pub mod markdown;
pub mod native_menu;
pub mod outline;
pub mod path_search;
pub mod paths;
pub mod search;
pub mod session;
pub mod single_instance;
pub mod state;
pub mod stream;
pub mod syntax;
pub mod textops;
pub mod undo;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例插件必须在 Builder 之前注册，那时还没有 AppHandle，
    // 所以 identifier 从 context 取、配置直接读文件（见 single_instance.rs）
    let context = tauri::generate_context!();
    let config_dir = paths::app_config_dir_or_temp(&context.config().identifier);
    let single_instance_on = single_instance::preference(&config_dir);

    let mut builder = tauri::Builder::default();

    if single_instance_on {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 第二个实例已经退出了，它带来的文件要由这个窗口接手（SPEC §12.5）
            logging::focus_main_window(app);
            let paths = commands::startup::file_arguments(&args);
            // 第二个实例可能在本窗口前端还没就绪时就转发过来，交给它自己判断排队还是发事件
            tauri::Manager::state::<commands::startup::PendingOpenPaths>(app)
                .queue_or_emit(app, paths);
        }));
    }

    builder
        // 日志插件必须第一个注册（SPEC §3.8 步骤 3）
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    tauri_plugin_log::log::LevelFilter::Debug
                } else {
                    tauri_plugin_log::log::LevelFilter::Info
                })
                // 轮转：日志会跟着应用一直跑，不设上限就是一个只涨不跌的文件（SPEC §10.2）
                .max_file_size(constants::LOG_MAX_FILE_BYTES)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            logging::install_panic_hook(app.handle().clone());

            // 启动时实际生效的单实例状态。设置里改过之后要重启才生效，
            // 前端拿它和配置值比对来提示（SPEC §12.5 第 3 条）
            app.manage(single_instance::SingleInstanceActive(single_instance_on));

            // 与 Builder 之前那次读取走同一个函数，杜绝两处路径逻辑分叉
            let _ = std::fs::create_dir_all(&config_dir);
            let config_store =
                commands::config::ConfigStore::load(config_dir.join(config::CONFIG_FILE));
            if let Ok(snapshot) = config_store.snapshot() {
                if native_menu::install_on_handle(app.handle(), &snapshot.config).is_err() {
                    log::warn!("系统菜单初始化失败");
                }
            }
            app.manage(config_store);
            if let Some(watcher) = config_watch::spawn(app.handle().clone(), &config_dir) {
                // watcher 被 drop 就等于静默关掉热重载，所以要挂在 app 上活着
                app.manage(watcher);
            }

            // 会话与配置分文件存（见 session.rs 的说明）
            app.manage(commands::session::SessionPath(session::path_in(
                &config_dir,
            )));

            // 备份目录必须在扫描前就位。取不到配置目录时退回临时目录：
            // 没有备份能力比启动失败好，但要留下日志（SPEC F1.6）
            let root = match app.path().app_config_dir() {
                Ok(dir) => dir.join("backups"),
                Err(_) => {
                    log::warn!("取不到配置目录，备份改用临时目录，重启后不保留");
                    std::env::temp_dir().join("fak-backups")
                }
            };
            let store = backup::BackupStore::new(root);

            // 扫描必须早于任何一次备份写入，否则本次会话写的备份会被
            // 当成「上次崩溃留下的」（F1.6 步骤 5）
            let scan = store.begin_session();
            if !scan.pending.is_empty() {
                log::info!("上次异常退出，发现 {} 份待恢复备份", scan.pending.len());
            }

            app.manage(store);
            app.manage(scan);

            // 双击文件 / 「打开方式」/ 拖到图标上：路径都在命令行里（SPEC §12.4）。
            // 前端还没订阅完事件，所以留到它就绪后再问一次，见 `pending_open_paths`
            app.manage(commands::startup::PendingOpenPaths::new(
                commands::startup::file_arguments(&std::env::args().collect::<Vec<_>>()),
            ));
            Ok(())
        })
        .on_menu_event(|app, event| native_menu::emit_action(app, event.id()))
        .manage(state::AppState::default())
        .manage(commands::workspace::WorkspaceWatchers::default())
        .manage(std::sync::Arc::new(stream::StreamDocuments::default()))
        .manage(std::sync::Arc::new(commands::tail::TailState::default()))
        .manage(std::sync::Arc::new(commands::filter::FilterState::default()))
        .manage(std::sync::Arc::new(
            commands::stream_search::StreamSearchState::default(),
        ))
        .manage(std::sync::Arc::new(
            commands::stream_transform::StreamTransformState::default(),
        ))
        .manage(std::sync::Arc::new(
            commands::external_tools::ExternalToolState::default(),
        ))
        // Arc 而不是裸值：高亮解析要搬到 blocking 线程池上跑，
        // 那里拿不到带生命周期的 State 引用
        .manage(std::sync::Arc::new(syntax::SyntaxCache::default()))
        // 同上：扫描跑在 blocking 线程池，取消令牌要能跨线程共享
        .manage(std::sync::Arc::new(commands::search::SearchState::default()))
        // 跨文件扫描同样需要跨 blocking 线程持有取消令牌（ADR-07）。
        .manage(std::sync::Arc::new(
            commands::path_search::PathSearchState::default(),
        ))
        .manage(std::sync::Arc::new(
            commands::workspace_index::WorkspaceIndexState::default(),
        ))
        .manage(std::sync::Arc::new(
            commands::path_replace::PathReplaceState::default(),
        ))
        // 同上：对齐计算跑在 blocking 线程池
        .manage(std::sync::Arc::new(commands::diff::DiffState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::file_io::open_file,
            commands::file_io::promote_stream_document,
            commands::file_io::new_document,
            commands::file_io::close_document,
            commands::file_io::read_lines,
            commands::file_io::stream_document_text,
            commands::file_io::save_document,
            commands::file_io::convert_encoding,
            commands::file_io::reopen_with_encoding,
            commands::file_io::reload_from_disk,
            commands::file_io::open_disk_snapshot,
            commands::file_io::document_meta,
            commands::file_io::set_line_ending,
            commands::file_io::list_encodings,
            commands::pinyin::command_pinyin_initials,
            commands::workspace::list_directory,
            commands::workspace::rename_workspace_entry,
            commands::workspace::move_workspace_entry_to_trash,
            commands::workspace::permanently_delete_workspace_entry,
            commands::workspace::watch_directory,
            commands::workspace::unwatch_directory,
            commands::workspace::unwatch_all_directories,
            commands::workspace_index::workspace_index_start,
            commands::workspace_index::workspace_index_query,
            commands::workspace_index::workspace_index_dispose,
            commands::tail::start_follow,
            commands::tail::stop_follow,
            commands::filter::start_filter,
            commands::filter::fetch_filter_page,
            commands::filter::dispose_filter,
            commands::filter::cancel_filter,
            commands::external_tools::list_external_tools,
            commands::external_tools::run_external_tool,
            commands::external_tools::cancel_external_tool,
            commands::markdown::render_markdown_preview,
            commands::editing::apply_edits,
            commands::editing::undo,
            commands::editing::redo,
            commands::editing::resync,
            commands::backup::backup_document,
            commands::backup::pending_backups,
            commands::backup::recover_backup,
            commands::backup::open_backup_diff,
            commands::backup::discard_backup,
            commands::backup::discard_all_backups,
            commands::backup::mark_clean_exit,
            commands::config::read_config,
            commands::config::write_config,
            commands::config::config_file_path,
            commands::config::log_directory,
            commands::paste_image::save_pasted_image,
            commands::portable::export_external_tools,
            commands::startup::take_startup_paths,
            commands::external_tools::run_external_tool_streamed,
            commands::portable::import_external_tools,
            commands::portable::export_filter_rule_groups,
            commands::portable::import_filter_rule_groups,
            commands::syntax::get_highlight_spans,
            commands::syntax::get_fold_ranges,
            commands::outline::get_outline,
            commands::outline::get_sticky_context,
            commands::outline::get_symbol_siblings,
            commands::textops::count_document_words,
            commands::textops::plan_line_tool,
            commands::textops::plan_base64,
            commands::textops::transcode_base64,
            commands::search::start_search,
            commands::search::start_result_filter,
            commands::search::fetch_results,
            commands::search::step_search,
            commands::search::dispose_search,
            commands::search::cancel_search,
            commands::search::preview_replace_all,
            commands::search::plan_replace_all,
            commands::search::replace_all_in_document,
            commands::textops::plan_format,
            commands::textops::plan_indent_tool,
            commands::update::test_update_endpoint,
            commands::update_guard::update_install_preflight,
            commands::update_guard::clear_quarantine_attributes,
            commands::update_guard::record_update_attempt,
            commands::update_guard::take_update_outcome,
            commands::shell_integration::shell_integration_status,
            commands::shell_integration::register_shell_integration,
            commands::shell_integration::unregister_shell_integration,
            single_instance::single_instance_active,
            commands::stream_search::stream_search_start,
            commands::stream_search::fetch_stream_search_page,
            commands::stream_search::cancel_stream_search,
            commands::stream_search::dispose_stream_search,
            commands::stream_transform::preview_stream_replace,
            commands::stream_transform::apply_stream_replace,
            commands::stream_transform::export_stream_filter,
            commands::stream_transform::cancel_stream_transform,
            commands::minimap::minimap_density,
            commands::path_search::path_search_start,
            commands::path_search::path_search_next,
            commands::path_search::path_search_dispose,
            commands::path_search::path_search_cancel,
            commands::path_replace::path_replace_preview,
            commands::path_replace::path_replace_apply,
            commands::session::save_session,
            commands::session::restore_session,
            commands::diff::start_diff,
            commands::diff::fetch_diff_rows,
            commands::diff::fetch_diff_blocks,
            commands::diff::dispose_diff,
            commands::diff::cancel_diff,
            commands::diff::get_unsaved_change_lines,
            commands::bookmarks::toggle_bookmark,
            commands::bookmarks::list_bookmarks,
            commands::bookmarks::remove_bookmark,
            commands::bookmarks::clear_bookmarks,
            commands::bookmarks::step_bookmark,
        ])
        .build(context)
        .expect("error while running tauri application")
        // macOS 的双击与「打开方式」走 RunEvent::Opened，**不进命令行参数**；
        // 只读 argv 的话在 macOS 上永远打不开文件
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                tauri::Manager::state::<commands::startup::PendingOpenPaths>(_app)
                    .queue_or_emit(_app, paths);
            }
        });
}
