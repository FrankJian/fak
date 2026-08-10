/**
 * 跳转到行（SPEC F13 `Ctrl+G` / P2-06 步骤 1）。
 *
 * 复用命令面板的输入外壳，只换数据源：这里的「结果列表」永远只有一条，
 * 内容是「按下回车会跳到哪」。把结果预先说出来，用户输 `9999` 时能当场
 * 看到「跳转到第 1200 行（末行）」，不必按下去才知道被钳制了。
 */
import { useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { clampLine, parseLineTarget } from "../lib/goToLine";
import { QuickInput, type QuickInputItem } from "./QuickInput";

interface GoToLinePanelProps {
  lineCount: number;
  initialQuery?: string;
  onGo: (line: number, column: number) => void;
  onClose: () => void;
}

export function GoToLinePanel({
  lineCount,
  initialQuery = "",
  onGo,
  onClose,
}: GoToLinePanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);

  const target = parseLineTarget(query);
  const clamped = target ? clampLine(target.line, lineCount) : null;

  const items: QuickInputItem[] = [];
  if (target && clamped !== null) {
    items.push({
      id: "goto",
      label:
        clamped === target.line
          ? t("goToLine.target", { line: String(clamped) })
          : t("goToLine.targetClamped", { line: String(clamped) }),
      detail: t("goToLine.range", { count: String(lineCount) }),
    });
  }

  const commit = () => {
    if (!target) return;
    onClose();
    onGo(target.line, target.column);
  };

  return (
    <QuickInput
      icon="goToLine"
      placeholder={t("goToLine.placeholder")}
      emptyLabel={t("goToLine.hint")}
      query={query}
      onQueryChange={setQuery}
      items={items}
      highlighted={0}
      onHighlight={() => {}}
      onCommit={commit}
      onClose={onClose}
      problem={
        query.trim().length > 0 && !target ? t("goToLine.invalid") : undefined
      }
    />
  );
}
