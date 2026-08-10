import type { SearchMatch } from "../ipc/search";

const MAX_MARKS = 500;

interface SearchOverviewRulerProps {
  matches: readonly SearchMatch[];
  documentLength: number;
}

/** 编辑器右侧的查找概览标尺；下采样避免大量命中再次形成 DOM 热点。 */
export function SearchOverviewRuler({
  matches,
  documentLength,
}: SearchOverviewRulerProps) {
  if (matches.length === 0 || documentLength <= 0) return null;
  const step = Math.max(1, Math.ceil(matches.length / MAX_MARKS));

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 right-0 top-0 w-[3px]"
    >
      {matches
        .filter((_, index) => index % step === 0)
        .map((match) => (
          <span
            key={`${match.start}-${match.end}`}
            className="absolute right-0 h-[2px] w-full bg-[var(--match-other-bg)]"
            style={{
              top: `${Math.min(100, (match.start / documentLength) * 100)}%`,
            }}
          />
        ))}
    </div>
  );
}
