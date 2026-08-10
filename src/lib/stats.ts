/** 性能打点用的小工具。基准与原型都用它算 P95（SPEC §8.1 全是 P95 口径）。 */

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

export function average(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((total, value) => total + value, 0) / samples.length;
}

/** 滑动窗口计数器：用于验证「invoke 频率 ≤ 60 次/秒」（SPEC §3.5）。 */
export class RateCounter {
  private timestamps: number[] = [];

  constructor(private readonly windowMs = 1000) {}

  tick(now = performance.now()): number {
    this.timestamps.push(now);
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }

  peak = 0;

  record(now = performance.now()): number {
    const rate = this.tick(now);
    if (rate > this.peak) this.peak = rate;
    return rate;
  }

  reset(): void {
    this.timestamps = [];
    this.peak = 0;
  }
}
