/**
 * 工具栏（SPEC §5.2）。全部图标按钮——每个都同时具备 tooltip、`aria-label`
 * 与命令面板条目（SPEC §6.6.2 的三项补偿，缺一不可）。
 */
import { IconButton } from '../design/components/IconButton';
import { useTranslation } from '../i18n/useTranslation';

export interface ToolbarActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenCommandPalette: () => void;
  onToggleMarkdownPreview: () => void;
}

interface ToolbarProps extends ToolbarActions {
  canSave: boolean;
  canEdit: boolean;
  canPreviewMarkdown: boolean;
  markdownPreviewVisible: boolean;
}

export function Toolbar({
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onUndo,
  onRedo,
  onOpenCommandPalette,
  onToggleMarkdownPreview,
  canSave,
  canEdit,
  canPreviewMarkdown,
  markdownPreviewVisible,
}: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2"
      style={{ height: 'var(--h-toolbar)' }}
    >
      <IconButton icon="newFile" label={t('toolbar.newFile')} shortcut="Ctrl+N" onClick={onNew} />
      <IconButton
        icon="openFile"
        label={t('toolbar.openFile')}
        shortcut="Ctrl+O"
        onClick={onOpen}
      />
      <IconButton icon="openFolder" label={t('toolbar.openFolder')} onClick={onOpenFolder} />
      <IconButton
        icon="save"
        label={t('toolbar.save')}
        shortcut="Ctrl+S"
        onClick={onSave}
        disabled={!canSave}
      />

      <span
        aria-hidden
        className="mx-1 h-4 w-px shrink-0"
        style={{ backgroundColor: 'var(--border-default)' }}
      />

      <IconButton
        icon="undo"
        label={t('toolbar.undo')}
        shortcut="Ctrl+Z"
        onClick={onUndo}
        disabled={!canEdit}
      />
      <IconButton
        icon="redo"
        label={t('toolbar.redo')}
        shortcut="Ctrl+Y"
        onClick={onRedo}
        disabled={!canEdit}
      />
      {canPreviewMarkdown && (
        <IconButton
          icon={markdownPreviewVisible ? 'hide' : 'preview'}
          label={t(markdownPreviewVisible ? 'markdown.hidePreview' : 'markdown.showPreview')}
          onClick={onToggleMarkdownPreview}
        />
      )}

      <span className="flex-1" />

      {/* 纯图标界面的兜底入口：认不出图标的用户从这里按名字找命令（SPEC §6.6.2） */}
      <IconButton
        icon="commandPalette"
        label={t('commandPalette.open')}
        shortcut="Ctrl+Shift+P"
        onClick={onOpenCommandPalette}
      />
    </div>
  );
}
