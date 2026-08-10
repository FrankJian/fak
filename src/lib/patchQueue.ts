/**
 * 配置写入的防抖队列（SPEC 9.3 第 6 条）。
 *
 * 拖动字号滑块会在一秒内产出几十次变更，每次都原子写一遍配置文件是纯粹的
 * 浪费。队列把窗口内的补丁**按键合并**成一次写入：后来的同名键覆盖先前的，
 * 不同键并存——所以「先改主题再改字号」不会让主题那次丢掉。
 */
export const CONFIG_WRITE_DEBOUNCE_MS = 200;

export class PatchQueue<T extends object> {
  private pending: Partial<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly write: (patch: Partial<T>) => Promise<unknown>,
    private readonly delayMs: number = CONFIG_WRITE_DEBOUNCE_MS,
  ) {}

  push(patch: Partial<T>): void {
    this.pending = { ...this.pending, ...patch };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** 退出前必须调用，否则最后 200 ms 内的设置改动永远落不了盘。 */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
    const patch = this.pending;
    this.pending = null;
    if (patch === null) return;

    // 写入期间到来的补丁进入下一个 pending，不会被这次写入吞掉
    this.inFlight = this.write(patch).then(() => undefined);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  hasPending(): boolean {
    return this.pending !== null;
  }
}
