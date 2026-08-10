/**
 * 小地图数据的 IPC 封装（AGENTS.md §5.2）。
 */
import { invoke } from "./invoke";

export interface MinimapDensity {
  /** 每桶最长行的相对长度，0..=255；空表示该档位不渲染文本 */
  buckets: number[];
}

export function minimapDensity(
  documentId: string,
  buckets: number,
): Promise<MinimapDensity> {
  return invoke<MinimapDensity>("minimap_density", {
    args: { documentId, buckets },
  });
}
