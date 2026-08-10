/** 配置片段的导入 / 导出（SPEC §3.6、F4.7、F15）。 */
import type { ExternalTool, FilterRuleGroup } from "./config";
import { invoke } from "./invoke";

export function exportExternalTools(
  path: string,
  tools: readonly ExternalTool[],
): Promise<void> {
  return invoke<void>("export_external_tools", { args: { path, tools } });
}

export function importExternalTools(path: string): Promise<ExternalTool[]> {
  return invoke<ExternalTool[]>("import_external_tools", { args: { path } });
}

export function exportFilterRuleGroups(
  path: string,
  groups: readonly FilterRuleGroup[],
): Promise<void> {
  return invoke<void>("export_filter_rule_groups", { args: { path, groups } });
}

export function importFilterRuleGroups(
  path: string,
): Promise<FilterRuleGroup[]> {
  return invoke<FilterRuleGroup[]>("import_filter_rule_groups", {
    args: { path },
  });
}
