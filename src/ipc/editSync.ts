/**
 * 编辑同步队列（SPEC P1 同步契约 / ADR-03）。
 *
 * 1. 编辑先在本地应用，增量推入发送队列
 * 2. 队列以 16 ms 窗口合并，异步下发，不 await
 * 3. 每批携带 baseVersion；Rust 校验连续性，失配回 resync
 * 4. 任何以 Rust 为准的操作前必须 flush 并等待确认
 * 5. IME 组合期间不下发
 */
import type { ChangeSet } from '@codemirror/state';

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** 与 Rust `EditOrigin` 一致；决定撤销栈怎么合并这一批。 */
export type BatchOrigin =
  | 'typing'
  | 'deleting'
  | 'paste'
  | 'bulkDelete'
  | 'format'
  | 'replace'
  | 'other';

export interface EditBatch {
  docId: string;
  baseVersion: number;
  seq: number;
  changes: Change[];
  origin: BatchOrigin;
  selectionBefore?: TextSelection;
  selectionAfter?: TextSelection;
}

export interface TextSelection {
  anchor: number;
  head: number;
}

export type RejectReason = 'version_mismatch' | 'gap' | 'out_of_range';

export interface ApplyResult {
  ok: boolean;
  reason?: RejectReason;
  serverVersion: number;
}

export type SyncStatus = 'idle' | 'pending' | 'resyncing';

export interface EditSyncTransport {
  apply(batch: EditBatch): Promise<ApplyResult>;
  /** 前端全量重放（Tier A/B）。返回 resync 后的服务端版本。 */
  resync(docId: string, text: string, seq: number): Promise<number>;
}

export interface EditSyncOptions {
  docId: string;
  initialVersion?: number;
  transport: EditSyncTransport;
  /** 取前端当前全文，仅在 resync 时调用。 */
  readText: () => string;
  coalesceWindowMs?: number;
  onStatusChange?: (status: SyncStatus) => void;
}

export const COALESCE_WINDOW_MS = 16;

export class EditSyncQueue {
  private pending: ChangeSet | null = null;
  private pendingOrigin: BatchOrigin | null = null;
  private pendingSelectionBefore: TextSelection | undefined;
  private pendingSelectionAfter: TextSelection | undefined;
  private seq = 0;
  private version: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private composing = false;
  private compositionWaiters: Array<() => void> = [];
  private status: SyncStatus = 'idle';
  private disposed = false;

  constructor(private readonly options: EditSyncOptions) {
    this.version = options.initialVersion ?? 0;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getVersion(): number {
    return this.version;
  }

  /** 撤销、重做或磁盘重载已经在 Rust 上提交；后续本地增量以该版本为基准。 */
  acceptExternalVersion(version: number): void {
    if (this.pending !== null || this.inFlight !== null)
      throw new Error('Cannot replace edit version while synchronization is pending');
    this.version = version;
  }

  /** 本地已应用的编辑推入队列；调用方不等待。 */
  push(
    changes: ChangeSet,
    origin: BatchOrigin = 'other',
    selectionBefore?: TextSelection,
    selectionAfter?: TextSelection,
  ): void {
    if (this.disposed || changes.empty) return;
    if (this.pending === null) this.pendingSelectionBefore = selectionBefore;
    this.pendingSelectionAfter = selectionAfter;
    // 后续事务的坐标基于前一事务的新正文；Rust 要求整批都基于同一份旧正文。
    this.pending = this.pending ? this.pending.compose(changes) : changes;
    // 一批里混了不同类型时退到 other：宁可让撤销多分一步，
    // 也不能把一次粘贴混进逐字输入里合并掉
    this.pendingOrigin =
      this.pendingOrigin === null || this.pendingOrigin === origin ? origin : 'other';
    this.setStatus('pending');
    this.schedule();
  }

  /** IME 组合期间不下发，组合结束后一次性下发（SPEC P1 契约第 5 条）。 */
  setComposing(composing: boolean): void {
    if (this.composing === composing) return;
    this.composing = composing;
    if (!composing) {
      for (const resolve of this.compositionWaiters.splice(0)) resolve();
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer !== null || this.composing || this.disposed) return;
    const window = this.options.coalesceWindowMs ?? COALESCE_WINDOW_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, window);
  }

