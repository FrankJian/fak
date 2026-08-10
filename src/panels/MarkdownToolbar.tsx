import { IconButton } from "../design/components/IconButton";
import type { MessageKey } from "../i18n/zh-CN";
import { useTranslation } from "../i18n/useTranslation";
import type { MarkdownFormat } from "../lib/markdownTransform";

interface MarkdownToolbarProps {
  onFormat: (format: MarkdownFormat) => void;
}

const ACTIONS: readonly {
  format: MarkdownFormat;
  icon: Parameters<typeof IconButton>[0]["icon"];
  label: MessageKey;
}[] = [
  { format: "heading", icon: "mdHeading", label: "markdown.format.heading" },
  { format: "bold", icon: "mdBold", label: "markdown.format.bold" },
  { format: "italic", icon: "mdItalic", label: "markdown.format.italic" },
  {
    format: "strikethrough",
    icon: "mdStrikethrough",
    label: "markdown.format.strikethrough",
  },
  { format: "inlineCode", icon: "mdCode", label: "markdown.format.inlineCode" },
  {
    format: "codeBlock",
    icon: "mdCodeBlock",
    label: "markdown.format.codeBlock",
  },
  { format: "quote", icon: "mdQuote", label: "markdown.format.quote" },
  {
    format: "unorderedList",
    icon: "mdList",
    label: "markdown.format.unorderedList",
  },
  {
    format: "orderedList",
    icon: "mdListOrdered",
    label: "markdown.format.orderedList",
  },
  { format: "taskList", icon: "mdTaskList", label: "markdown.format.taskList" },
  { format: "link", icon: "mdLink", label: "markdown.format.link" },
  { format: "image", icon: "mdImage", label: "markdown.format.image" },
  { format: "table", icon: "mdTable", label: "markdown.format.table" },
  { format: "rule", icon: "remove", label: "markdown.format.rule" },
];

export function MarkdownToolbar({ onFormat }: MarkdownToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("markdown.toolbar")}
      className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2"
      style={{ height: "var(--h-md-toolbar)" }}
    >
      {ACTIONS.map((action) => (
        <IconButton
          key={action.format}
          icon={action.icon}
          label={t(action.label)}
          onClick={() => onFormat(action.format)}
        />
      ))}
    </div>
  );
}
