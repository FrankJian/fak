/**
 * Tier A 的行长度密度（SPEC §181）。
 *
 * 桶化在 Rust 侧做，这里只负责在文档或画布高度变化时重取。
 * Tier B/C 返回空数组——它们的小地图按 SPEC §4.1 只画标记。
 */
import { useEffect, useState } from "react";
import { minimapDensity } from "../ipc/minimap";
import { isTauriAvailable } from "../ipc/invoke";
import { logger } from "../lib/logger";

/** 共用同一个空数组：每次渲染新建会让小地图的绘制 effect 反复重跑。 */
const EMPTY: number[] = [];

export function useMinimapDensity(
  documentId: string,
  documentVersion: number,
  buckets: number,
  enabled: boolean,
): readonly number[] {
  const [density, setDensity] = useState<number[]>(EMPTY);
  const active = enabled && buckets > 0 && isTauriAvailable();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void minimapDensity(documentId, buckets)
      .then((result) => {
        if (cancelled) return;
        // Rust 回传 0..255，画布要 0..1
        setDensity(result.buckets.map((value) => value / 255));
      })
      .catch((error: unknown) => logger.warn("minimap density failed", error));
    return () => {
      cancelled = true;
    };
  }, [active, documentId, documentVersion, buckets]);

  // 关掉时直接给空，不必在 effect 里回写 state
  return active ? density : EMPTY;
}
