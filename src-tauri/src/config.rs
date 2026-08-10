//! 用户配置的读写（SPEC 9.1 – 9.3）。
//!
//! 三条决定了本文件形状的规则：
//!
//! - **磁盘上的 JSON 对象才是真相源，`Config` 只是它的一个收窄视图**。写入走
//!   「把补丁合并进磁盘上的对象」，不是「把结构体整个序列化出去」。这样
//!   本版本还没实现的字段（外部工具、快捷键覆盖、过滤规则组……）不会因为
//!   保存一次外观设置就被抹掉，正好是 9.3 第 4 条要的效果。
//! - **单个字段坏掉不能拖垮整份配置**（9.3 第 1、2 条）。所以逐字段取值，
//!   取不到就用默认值并记一条问题，而不是让 serde 对整个文件报错。
//! - **解析失败不覆盖用户的原文件**（9.3 第 9 条），改在旁边留一份诊断副本。

use crate::error::AppResult;
use crate::file_io::{save_atomic, ConflictPolicy};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Language {
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
    HighContrast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    Compact,
    #[default]
    Standard,
    Comfortable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IndentMode {
    Tabs,
    #[default]
    Spaces,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    #[default]
    Line,
    Block,
    Underline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CursorBlink {
    #[default]
    Smooth,
    Blink,
    Solid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RenderWhitespace {
    None,
    #[default]
    Selection,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum NewFileLineEnding {
    Crlf,
    #[default]
    Lf,
    Cr,
}

/// 外部工具的 stdin 来源（SPEC F15）。
/// 粘贴图片的落地方式（SPEC F3.4）。未命名文档没有同目录，会回退为内嵌。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PasteImageMode {
    AssetFile,
    InlineBase64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalToolInput {
    Selection,
    Document,
    None,
}

/// 外部工具 stdout 的交付方式。实际替换由前端在同步闸门之后执行。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalToolOutput {
    Replace,
    NewTab,
    Preview,
    None,
}

/// 工作目录只能来自已知的文档或工作区，不接受任意路径（SPEC §10.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalToolCwd {
    FileDir,
    Workspace,
}

/// 保存在 `config.json` 的外部工具定义（SPEC F15）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTool {
    pub name: String,
    pub command: String,
    pub input: ExternalToolInput,
    pub output: ExternalToolOutput,
    pub cwd: ExternalToolCwd,
    pub shortcut: Option<String>,
}

/// 命名的过滤规则组（SPEC F4.7）。
///
/// 颜色只给前端渲染用，后端过滤不看它；放在同一份配置里是为了让
/// 「存一组规则」连同它的配色一起回来。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRuleSpec {
    pub query: String,
    pub mode: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub enabled: bool,
    pub exclude: bool,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRuleGroup {
    pub name: String,
    pub rules: Vec<FilterRuleSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1200,
            height: 780,
            maximized: false,
        }
    }
}

