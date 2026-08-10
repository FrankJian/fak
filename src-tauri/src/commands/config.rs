//! 配置读写命令（SPEC 9.3）。
//!
//! `ConfigStore` 持有磁盘上那份原始 JSON 对象。之所以缓存原始对象而不只缓存
//! `Config`，是因为写入要在它之上打补丁——不这么做，本版本读不懂的字段
//! （外部工具、快捷键覆盖……）会在第一次保存设置时被清空（9.3 第 4 条）。

use crate::config::{self, Config};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 外部修改热重载事件（SPEC 3.7 事件表 / 9.3 第 7 条）。
pub const CONFIG_RELOADED_EVENT: &str = "app://config-reloaded";

/// 自写之后多久内的文件事件算作回环。
///
/// 原子写是「写临时文件 + rename」，在 Windows 上至少产出两次事件，且落在
/// 写入返回之后。窗口太短会把自己的写当成外部修改，触发一轮无谓的热重载。
const SELF_WRITE_QUIET: Duration = Duration::from_millis(600);

pub struct ConfigStore {
    path: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    raw: Map<String, Value>,
    last_self_write: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub config: Config,
    /// 回落到默认值的字段名。UI 据此提示「配置里有几项没读懂」
    pub problems: Vec<String>,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReloaded {
    pub config: Config,
    pub changed_keys: Vec<String>,
}

impl ConfigStore {
    /// 立刻读一次盘。配置要在第一帧渲染前就位，否则会先闪一下默认主题。
    pub fn load(path: PathBuf) -> Self {
        let (raw, quarantined) = config::read_raw(&path);
        if quarantined.is_some() {
            log::warn!("配置文件无法解析，已改用默认值并留下诊断副本");
        }
        Self {
            path,
            inner: Mutex::new(Inner {
                raw,
                last_self_write: None,
            }),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| AppError::Io { os_code: None })
    }

    pub fn snapshot(&self) -> AppResult<ConfigSnapshot> {
        let parsed = config::from_map(&self.lock()?.raw);
        Ok(ConfigSnapshot {
            config: parsed.config,
            problems: parsed.problems,
            path: self.path.clone(),
        })
    }

    /// 把补丁合并进磁盘上的对象并原子写回。
    pub fn apply_patch(&self, patch: &Map<String, Value>) -> AppResult<Config> {
        let mut inner = self.lock()?;
        let merged = config::merge(&inner.raw, patch);
        config::write_raw(&self.path, &merged)?;
        inner.raw = merged;
        inner.last_self_write = Some(Instant::now());
        Ok(config::from_map(&inner.raw).config)
    }

