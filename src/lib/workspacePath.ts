/**
 * 工作区相对路径（SPEC F4.5 / F4.6）。
 *
 * 跨文件查找的结果只带相对路径，而标签页记的是绝对路径；两边要能互相对上，
 * 才能判断「这个命中所在的文件是不是正开着且为脏」。
 */

/** 统一成正斜杠，Windows 的反斜杠与后端回传的相对路径对不上。 */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function identity(path: string): string {
  const normalized = normalize(path);
  // Windows 驱动器路径按不区分大小写比较；Unix 路径必须保留大小写语义。
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function sameFilePath(left: string, right: string): boolean {
  return identity(left) === identity(right);
}

export function pathIsWithin(path: string, parent: string): boolean {
  const target = identity(path);
  const base = identity(parent);
  return target === base || target.startsWith(`${base}/`);
}

/** 删除目录时包含所有已打开的子文件；后端 ID 兜住会话恢复及路径别名。 */
export function deletedTabIds(
  tabs: readonly { documentId: string; path: string | null }[],
  deletedPath: string,
  backendIds: readonly string[],
): string[] {
  const ids = new Set(backendIds);
  return tabs
    .filter((tab) => ids.has(tab.documentId) ||
      (tab.path !== null && pathIsWithin(tab.path, deletedPath)))
    .map((tab) => tab.documentId);
}

/**
 * 把绝对路径换算成相对 `root` 的路径。
 *
 * 不在 `root` 之下时原样返回：调用方据此判断「这个文件不属于当前工作区」，
 * 硬拼一个相对路径会让它和别处的同名文件混起来。
 */
export function relativeToRoot(root: string | null, path: string): string {
  if (root === null) return normalize(path);
  const base = normalize(root);
  const target = normalize(path);
  if (target === base) return "";
  const prefix = `${base}/`;
  // Windows 路径大小写不敏感，比较时统一小写，但返回原样保留显示用的大小写
  return target.toLowerCase().startsWith(prefix.toLowerCase())
    ? target.slice(prefix.length)
    : target;
}
