/**
 * 跨文件查找结果（SPEC F4.5、F4.8）。
 *
 * 按文件分组：跨文件结果里「这条属于哪个文件」比行号更重要，
 * 平铺一万条路径重复的行会让用户没法扫读。
 */
import { useTranslation } from "../i18n/useTranslation";
import { Icon } from "../design/Icon";
import type { PathSearchRow, PathSearchSkipped } from "../ipc/pathSearch";
import type { PathSearchGroup } from "./usePathSearch";

interface PathSearchResultsProps {
  groups: readonly PathSearchGroup[];
  total: number;
  loaded: number;
  scannedFiles: number;
  skipped: readonly PathSearchSkipped[];
  truncated: boolean;
  onPick: (row: PathSearchRow) => void;
  onReachEnd: () => void;
}

/** 距底部多少像素开始取下一页。留一屏余量，滚动才不会顿住。 */
const LOAD_MORE_THRESHOLD_PX = 160;

function Preview({ row }: { row: PathSearchRow }) {
  const start = Math.max(0, Math.min(row.previewStart, row.preview.length));
  const end = Math.max(start, Math.min(row.previewEnd, row.preview.length));
  return (
    <>
      {row.preview.slice(0, start)}
      <mark className="bg-[var(--match-other-bg)] text-[var(--text-primary)]">
        {row.preview.slice(start, end)}
      </mark>
      {row.preview.slice(end)}
    </>
  );
}

export function PathSearchResults({
  groups,
  total,
  loaded,
  scannedFiles,
  skipped,
  truncated,
  onPick,
  onReachEnd,
}: PathSearchResultsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-col border-t border-[var(--border-subtle)]">
      <div
        className="flex shrink-0 items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        <span className="tabular-nums">
          {t("find.pathSummary", { matches: total, files: scannedFiles })}
        </span>
        {truncated && (
          <span style={{ color: "var(--warning)" }}>
            {t("find.pathTruncated")}
          </span>
        )}
        {skipped.length > 0 && (
          <span
            title={skipped
              .map(
                (item) => `${item.pathHint} · ${t(`find.skip.${item.reason}`)}`,
              )
              .join("\n")}
            className="tabular-nums"
          >
            {t("find.pathSkipped", { count: skipped.length })}
          </span>
        )}
      </div>

      <div
        className="min-h-0 overflow-auto"
        style={{ maxHeight: "260px" }}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (
            el.scrollHeight - el.scrollTop - el.clientHeight <
            LOAD_MORE_THRESHOLD_PX
          ) {
            onReachEnd();
          }
        }}
      >
        {groups.map((group) => (
          <div key={group.path}>
            <div
              className="sticky top-0 z-10 flex items-center gap-[var(--space-1)] bg-[var(--bg-surface)] px-[var(--space-3)] py-[2px] text-[var(--text-secondary)]"
              style={{ fontSize: "var(--font-size-small)" }}
            >
              <Icon name="file" variant="status" />
              <span className="min-w-0 truncate">{group.path}</span>
              <span className="tabular-nums text-[var(--text-tertiary)]">
                {group.rows.length}
              </span>
            </div>
            {group.rows.map((row) => (
              <button
                key={`${row.path}:${row.line}:${row.startColumn}`}
                type="button"
                onClick={() => onPick(row)}
                className="flex w-full items-baseline gap-[var(--space-2)] px-[var(--space-3)] py-[1px] text-left hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
                style={{ fontSize: "var(--font-size-small)" }}
              >
                <span className="w-[52px] shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">
                  {row.line + 1}
                </span>
                <span className="min-w-0 truncate font-mono text-[var(--text-primary)]">
                  <Preview row={row} />
                </span>
              </button>
            ))}
          </div>
        ))}

        {loaded < total && (
          <div
            className="px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {t("find.pathLoading")}
          </div>
        )}
      </div>
    </div>
  );
}