    /// 文件监听回调调用。返回 `None` 表示这次变更该忽略（是回环，或内容没变）。
    pub fn reload_if_external(&self) -> AppResult<Option<ConfigReloaded>> {
        let mut inner = self.lock()?;
        if inner
            .last_self_write
            .is_some_and(|at| at.elapsed() < SELF_WRITE_QUIET)
        {
            return Ok(None);
        }

        let (raw, _) = config::read_raw(&self.path);
        let changed_keys = config::changed_keys(&inner.raw, &raw);
        if changed_keys.is_empty() {
            return Ok(None);
        }

        inner.raw = raw;
        log::info!("配置被外部修改，热重载 {} 项", changed_keys.len());
        Ok(Some(ConfigReloaded {
            config: config::from_map(&inner.raw).config,
            changed_keys,
        }))
    }
}

#[tauri::command]
pub fn read_config(store: tauri::State<'_, ConfigStore>) -> AppResult<ConfigSnapshot> {
    store.snapshot()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteConfigArgs {
    /// 只含本次要改的键。**不是整份配置**——整份提交会把并发的另一处改动覆盖掉
    pub patch: Map<String, Value>,
}

#[tauri::command]
pub fn write_config(
    args: WriteConfigArgs,
    store: tauri::State<'_, ConfigStore>,
) -> AppResult<Config> {
    store.apply_patch(&args.patch)
}

/// 「以文件方式打开配置」需要它（SPEC 9.3 第 8 条）。
#[tauri::command]
pub fn config_file_path(store: tauri::State<'_, ConfigStore>) -> AppResult<PathBuf> {
    Ok(store.path().to_path_buf())
}

/// 「关于」里的「打开日志目录」需要它（SPEC F11 分组 K）。
///
/// 只回目录，不回具体文件：日志按天分片，用户要的是那个目录。
#[tauri::command]
pub fn log_directory(app: tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_log_dir()
        .map_err(|_| AppError::Io { os_code: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &tempfile::TempDir) -> ConfigStore {
        ConfigStore::load(dir.path().join(config::CONFIG_FILE))
    }

    fn patch(json: &str) -> Map<String, Value> {
        match serde_json::from_str::<Value>(json) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn a_missing_config_file_still_gives_a_usable_snapshot() {
        let dir = tempfile::tempdir().expect("临时目录");
        let snapshot = store_in(&dir).snapshot().expect("快照");

        assert_eq!(snapshot.config, Config::default());
        assert!(snapshot.problems.is_empty());
    }

    #[test]
    fn a_patch_is_persisted_and_visible_to_the_next_load() {
        let dir = tempfile::tempdir().expect("临时目录");
        let store = store_in(&dir);

        store
            .apply_patch(&patch(r#"{ "theme": "dark" }"#))
            .expect("写补丁");

        let reloaded = store_in(&dir).snapshot().expect("快照");
        assert_eq!(reloaded.config.theme, crate::config::Theme::Dark);
    }

    #[test]
    fn a_patch_does_not_clear_fields_this_version_cannot_read() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(config::CONFIG_FILE);
        std::fs::write(&path, r#"{ "externalTools": [{"name":"grep"}] }"#).expect("写初始配置");

        let store = ConfigStore::load(path.clone());
        store
            .apply_patch(&patch(r#"{ "theme": "dark" }"#))
            .expect("写补丁");

        let text = std::fs::read_to_string(&path).expect("读回配置");
        assert!(text.contains("externalTools"), "未实现的字段被写掉了");
    }

    #[test]
    fn our_own_write_does_not_trigger_a_reload() {
        let dir = tempfile::tempdir().expect("临时目录");
        let store = store_in(&dir);

        store
            .apply_patch(&patch(r#"{ "theme": "dark" }"#))
            .expect("写补丁");

        assert!(store.reload_if_external().expect("重载判定").is_none());
    }

    #[test]
    fn an_external_edit_reloads_and_reports_the_changed_keys() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(config::CONFIG_FILE);
        let store = ConfigStore::load(path.clone());
        std::fs::write(&path, r#"{ "theme": "dark", "fontSize": 20 }"#).expect("外部改写");

        let reloaded = store
            .reload_if_external()
            .expect("重载判定")
            .expect("应触发重载");

        assert_eq!(reloaded.changed_keys, vec!["fontSize", "theme"]);
        assert_eq!(reloaded.config.font_size, 20);
    }

    #[test]
    fn touching_the_file_without_changing_it_does_not_reload() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(config::CONFIG_FILE);
        std::fs::write(&path, r#"{ "theme": "dark" }"#).expect("写初始配置");
        let store = ConfigStore::load(path.clone());

        std::fs::write(&path, r#"{  "theme"  :  "dark"  }"#).expect("只改排版");

        assert!(store.reload_if_external().expect("重载判定").is_none());
    }

    // SPEC 9.3 第 1 条：坏配置不阻塞启动，且用户改回来之后能立刻恢复
    #[test]
    fn a_broken_file_degrades_to_defaults_and_recovers_on_the_next_edit() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join(config::CONFIG_FILE);
        std::fs::write(&path, "{ broken").expect("写坏配置");

        let store = ConfigStore::load(path.clone());
        assert_eq!(store.snapshot().expect("快照").config, Config::default());

        std::fs::write(&path, r#"{ "theme": "light" }"#).expect("用户改好了");
        let reloaded = store
            .reload_if_external()
            .expect("重载判定")
            .expect("应触发重载");

        assert_eq!(reloaded.config.theme, crate::config::Theme::Light);
    }
}
