//! 小地图的行长度密度（SPEC §181、§4.1 能力表）。
//!
//! **桶化在 Rust 侧做**：一份 8 MiB 文档有十万量级的行，逐行长度回传会远远超过
//! 256 KiB 的单次 IPC 上限（SPEC §3.5）。这里直接压成「每像素一格」，
//! 回传量只与画布高度有关，与文件大小无关。
//!
//! 只有 Tier A 需要密度：SPEC 的能力表规定 Tier B/C 的小地图不渲染文本，
//! 只画差异 / 匹配标记，那些数据前端本来就有。

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::state::{AppState, DocumentMode};

/// 画布高度上限。再高也没有信息量，纯粹浪费扫描时间与 IPC 负载。
const MAX_BUCKETS: usize = 2_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapArgs {
    pub document_id: String,
    /// 画布像素高度，即桶数
    pub buckets: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapDensity {
    /// 每个桶内最长行的相对长度，0..=255。空表示该档位不渲染文本
    pub buckets: Vec<u8>,
}

/// 桶内取最大值而不是平均：平均会把一整块里的那条超长行抹平，
/// 而小地图的用处正是让人一眼找到它。
fn bucketize(lengths: &[usize], buckets: usize) -> Vec<u8> {
    if buckets == 0 || lengths.is_empty() {
        return Vec::new();
    }
    let longest = lengths.iter().copied().max().unwrap_or(0).max(1);
    let mut out = vec![0u8; buckets];
    for (line, length) in lengths.iter().enumerate() {
        let slot = (line * buckets) / lengths.len();
        let slot = slot.min(buckets - 1);
        let value = ((*length * 255) / longest) as u8;
        out[slot] = out[slot].max(value);
    }
    out
}

#[tauri::command]
pub fn minimap_density(
    args: MinimapArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<MinimapDensity> {
    let document =
        state
            .documents
            .get(&args.document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: args.document_id.clone(),
            })?;
    let document = document
        .read()
        .map_err(|_| AppError::Io { os_code: None })?;

    // 档位表在这里落地：B/C 返回空，前端据此只画标记
    if document.mode != DocumentMode::Full {
        return Ok(MinimapDensity {
            buckets: Vec::new(),
        });
    }

    let buckets = args.buckets.min(MAX_BUCKETS);
    let lengths: Vec<usize> = document
        .rope
        .lines()
        .map(|line| line.len_chars().saturating_sub(1))
        .collect();

    Ok(MinimapDensity {
        buckets: bucketize(&lengths, buckets),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 按最长行归一() {
        assert_eq!(bucketize(&[10, 20, 40], 3), vec![63, 127, 255]);
    }

    #[test]
    fn 桶内取最大值而不是平均() {
        assert_eq!(bucketize(&[1, 1, 100], 1), vec![255]);
    }

    #[test]
    fn 行数少于桶数时桶数不变() {
        assert_eq!(bucketize(&[5, 10], 8).len(), 8);
    }

    #[test]
    fn 空输入与零桶都不panic() {
        assert!(bucketize(&[], 10).is_empty());
        assert!(bucketize(&[1, 2, 3], 0).is_empty());
    }

    #[test]
    fn 全空行不除零() {
        assert_eq!(bucketize(&[0, 0, 0], 3), vec![0, 0, 0]);
    }

    #[test]
    fn 最后一行不会越界到桶外() {
        let lengths: Vec<usize> = (0..1000).map(|_| 10).collect();
        assert_eq!(bucketize(&lengths, 7).len(), 7);
    }
}