/// SPEC 9.2 schema 中本版本已实现的部分。未列出的字段仍然会在磁盘上原样保留
/// （见本文件开头第一条），只是应用还读不懂它们。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub language: Language,
    pub theme: Theme,
    pub density: Density,
    pub font_family: String,
    pub font_size: u32,
    pub tab_width: u32,
    pub tab_indent_mode: IndentMode,
    pub show_line_numbers: bool,
    pub highlight_current_line: bool,
    pub word_wrap: bool,

    pub line_height: f64,
    pub font_ligatures: bool,
    pub letter_spacing: f64,
    pub cursor_style: CursorStyle,
    pub cursor_blink: CursorBlink,
    pub render_whitespace: RenderWhitespace,
    pub indent_guides: bool,
    pub rulers: Vec<u32>,
    pub sticky_scroll: bool,
    pub breadcrumbs: bool,

    pub new_file_line_ending: NewFileLineEnding,
    pub restore_last_session: bool,

    pub backup_enabled: bool,
    pub backup_idle_ms: u64,
    pub backup_interval_ms: u64,
    pub backup_max_total_bytes: u64,

    pub external_tools: Vec<ExternalTool>,
    pub external_tools_confirmed: Vec<String>,

    pub recent_files: Vec<String>,
    pub find_history: Vec<String>,
    pub replace_history: Vec<String>,
    pub find_reverse: bool,
    pub shortcut_overrides: BTreeMap<String, String>,
    /// 差异对比的开关（SPEC F5.5）。它们是用户对「什么算差异」的长期设定，
    /// 而不是某一个对比标签的临时状态，所以跟配置走而不跟会话走
    pub diff_options: crate::diff::DiffOptions,
    /// Markdown 预览（SPEC F8）
    pub preview_sync_scroll: bool,
    pub preview_block_remote_images: bool,
    pub paste_image_mode: PasteImageMode,
    /// 鼠标手势（SPEC F12）。键是方向序列如 `LR`，值是动作 id
    pub mouse_gestures_enabled: bool,
    pub mouse_gestures: BTreeMap<String, String>,

    /// 更新（SPEC §12.3）。代理串可能带账号密码，只落配置文件，绝不进日志。
    pub update_proxy_server: String,
    pub update_ignore_system_proxy: bool,
    pub auto_check_updates: bool,
    /// Unix 毫秒。配合 `last_seen_version` 做 24 h 节流（SPEC §12.3.3）
    pub last_update_check_at: u64,
    /// 上次启动时的自身版本。与当前版本不符说明刚升级过，此时强制检查。
    pub last_seen_version: String,
    pub skipped_version: String,
    /// 小地图（SPEC §4.1 能力表）。自动隐藏时只在鼠标悬停在编辑区时显示
    pub minimap: bool,
    pub minimap_autohide: bool,
    /// 单实例（SPEC §12.5）。改后需重启生效：插件在 Builder 之前就要决定装不装
    pub single_instance: bool,
    /// 命名过滤规则组（SPEC F4.7），重启后仍可用
    pub filter_rule_groups: Vec<FilterRuleGroup>,
    pub file_tree_width: u32,
    pub window_state: WindowState,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            language: Language::default(),
            theme: Theme::default(),
            density: Density::default(),
            font_family: "JetBrains Mono, Consolas, monospace".to_string(),
            font_size: 14,
            tab_width: 4,
            tab_indent_mode: IndentMode::default(),
            show_line_numbers: true,
            highlight_current_line: true,
            word_wrap: false,

            line_height: 1.55,
            font_ligatures: false,
            letter_spacing: 0.0,
            cursor_style: CursorStyle::default(),
            cursor_blink: CursorBlink::default(),
            render_whitespace: RenderWhitespace::default(),
            indent_guides: true,
            rulers: Vec::new(),
            sticky_scroll: true,
            breadcrumbs: true,

            new_file_line_ending: default_line_ending(),
            restore_last_session: true,

            backup_enabled: true,
            backup_idle_ms: crate::constants::BACKUP_IDLE_MS,
            backup_interval_ms: crate::constants::BACKUP_INTERVAL_MS,
            backup_max_total_bytes: crate::constants::BACKUP_MAX_TOTAL,

            external_tools: Vec::new(),
            external_tools_confirmed: Vec::new(),

            recent_files: Vec::new(),
            find_history: Vec::new(),
            replace_history: Vec::new(),
            find_reverse: false,
            shortcut_overrides: BTreeMap::new(),
            diff_options: crate::diff::DiffOptions::default(),
            preview_sync_scroll: true,
            preview_block_remote_images: false,
            paste_image_mode: PasteImageMode::AssetFile,
            mouse_gestures_enabled: true,
            mouse_gestures: BTreeMap::new(),
            update_proxy_server: String::new(),
            update_ignore_system_proxy: false,
            auto_check_updates: true,
            last_update_check_at: 0,
            last_seen_version: String::new(),
            skipped_version: String::new(),
            minimap: true,
            minimap_autohide: true,
            single_instance: true,
            filter_rule_groups: Vec::new(),
            file_tree_width: 260,
            window_state: WindowState::default(),
        }
    }
}

