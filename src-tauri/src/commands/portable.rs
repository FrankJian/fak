//! 配置片段的导入 / 导出（SPEC §3.6、F4.7、F15）。
//!
//! 刻意**不做**通用的「读写任意文件」命令：那等于给前端开一个任意路径读写的口子。
//! 每种可搬运的数据各有一对命令，形状由 serde 校验，坏文件在这里就被拒掉，
//! 不会以「一半导进去了」的状态落到配置里。

use crate::config::{ExternalTool, FilterRuleGroup};
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// 导入文件的大小上限。这些都是几 KB 的配置片段，
/// 几十 MB 的「配置」只可能是选错了文件。
const MAX_IMPORT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathArgs {
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportToolsArgs {
    pub path: PathBuf,
    pub tools: Vec<ExternalTool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRuleGroupsArgs {
    pub path: PathBuf,
    pub groups: Vec<FilterRuleGroup>,
}

fn read_small(path: &Path) -> AppResult<String> {
    let metadata = std::fs::metadata(path).map_err(|error| AppError::from_io(&error, path))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(AppError::FileTooLarge {
            size_bytes: metadata.len(),
            limit_bytes: MAX_IMPORT_BYTES,
        });
    }
    std::fs::read_to_string(path).map_err(|error| AppError::from_io(&error, path))
}

fn parse<T: serde::de::DeserializeOwned>(text: &str, kind: &str) -> AppResult<T> {
    serde_json::from_str(text).map_err(|error| AppError::SyntaxInvalid {
        syntax: kind.to_string(),
        line: error.line(),
        column: error.column(),
        detail: error.to_string(),
    })
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value).map_err(|_| AppError::Io { os_code: None })?;
    std::fs::write(path, text).map_err(|error| AppError::from_io(&error, path))
}

#[tauri::command]
pub fn export_external_tools(args: ExportToolsArgs) -> AppResult<()> {
    write_json(&args.path, &args.tools)
}

#[tauri::command]
pub fn import_external_tools(args: PathArgs) -> AppResult<Vec<ExternalTool>> {
    parse(&read_small(&args.path)?, "externalTools")
}

#[tauri::command]
pub fn export_filter_rule_groups(args: ExportRuleGroupsArgs) -> AppResult<()> {
    write_json(&args.path, &args.groups)
}

#[tauri::command]
pub fn import_filter_rule_groups(args: PathArgs) -> AppResult<Vec<FilterRuleGroup>> {
    parse(&read_small(&args.path)?, "filterRuleGroups")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_external_tools() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("tools.json");
        let tools = vec![ExternalTool {
            name: "fmt".into(),
            command: "prettier --stdin".into(),
            input: crate::config::ExternalToolInput::Selection,
            output: crate::config::ExternalToolOutput::Replace,
            cwd: crate::config::ExternalToolCwd::FileDir,
            shortcut: None,
        }];

        export_external_tools(ExportToolsArgs {
            path: path.clone(),
            tools: tools.clone(),
        })
        .expect("导出");

        let imported = import_external_tools(PathArgs { path }).expect("导入");
        assert_eq!(imported, tools);
    }

    #[test]
    fn a_malformed_file_is_rejected_with_a_position() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("tools.json");
        std::fs::write(&path, "[{\n  \"name\": }]").expect("写");

        let error = import_external_tools(PathArgs { path }).expect_err("应拒绝");
        assert!(matches!(error, AppError::SyntaxInvalid { .. }));
    }

    #[test]
    fn a_file_of_the_wrong_shape_is_rejected() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("tools.json");
        std::fs::write(&path, r#"{"not":"a list"}"#).expect("写");

        assert!(import_external_tools(PathArgs { path }).is_err());
    }
}
