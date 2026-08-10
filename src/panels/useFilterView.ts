/**
 * 过滤视图的状态机（SPEC F4.7 规则组、F4.8 结果内二次筛选）。
 *
 * 规则顺序即优先级：第一条命中的规则决定这一行的配色，排除规则命中就直接丢掉
 * 这一行。这条语义在 Rust 侧执行，前端只负责把规则原样送过去并按 `ruleIndex` 上色。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, isSilent } from "../ipc/errors";
import {
  disposeFilter,
  fetchFilterPage,
  startFilter,
  type FilteredLine,
  type FilterRule,
} from "../ipc/filter";
import { DEFAULT_SEARCH_OPTIONS, type MatchMode } from "../ipc/search";
import { logger } from "../lib/logger";
import { pickFileToOpen, pickPathToSave } from "../ipc/dialog";
import {
  exportFilterRuleGroups,
  importFilterRuleGroups,
} from "../ipc/portable";
import { useAppStore } from "../store/appStore";

export const FILTER_DEBOUNCE_MS = 200;
const PAGE_SIZE = 300;

/** 规则的前端形态：比后端多一个只用于渲染的颜色。 */
export interface FilterRuleSpec {
  query: string;
  mode: MatchMode;
  caseSensitive: boolean;
  wholeWord: boolean;
  enabled: boolean;
  exclude: boolean;
  color: string;
}

/** 六档配色取自 design token，不写死色值（AGENTS.md §5.3）。 */
export const RULE_COLORS = [
  "var(--filter-rule-1)",
  "var(--filter-rule-2)",
  "var(--filter-rule-3)",
  "var(--filter-rule-4)",
  "var(--filter-rule-5)",
  "var(--filter-rule-6)",
] as const;

export function newRule(index: number): FilterRuleSpec {
  return {
    query: "",
    mode: "literal",
    caseSensitive: false,
    wholeWord: false,
    enabled: true,
    exclude: false,
    color: RULE_COLORS[index % RULE_COLORS.length],
  };
}

function toIpcRule(rule: FilterRuleSpec): FilterRule {
  return {
    query: rule.query,
    enabled: rule.enabled,
    exclude: rule.exclude,
    options: {
      ...DEFAULT_SEARCH_OPTIONS,
      mode: rule.mode,
      caseSensitive: rule.caseSensitive,
      wholeWord: rule.wholeWord,
    },
  };
}

/** 结果内二次筛选（SPEC F4.8）：只在已有结果上再过一层，不回后端重算。 */
export function refine(
  rows: readonly FilteredLine[],
  keyword: string,
): readonly FilteredLine[] {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return rows;
  return rows.filter((row) => row.text.toLowerCase().includes(needle));
}

interface UseFilterViewOptions {
  documentId: string | null;
  /** 面板关着就不该占着后端会话 */
  open: boolean;
}

export function useFilterView({ documentId, open }: UseFilterViewOptions) {
  const language = useAppStore((store) => store.language);
  const groups = useAppStore((store) => store.filterRuleGroups);
  const patchConfig = useAppStore((store) => store.patchConfig);

  const [rules, setRules] = useState<FilterRuleSpec[]>(() => [newRule(0)]);
  const [rows, setRows] = useState<readonly FilteredLine[]>([]);
  const [total, setTotal] = useState(0);
  const [refineKeyword, setRefineKeyword] = useState("");
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const loadingRef = useRef(false);

  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setProblem(`${presentation.title} · ${presentation.next}`);
    },
    [language],
  );

  const dispose = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void disposeFilter(session);
  }, []);

  const active = useMemo(
    () => rules.filter((rule) => rule.enabled && rule.query.length > 0),
    [rules],
  );

  const run = useCallback(async () => {
    if (!documentId || active.length === 0) {
      dispose();
      setRows([]);
      setTotal(0);
      return;
    }
    const ticket = (runRef.current += 1);
    dispose();
    setRunning(true);
    setProblem(null);
    try {
      const started = await startFilter(documentId, rules.map(toIpcRule));
      if (ticket !== runRef.current) {
        void disposeFilter(started.sessionId);
        return;
      }
      sessionRef.current = started.sessionId;
      setRows(started.firstPage);
      setTotal(started.total);
    } catch (error) {
      if (ticket !== runRef.current) return;
      setRows([]);
      setTotal(0);
      report(error);
    } finally {
      if (ticket === runRef.current) setRunning(false);
    }
  }, [documentId, rules, active.length, dispose, report]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void run(), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, run]);

  // 面板关掉只放会话；结果在读取时按 `open` 挡掉，不在 effect 里同步 setState
  useEffect(() => {
    if (open) return;
    runRef.current += 1;
    dispose();
  }, [open, dispose]);

  useEffect(() => () => dispose(), [dispose]);

  const loadMore = useCallback(() => {
    const session = sessionRef.current;
    if (!session || loadingRef.current || rows.length >= total) return;
    loadingRef.current = true;
    const ticket = runRef.current;
    void fetchFilterPage(session, rows.length, PAGE_SIZE)
      .then((page) => {
        if (ticket !== runRef.current) return;
        setRows((current) =>
          current.length === page.offset ? [...current, ...page.rows] : current,
        );
      })
      .catch((error: unknown) => logger.warn("filter page failed", error))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [rows.length, total]);

  const saveGroup = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      const next = groups.filter((group) => group.name !== trimmed);
      void patchConfig({
        filterRuleGroups: [...next, { name: trimmed, rules }],
      });
    },
    [groups, rules, patchConfig],
  );

  const loadGroup = useCallback(
    (name: string) => {
      const group = groups.find((item) => item.name === name);
      if (group && group.rules.length > 0) setRules([...group.rules]);
    },
    [groups],
  );

  const deleteGroup = useCallback(
    (name: string) => {
      void patchConfig({
        filterRuleGroups: groups.filter((group) => group.name !== name),
      });
    },
    [groups, patchConfig],
  );

  const exportGroups = useCallback(async () => {
    const path = await pickPathToSave();
    if (!path) return;
    try {
      await exportFilterRuleGroups(path, groups);
    } catch (error) {
      report(error);
    }
  }, [groups, report]);

  const importGroups = useCallback(async () => {
    const path = await pickFileToOpen();
    if (!path) return;
    try {
      const imported = await importFilterRuleGroups(path);
      // 同名以导入的为准，其余保留：导入不该悄悄清空用户既有的规则组
      const names = new Set(imported.map((group) => group.name));
      void patchConfig({
        filterRuleGroups: [
          ...groups.filter((group) => !names.has(group.name)),
          ...imported,
        ],
      });
    } catch (error) {
      report(error);
    }
  }, [groups, patchConfig, report]);

  return {
    rules,
    setRules,
    rows: useMemo(
      () => (open ? refine(rows, refineKeyword) : []),
      [open, rows, refineKeyword],
    ),
    loaded: rows.length,
    total: open ? total : 0,
    running,
    problem,
    refineKeyword,
    setRefineKeyword,
    loadMore,
    groups,
    saveGroup,
    loadGroup,
    deleteGroup,
    exportGroups,
    importGroups,
  };
}
