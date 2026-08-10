/** 查找与替换历史：空项不入库，完全相同的旧项移除后置顶。 */
export function noteSearchHistory(
  entries: readonly string[],
  value: string,
  limit = 10,
): string[] {
  const item = value.trim();
  if (item === "") return [...entries];
  return [item, ...entries.filter((entry) => entry !== item)].slice(0, limit);
}