/// SPEC 9.2 把新建文件的换行符默认值定为「Windows 上 CRLF」。
fn default_line_ending() -> NewFileLineEnding {
    if cfg!(windows) {
        NewFileLineEnding::Crlf
    } else {
        NewFileLineEnding::Lf
    }
}

pub const RECENT_FILES_LIMIT: usize = 12;
pub const FIND_HISTORY_LIMIT: usize = 10;

/// 逐字段取值。取不到就退默认值并记一条问题——**绝不让一个坏字段掀翻整份配置**。
struct Reader<'a> {
    map: &'a Map<String, Value>,
    problems: Vec<String>,
}

impl<'a> Reader<'a> {
    fn new(map: &'a Map<String, Value>) -> Self {
        Self {
            map,
            problems: Vec::new(),
        }
    }

    fn get<T: DeserializeOwned>(&mut self, key: &str, fallback: T) -> T {
        let Some(raw) = self.map.get(key) else {
            return fallback;
        };
        match serde_json::from_value::<T>(raw.clone()) {
            Ok(value) => value,
            Err(_) => {
                // 只记 key，不记值：配置里可能有代理地址一类的东西（AGENTS.md 第 9.2 节）
                self.problems.push(key.to_string());
                fallback
            }
        }
    }

    fn get_clamped<T>(&mut self, key: &str, fallback: T, min: T, max: T) -> T
    where
        T: DeserializeOwned + PartialOrd,
    {
        let value = self.get(key, fallback);
        if value < min {
            min
        } else if value > max {
            max
        } else {
            value
        }
    }

    fn get_capped_list(&mut self, key: &str, limit: usize) -> Vec<String> {
        let mut list = self.get::<Vec<String>>(key, Vec::new());
        list.truncate(limit);
        list
    }
}

/// 解析结果。`problems` 里是回落到默认值的字段名，UI 据此提示用户配置有问题。
#[derive(Debug, Clone)]
pub struct Parsed {
    pub config: Config,
    pub problems: Vec<String>,
}

