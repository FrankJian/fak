/**
 * 大纲侧栏的纯函数（SPEC F6 步骤 3、4）。
 *
 * 大纲从 Rust 拿到的是**扁平数组 + depth**。折叠与过滤都在这一维上做：
 * 「某条的子节点」就是它后面所有 depth 更大的连续条目，遇到 depth 不大于
 * 自己的就结束。这让折叠是 O(n) 的一次扫描，不必先建树再拍平。
 */
import type { OutlineNode } from '../ipc/outline';

/** 一条的子树在数组里的结束位置（半开）。没有子节点时等于 `index + 1`。 */
export function subtreeEnd(nodes: readonly OutlineNode[], index: number): number {
  const depth = nodes[index]?.depth ?? 0;
  let end = index + 1;
  while (end < nodes.length && nodes[end].depth > depth) end += 1;
  return end;
}

export function hasChildren(nodes: readonly OutlineNode[], index: number): boolean {
  return subtreeEnd(nodes, index) > index + 1;
}

export interface VisibleRow {
  node: OutlineNode;
  /** 在原数组里的下标。折叠、跳转、光标联动都按它对话 */
  index: number;
  expandable: boolean;
  /** 子树当前是折起来的。决定箭头朝哪，与 `expandable` 是两回事 */
  collapsed: boolean;
}

/**
 * 折叠后实际要画的行。
 *
 * `collapsed` 存的是原数组下标。折叠一条就整段跳过它的子树——
 * 逐层判断祖先是否折叠的写法在深嵌套上是 O(n·depth)。
 */
export function visibleRows(
  nodes: readonly OutlineNode[],
  collapsed: ReadonlySet<number>,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  let index = 0;
  while (index < nodes.length) {
    const end = subtreeEnd(nodes, index);
    const folded = collapsed.has(index);
    rows.push({ node: nodes[index], index, expandable: end > index + 1, collapsed: folded });
    index = folded ? end : index + 1;
  }
  return rows;
}

/**
 * 按名字过滤，**命中项的祖先一并保留**。
 *
 * 不保留祖先的话，过滤结果里一堆同名的 `open` 谁也说不出属于哪个类。
 * 返回原数组下标的集合，交给 `visibleRows` 之前先据它裁一遍。
 */
export function matchingWithAncestors(
  nodes: readonly OutlineNode[],
  query: string,
): OutlineNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...nodes];

  const keep = new Set<number>();
  // 祖先栈：走到某一条时，栈里正好是它的各级祖先
  const stack: number[] = [];
  nodes.forEach((node, index) => {
    while (stack.length > 0 && nodes[stack[stack.length - 1]].depth >= node.depth) stack.pop();
    if (node.name.toLowerCase().includes(needle)) {
      stack.forEach((ancestor) => keep.add(ancestor));
      keep.add(index);
    }
    stack.push(index);
  });

  // 过滤后 depth 可能出现断层（父级没被保留时子级从 2 直接开头），
  // 但保留了祖先就不会——命中项的祖先总是全在
  return nodes.filter((_, index) => keep.has(index));
}

/**
 * 光标在哪一条上（SPEC F6 步骤 4 的反向联动）。
 *
 * 取最后一个包含光标的符号：数组是文档序，越靠后的越内层。
 */
export function symbolAt(nodes: readonly OutlineNode[], offset: number): number | null {
  let found: number | null = null;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.start <= offset && offset < node.end) found = index;
    // 数组是文档序，起点越过光标之后不可能再有命中
    if (node.start > offset) break;
  }
  return found;
}

/** 高亮某一条时，它的祖先必须先展开，否则用户看不到高亮跑到哪去了。 */
export function expandTo(
  nodes: readonly OutlineNode[],
  collapsed: ReadonlySet<number>,
  target: number,
): Set<number> {
  const next = new Set(collapsed);
  for (let index = target - 1; index >= 0; index -= 1) {
    if (subtreeEnd(nodes, index) > target) next.delete(index);
  }
  return next;
}
