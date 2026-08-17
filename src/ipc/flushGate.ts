/**
 * flush 闸门（SPEC P1 同步契约第 4 条 / AGENTS.md 第 6 节）。
 *
 * 以 Rust 为准的命令必须等编辑增量全部落到 Rust 之后才执行。这件事
 * **不能靠调用点自觉**：每加一个命令就多一个漏的机会，而漏掉的表现是
 * 「保存下来的文件少了最后敲的几个字」——事后才发现，且无从追查。
 * 所以闸门做在 invoke 的唯一入口上。
 *
 * 关键取舍：**默认拦截，白名单豁免**。反过来做（默认放行、黑名单拦截）
 * 意味着以后每加一条命令都要记得登记，那和「靠自觉」没有区别。
 * 现在忘记登记的后果是多一次空转的 flush，不是丢数据。
 */

/**
 * 不经闸门的命令。只有两类够格：
 *
 * 1. **队列自身的下发通道**——拦它们会自锁（flush 里再触发 flush）
 * 2. **与当前文档正文无关的命令**——读元数据、开新文档、写日志
 */
const FLUSH_EXEMPT: ReadonlySet<string> = new Set([
  "apply_edits",
  "resync",

  "open_file",
  "new_document",
  "close_document",
  "take_startup_paths",
  "list_encodings",
  "log_message",

  "pending_backups",
  "recover_backup",
  "discard_backup",
  "discard_all_backups",
  "mark_clean_exit",

  "read_config",
  "write_config",
  "config_file_path",

  // 查找与差异的会话记账，不读正文。取消尤其不能等 flush：等得起就不叫取消了
  "dispose_search",
  "cancel_search",
  "dispose_diff",
  "cancel_diff",

  // 会话只记路径与行号，不读正文。`save_session` 还跑在关窗口的路径上，
  // 在那里等 flush 会把退出流程卡在一次可能失败的同步上
  "save_session",
  "restore_session",
]);

export type FlushFn = () => Promise<void>;

/**
 * 已挂载的编辑器。**是一个集合而不是一个**：差异视图两侧各是一个真实编辑器
 * （SPEC F5.2），只记住最后登记的那个，另一侧未下发的增量就会被 `start_diff`
 * 越过去，算出来的差异比屏幕上看到的旧一拍。
 */
const flushes = new Set<FlushFn>();
type SyncStatus = "idle" | "pending" | "resyncing";
const syncStatuses = new Map<FlushFn, SyncStatus>();
const convergenceWaiters: Array<() => void> = [];

/** 编辑器挂载时登记自己的 flush，卸载时用 `clearEditFlush` 撤销。 */
export function setEditFlush(flush: FlushFn): void {
  flushes.add(flush);
}

/** 各自登记、各自清除；交替挂载时不会互相抹掉。 */
export function clearEditFlush(flush: FlushFn): void {
  flushes.delete(flush);
}

function releaseIfConverged(): void {
  if (isResyncing()) return;
  for (const resolve of convergenceWaiters.splice(0)) resolve();
}

/** 编辑器把队列状态登记给 IPC 闸门；resync 是禁止 Rust 权威操作的唯一状态。 */
export function setEditSyncStatus(owner: FlushFn, status: SyncStatus): void {
  syncStatuses.set(owner, status);
  releaseIfConverged();
}

/** 与 flush 一样按拥有者清除，避免旧编辑器卸载时干扰新标签。 */
export function clearEditSyncStatus(owner: FlushFn): void {
  syncStatuses.delete(owner);
  releaseIfConverged();
}

export function isResyncing(): boolean {
  for (const status of syncStatuses.values()) {
    if (status === "resyncing") return true;
  }
  return false;
}

function waitForResyncConvergence(): Promise<void> {
  if (!isResyncing()) return Promise.resolve();
  return new Promise((resolve) => convergenceWaiters.push(resolve));
}

export function isFlushGated(command: string): boolean {
  return !FLUSH_EXEMPT.has(command);
}

/** 由 `invoke` 调用；没有编辑器挂载时是空操作。 */
export async function passFlushGate(command: string): Promise<void> {
  if (!isFlushGated(command)) return;
  // 两侧并行下发：差异视图里它们是各自独立的队列，串行等只是白等一轮
  await Promise.all([...flushes].map((flush) => flush()));
  // flush 可能恰好触发版本失配；直到队列回到 idle 之前，Rust 侧正文仍不是事实。
  await waitForResyncConvergence();
}

/** 仅供测试重置模块级状态。 */
export function resetFlushGateForTest(): void {
  flushes.clear();
  syncStatuses.clear();
  for (const resolve of convergenceWaiters.splice(0)) resolve();
}
