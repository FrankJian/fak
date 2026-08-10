/**
 * 快速打开的候选排序（SPEC F13 `Ctrl+P` / P2-06 步骤 2）。
 *
 * 候选来自两处：**已打开的标签**与**最近打开过的文件**。
 * 工作区全量索引要等文件树（P2-01）落地，届时在这里追加第三个来源即可——
 * 排序规则不必改，它只认 `QuickOpenEntry`。
 *
 * 纯函数，不依赖 React 与 Tauri。
 */
import { scoreMatch } from "./actionRegistry";

export interface QuickOpenEntry {
  /** 完整路径。未命名文档没有路径，用文档 id 顶替，保证 key 唯一 */
  id: string;
  fileName: string;
  /** 展示与匹配用的路径；未命名文档为空串 */
  path: string;
  /** 已经打开的文档 id。有值表示这一条是切标签而不是开文件 */
  documentId?: string;
  /** 在最近文件列表里的位置，0 是最近的一次。不在列表里则不传 */
  recentRank?: number;
  /** Rust 索引预计算的拼音首字母，用于中文文件名的键盘匹配。 */
  pinyinInitials?: string;
}

export interface RankedEntry {
  entry: QuickOpenEntry;
  score: number;
}

/** 已打开的文件优先。按 Ctrl+P 多半是在几个已开文件之间来回切，而不是去开新的。 */
const OPEN_BONUS = 8;

/**
 * 最近使用的加权。名次每落后一位减 1 分，减到 0 为止——
 * 用衰减而不是固定加分，是为了让「上一个打开的文件」明显强于「十次之前打开的」。
 */
const RECENT_BONUS = 6;

export function rankQuickOpen(
  entries: readonly QuickOpenEntry[],
  query: string,
): RankedEntry[] {
  const trimmed = query.trim();
  const ranked: RankedEntry[] = [];

  for (const entry of entries) {
    // 先按文件名匹配，不中再按整条路径。反过来做的话，深目录里的文件
    // 会因为路径长、命中多而压过同名的浅层文件
    const byName = scoreMatch(entry.fileName, trimmed);
    const byPath = byName ? null : scoreMatch(entry.path, trimmed);
    const byPinyin =
      byName || byPath ? null : scoreMatch(entry.pinyinInitials ?? "", trimmed);
    const hit = byName ?? byPath ?? byPinyin;
    if (!hit) continue;

    // 路径命中比文件名命中弱：用户想找的通常是文件名
    let score = byName ? hit.score : byPath ? hit.score - 5 : hit.score - 8;
    if (entry.documentId) score += OPEN_BONUS;
    if (entry.recentRank !== undefined) {
      score += Math.max(0, RECENT_BONUS - entry.recentRank);
    }
    ranked.push({ entry, score });
  }

  // 分数相同时按文件名字典序，保证结果稳定：同一次输入不该每次排出不同的顺序
  return ranked.sort(
    (a, b) =>
      b.score - a.score || a.entry.fileName.localeCompare(b.entry.fileName),
  );
}

/**
 * 把标签与最近文件合成候选表。同一路径只留一条，且以**已打开**的那条为准——
 * 列出两条相同的文件、其中一条会新开标签，是纯粹的困惑来源。
 */
export function buildQuickOpenEntries(
  tabs: readonly {
    documentId: string;
    fileName: string;
    path: string | null;
  }[],
  recentFiles: readonly string[],
  workspaceFiles: readonly {
    path: string;
    fileName: string;
    pinyinInitials: string;
  }[] = [],
): QuickOpenEntry[] {
  const entries: QuickOpenEntry[] = [];
  const claimed = new Set<string>();

  for (const tab of tabs) {
    if (tab.path) claimed.add(tab.path);
    entries.push({
      id: tab.documentId,
      fileName: tab.fileName,
      path: tab.path ?? "",
      documentId: tab.documentId,
    });
  }

  recentFiles.forEach((path, index) => {
    if (claimed.has(path)) return;
    claimed.add(path);
    entries.push({
      id: path,
      fileName: baseName(path),
      path,
      recentRank: index,
    });
  });

  for (const file of workspaceFiles) {
    if (claimed.has(file.path)) continue;
    claimed.add(file.path);
    entries.push({
      id: file.path,
      fileName: file.fileName,
      path: file.path,
      pinyinInitials: file.pinyinInitials,
    });
  }

  return entries;
}

/** 两种分隔符都要认：配置可能是在另一个平台上写的。 */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

export const RECENT_FILES_LIMIT = 12;

/**
 * 把一个路径提到最近文件表的最前面。
 *
 * 去重按**精确字符串**比较：路径在 Rust 侧已经 canonicalize 过（SPEC §10.4），
 * 同一个文件每次都会得到同一个字符串，不需要在这里再做大小写折叠——
 * 那反而会在大小写敏感的文件系统上把两个不同的文件并成一条。
 */
export function noteRecentFile(
  list: readonly string[],
  path: string,
  limit: number = RECENT_FILES_LIMIT,
): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, limit);
}