/// 从一个已解析的 JSON 对象收窄成 `Config`，数值一律钳制（9.3 第 3 条）。
pub fn from_map(map: &Map<String, Value>) -> Parsed {
    let defaults = Config::default();
    let mut reader = Reader::new(map);

    let config = Config {
        language: reader.get("language", defaults.language),
        theme: reader.get("theme", defaults.theme),
        density: reader.get("density", defaults.density),
        font_family: reader.get("fontFamily", defaults.font_family),
        font_size: reader.get_clamped("fontSize", defaults.font_size, 8, 72),
        tab_width: reader.get_clamped("tabWidth", defaults.tab_width, 1, 8),
        tab_indent_mode: reader.get("tabIndentMode", defaults.tab_indent_mode),
        show_line_numbers: reader.get("showLineNumbers", defaults.show_line_numbers),
        highlight_current_line: reader.get("highlightCurrentLine", defaults.highlight_current_line),
        word_wrap: reader.get("wordWrap", defaults.word_wrap),

        line_height: reader.get_clamped("lineHeight", defaults.line_height, 1.0, 2.4),
        font_ligatures: reader.get("fontLigatures", defaults.font_ligatures),
        letter_spacing: reader.get_clamped("letterSpacing", defaults.letter_spacing, -0.5, 1.5),
        cursor_style: reader.get("cursorStyle", defaults.cursor_style),
        cursor_blink: reader.get("cursorBlink", defaults.cursor_blink),
        render_whitespace: reader.get("renderWhitespace", defaults.render_whitespace),
        indent_guides: reader.get("indentGuides", defaults.indent_guides),
        rulers: reader.get("rulers", defaults.rulers),
        sticky_scroll: reader.get("stickyScroll", defaults.sticky_scroll),
        breadcrumbs: reader.get("breadcrumbs", defaults.breadcrumbs),

        new_file_line_ending: reader.get("newFileLineEnding", defaults.new_file_line_ending),
        restore_last_session: reader.get("restoreLastSession", defaults.restore_last_session),

        backup_enabled: reader.get("backupEnabled", defaults.backup_enabled),
        // 下限 200 ms 不是美学取舍：低于它备份写入会盖过输入本身
        backup_idle_ms: reader.get_clamped("backupIdleMs", defaults.backup_idle_ms, 200, 60_000),
        backup_interval_ms: reader.get_clamped(
            "backupIntervalMs",
            defaults.backup_interval_ms,
            1_000,
            600_000,
        ),
        backup_max_total_bytes: reader.get_clamped(
            "backupMaxTotalBytes",
            defaults.backup_max_total_bytes,
            16 * 1024 * 1024,
            8 * 1024 * 1024 * 1024,
        ),

        external_tools: reader.get("externalTools", defaults.external_tools),
        external_tools_confirmed: reader
            .get("externalToolsConfirmed", defaults.external_tools_confirmed),

        recent_files: reader.get_capped_list("recentFiles", RECENT_FILES_LIMIT),
        find_history: reader.get_capped_list("findHistory", FIND_HISTORY_LIMIT),
        replace_history: reader.get_capped_list("replaceHistory", FIND_HISTORY_LIMIT),
        find_reverse: reader.get("findReverse", defaults.find_reverse),
        shortcut_overrides: reader.get("shortcutOverrides", defaults.shortcut_overrides),
        diff_options: reader.get("diffOptions", defaults.diff_options),
        preview_sync_scroll: reader.get("previewSyncScroll", defaults.preview_sync_scroll),
        preview_block_remote_images: reader.get(
            "previewBlockRemoteImages",
            defaults.preview_block_remote_images,
        ),
        paste_image_mode: reader.get("pasteImageMode", defaults.paste_image_mode),
        mouse_gestures_enabled: reader.get("mouseGesturesEnabled", defaults.mouse_gestures_enabled),
        mouse_gestures: reader.get("mouseGestures", defaults.mouse_gestures),
        update_proxy_server: reader.get("updateProxyServer", defaults.update_proxy_server),
        update_ignore_system_proxy: reader.get(
            "updateIgnoreSystemProxy",
            defaults.update_ignore_system_proxy,
        ),
        auto_check_updates: reader.get("autoCheckUpdates", defaults.auto_check_updates),
        last_update_check_at: reader.get("lastUpdateCheckAt", defaults.last_update_check_at),
        last_seen_version: reader.get("lastSeenVersion", defaults.last_seen_version),
        skipped_version: reader.get("skippedVersion", defaults.skipped_version),
        minimap: reader.get("minimap", defaults.minimap),
        minimap_autohide: reader.get("minimapAutohide", defaults.minimap_autohide),
        single_instance: reader.get("singleInstance", defaults.single_instance),
        filter_rule_groups: reader.get("filterRuleGroups", defaults.filter_rule_groups),
        file_tree_width: reader.get_clamped("fileTreeWidth", defaults.file_tree_width, 160, 600),
        window_state: reader.get("windowState", defaults.window_state),
    };

    Parsed {
        config,
        problems: reader.problems,
    }
}

/// 读磁盘上的原始对象。缺失 / 空 / 解析失败一律回空对象，**不阻塞启动**（9.3 第 1 条）。
///
/// 解析失败时把原文件复制一份到 `config.invalid-<毫秒>.json` 再返回空对象——
/// 原文件本身一个字节都不动，后面的写入会覆盖它，但用户手上还留着副本（9.3 第 9 条）。
pub fn read_raw(path: &Path) -> (Map<String, Value>, Option<PathBuf>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (Map::new(), None);
    };
    if text.trim().is_empty() {
        return (Map::new(), None);
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => (map, None),
        _ => (Map::new(), quarantine(path, &text)),
    }
}

fn quarantine(path: &Path, text: &str) -> Option<PathBuf> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = path.with_file_name(format!("config.invalid-{stamp}.json"));
    match std::fs::write(&target, text) {
        Ok(()) => {
            log::warn!("配置解析失败，已保留诊断副本，本次使用默认值");
            Some(target)
        }
        Err(_) => {
            log::warn!("配置解析失败且诊断副本写入失败，本次使用默认值");
            None
        }
    }
}

