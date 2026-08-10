import type { RefObject } from "react";
import type { DocumentMeta } from "../ipc/documents";
import { useTranslation } from "../i18n/useTranslation";
import { useEditorAppearance } from "../editor/useEditorAppearance";
import { useEditorView, type EditorHandle } from "../editor/useEditorView";

interface DiffEditorColumnProps {
  meta: DocumentMeta;
  text: string;
  handleRef: RefObject<EditorHandle | null>;
  autoFocus: boolean;
  onEdited: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}

/** 差异视图的一侧：真实文档的 CM6 实例，不另建影子正文或撤销栈。 */
export function DiffEditorColumn({
  meta,
  text,
  handleRef,
  autoFocus,
  onEdited,
  onContextMenu,
}: DiffEditorColumnProps) {
  const { t } = useTranslation();
  const appearance = useEditorAppearance();
  const containerRef = useEditorView({
    meta,
    initialText: text,
    appearance,
    autoFocus,
    onEdited,
    longLineWarningLabel: t("editor.longLineDegraded"),
    handleRef,
  });

  return (
    <div className="h-full min-h-0 min-w-0" onContextMenu={onContextMenu}>
      <div ref={containerRef} className="h-full overflow-hidden" />
    </div>
  );
}