  /**
   * 以 Rust 为准的操作（保存 / 查找 / 替换 / 格式化 / 差异 / 大纲）执行前
   * 必须调用它并等待确认（SPEC P1 契约第 4 条）。
   */
  async flush(): Promise<void> {
    if (this.disposed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.waitForCompositionEnd();
    while (this.pending !== null) {
      // `send()` 在组合期间会正确地拒绝发送。之前这里会立刻返回后进入下一轮
      // while，导致按 Enter 直接提交拼音时忙等并卡死 WebView。
      await this.waitForCompositionEnd();
      await this.inFlight;
      await this.send();
    }
    await this.inFlight;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.pendingSelectionBefore = undefined;
    this.pendingSelectionAfter = undefined;
    for (const resolve of this.compositionWaiters.splice(0)) resolve();
  }

  private waitForCompositionEnd(): Promise<void> {
    if (!this.composing || this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.compositionWaiters.push(resolve));
  }

  private async send(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
    }
    if (this.pending === null || this.composing || this.disposed) {
      if (this.pending === null) this.setStatus('idle');
      return;
    }

    const changes: Change[] = [];
    this.pending.iterChanges((from, to, _fromNew, _toNew, insert) => {
      changes.push({ from, to, insert: insert.toString() });
    });
    if (changes.length === 0) {
      this.pending = null;
      this.pendingOrigin = null;
      this.pendingSelectionBefore = undefined;
      this.pendingSelectionAfter = undefined;
      this.setStatus('idle');
      return;
    }

    const batch: EditBatch = {
      docId: this.options.docId,
      baseVersion: this.version,
      seq: ++this.seq,
      changes,
      origin: this.pendingOrigin ?? 'other',
      selectionBefore: this.pendingSelectionBefore,
      selectionAfter: this.pendingSelectionAfter,
    };
    this.pending = null;
    this.pendingOrigin = null;
    this.pendingSelectionBefore = undefined;
    this.pendingSelectionAfter = undefined;

    this.inFlight = (async () => {
      const result = await this.options.transport.apply(batch);
      if (result.ok) {
        this.version = result.serverVersion;
        if (this.pending === null) this.setStatus('idle');
        return;
      }
      // 版本失配 / 断档：唯一正确的出路是全量重放（SPEC P1 契约第 3 条）
      this.setStatus('resyncing');
      const text = this.options.readText();
      this.version = await this.options.transport.resync(this.options.docId, text, batch.seq);
      this.pending = null;
      this.pendingOrigin = null;
      this.pendingSelectionBefore = undefined;
      this.pendingSelectionAfter = undefined;
      this.setStatus('idle');
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}

/** 把同一批内的多点编辑按倒序排列——正序应用会移动后面的坐标。 */
export function sortChangesDescending(changes: Change[]): Change[] {
  return [...changes].sort((a, b) => b.from - a.from);
}

/**
 * 前端侧的参考实现，与 Rust 的 apply 语义必须一致。
 *
 * 坐标是 char（码点）偏移，不是 UTF-16 code unit —— 直接用 String.slice
 * 会在 emoji / 代理对上错位，这正是 SPEC §13.1.1 第 1 条要求 proptest 的地方。
 */
export function applyChanges(text: string, changes: Change[]): string {
  let chars = Array.from(text);
  for (const change of sortChangesDescending(changes)) {
    chars = [...chars.slice(0, change.from), ...Array.from(change.insert), ...chars.slice(change.to)];
  }
  return chars.join('');
}