/// 把补丁合并进磁盘上的对象。**顶层逐键覆盖，不做深合并**：
/// 深合并会让「把 rulers 改成空数组」这种意图无法表达。
pub fn merge(base: &Map<String, Value>, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = base.clone();
    for (key, value) in patch {
        merged.insert(key.clone(), value.clone());
    }
    merged
}

/// 写配置。走与保存文档同一条原子写路径（9.3 第 5 条），所以写到一半断电
/// 也只会留下原文件或新文件之一，不会留下半截的。
pub fn write_raw(path: &Path, map: &Map<String, Value>) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut bytes = serde_json::to_vec_pretty(map).unwrap_or_else(|_| b"{}".to_vec());
    bytes.push(b'\n');
    save_atomic(path, &bytes, None, ConflictPolicy::Overwrite)?;
    Ok(())
}

/// 两份配置之间实际变了哪些顶层键。热重载事件要带上它，
/// 前端才知道该不该重建编辑器（SPEC 9.3 第 7 条）。
pub fn changed_keys(before: &Map<String, Value>, after: &Map<String, Value>) -> Vec<String> {
    let mut keys: Vec<String> = before
        .keys()
        .chain(after.keys())
        .filter(|key| before.get(*key) != after.get(*key))
        .cloned()
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_of(json: &str) -> Map<String, Value> {
        match serde_json::from_str::<Value>(json) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn missing_file_yields_defaults_without_failing() {
        let dir = tempfile::tempdir().expect("临时目录");
        let (raw, quarantined) = read_raw(&dir.path().join(CONFIG_FILE));
        assert!(raw.is_empty());
        assert!(quarantined.is_none());
        assert_eq!(from_map(&raw).config, Config::default());
    }

    // SPEC 9.3 第 1、2 条：一个字段写错不该让其余配置一起失效
    #[test]
    fn one_broken_field_does_not_discard_the_rest() {
        let raw = map_of(r#"{ "fontSize": "abc", "theme": "dark" }"#);
        let parsed = from_map(&raw);

        assert_eq!(parsed.config.font_size, Config::default().font_size);
        assert_eq!(parsed.config.theme, Theme::Dark);
        assert_eq!(parsed.problems, vec!["fontSize"]);
    }

    #[test]
    fn unknown_enum_value_falls_back_and_is_reported() {
        let parsed = from_map(&map_of(r#"{ "density": "gigantic" }"#));

        assert_eq!(parsed.config.density, Density::Standard);
        assert_eq!(parsed.problems, vec!["density"]);
    }

    #[test]
    fn numbers_are_clamped_to_the_legal_range() {
        assert_eq!(
            from_map(&map_of(r#"{ "fontSize": 999 }"#)).config.font_size,
            72
        );
        assert_eq!(
            from_map(&map_of(r#"{ "fontSize": 1 }"#)).config.font_size,
            8
        );
        assert_eq!(
            from_map(&map_of(r#"{ "tabWidth": 0 }"#)).config.tab_width,
            1
        );
        assert_eq!(
            from_map(&map_of(r#"{ "lineHeight": 9.0 }"#))
                .config
                .line_height,
            2.4
        );
    }

    #[test]
    fn recent_files_are_capped() {
        let entries: Vec<String> = (0..40).map(|i| format!("f{i}")).collect();
        let raw = map_of(&serde_json::json!({ "recentFiles": entries }).to_string());

        assert_eq!(from_map(&raw).config.recent_files.len(), RECENT_FILES_LIMIT);
    }

    #[test]
    fn find_and_replace_history_are_capped() {
        let entries: Vec<String> = (0..40).map(|index| format!("entry-{index}")).collect();
        let raw = map_of(
            &serde_json::json!({ "findHistory": entries, "replaceHistory": entries }).to_string(),
        );

        let config = from_map(&raw).config;
        assert_eq!(config.find_history.len(), FIND_HISTORY_LIMIT);
        assert_eq!(config.replace_history.len(), FIND_HISTORY_LIMIT);
    }

    #[test]
    fn find_reverse_is_read_as_a_boolean_setting() {
        let config = from_map(&map_of(r#"{ "findReverse": true }"#)).config;

        assert!(config.find_reverse);
    }

    #[test]
    fn shortcut_overrides_are_loaded_as_a_string_map() {
        let config = from_map(&map_of(
            r#"{ "shortcutOverrides": { "file.save": "Ctrl+Shift+S" } }"#,
        ))
        .config;

        assert_eq!(
            config.shortcut_overrides.get("file.save"),
            Some(&"Ctrl+Shift+S".to_string())
        );
    }

    #[test]
    fn external_tool_configuration_is_loaded_as_a_typed_model() {
        let raw = map_of(
            r#"{
                "externalTools": [{
                    "name": "format",
                    "command": "formatter --stdin",
                    "input": "selection",
                    "output": "replace",
                    "cwd": "fileDir",
                    "shortcut": "Ctrl+Alt+F"
                }],
                "externalToolsConfirmed": ["format"]
            }"#,
        );
        let config = from_map(&raw).config;

        assert_eq!(config.external_tools.len(), 1);
        assert_eq!(config.external_tools[0].input, ExternalToolInput::Selection);
        assert_eq!(config.external_tools[0].output, ExternalToolOutput::Replace);
        assert_eq!(config.external_tools[0].cwd, ExternalToolCwd::FileDir);
        assert_eq!(config.external_tools_confirmed, vec!["format"]);
    }

    // SPEC 9.3 第 4 条：本版本读不懂的字段也必须原样留在磁盘上
    #[test]
    fn unknown_fields_survive_a_write() {
        let base = map_of(r#"{ "externalTools": [{"name":"grep"}], "theme": "light" }"#);
        let merged = merge(&base, &map_of(r#"{ "theme": "dark" }"#));

        assert!(merged.contains_key("externalTools"));
        assert_eq!(merged["theme"], Value::String("dark".into()));
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(CONFIG_FILE);
        let map = map_of(r#"{ "theme": "dark", "fontSize": 18 }"#);

        write_raw(&path, &map).expect("写配置");
        let (raw, _) = read_raw(&path);

        assert_eq!(from_map(&raw).config.theme, Theme::Dark);
        assert_eq!(from_map(&raw).config.font_size, 18);
    }

    // SPEC 9.3 第 9 条：坏掉的配置要留证据，不能悄悄吞掉
    #[test]
    fn unparsable_file_is_quarantined_not_overwritten() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(CONFIG_FILE);
        std::fs::write(&path, "{ this is not json").expect("写坏配置");

        let (raw, quarantined) = read_raw(&path);

        assert!(raw.is_empty());
        let copy = quarantined.expect("应留下诊断副本");
        assert_eq!(
            std::fs::read_to_string(copy).expect("读副本"),
            "{ this is not json"
        );
        assert_eq!(
            std::fs::read_to_string(&path).expect("原文件"),
            "{ this is not json",
            "原文件必须一个字节都不动"
        );
    }

    #[test]
    fn empty_file_is_not_treated_as_corruption() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(CONFIG_FILE);
        std::fs::write(&path, "   \n").expect("写空配置");

        let (raw, quarantined) = read_raw(&path);

        assert!(raw.is_empty());
        assert!(quarantined.is_none(), "空文件是首次启动的常态，不是损坏");
    }

    #[test]
    fn changed_keys_lists_both_added_and_removed() {
        let before = map_of(r#"{ "theme": "light", "wordWrap": true }"#);
        let after = map_of(r#"{ "theme": "dark", "fontSize": 16 }"#);

        assert_eq!(
            changed_keys(&before, &after),
            vec!["fontSize", "theme", "wordWrap"]
        );
    }

    #[test]
    fn changed_keys_is_empty_for_an_identical_map() {
        let map = map_of(r#"{ "theme": "dark" }"#);
        assert!(changed_keys(&map, &map).is_empty());
    }
}
