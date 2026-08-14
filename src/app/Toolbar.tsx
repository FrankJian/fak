/**
 * 快捷栏（SPEC §5.2 的图标工具栏）。每个按钮都同时具备 tooltip、`aria-label`
 * 与命令面板条目（SPEC §6.6.2 的三项补偿，缺一不可）。
 */
import { IconButton } from '../design/components/IconButton';
import { Select, type SelectOption } from '../design/components/Select';
import { useTranslation } from '../i18n/useTranslation';
import { formatShortcut } from '../lib/keybinding';
import type { SyntaxSelection } from '../lib/syntaxKey';
import { currentPlatform } from './useKeyboard';

export interface ToolbarActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenCommandPalette: () => void;
  onToggleMarkdownPreview: () => void;
  onFileTypeChange?: (syntax: SyntaxSelection) => void;
}

interface ToolbarProps extends ToolbarActions {
  canSave: boolean;
  canSaveAs: boolean;
  canEdit: boolean;
  canPreviewMarkdown: boolean;
  markdownPreviewVisible: boolean;
  fileType?: SyntaxSelection;
  showFileType?: boolean;
}

export function Toolbar({
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onOpenCommandPalette,
  onToggleMarkdownPreview,
  canSave,
  canSaveAs,
  canEdit,
  canPreviewMarkdown,
  markdownPreviewVisible,
  fileType = 'plainText',
  showFileType = false,
  onFileTypeChange,
}: ToolbarProps) {
  const { t } = useTranslation();
  const undoShortcut = formatShortcut('Mod+Z', currentPlatform());
  const fileTypeOptions: ReadonlyArray<SelectOption<SyntaxSelection>> = [
    { value: 'plainText', label: t('syntax.plainText') },
    { value: 'markdown', label: t('syntax.markdown') },
    { value: 'json', label: t('syntax.json') },
    { value: 'javaScript', label: t('syntax.javaScript') },
    { value: 'typeScript', label: t('syntax.typeScript') },
    { value: 'tsx', label: t('syntax.tsx') },
    { value: 'python', label: t('syntax.python') },
    { value: 'rust', label: t('syntax.rust') },
    { value: 'bash', label: t('syntax.bash') },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t('quickAccessBar.label')}
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
      <IconButton
        icon="saveAs"
        label={t('toolbar.saveAs')}
        shortcut="Ctrl+Shift+S"
        onClick={onSaveAs}
        disabled={!canSaveAs}
      />

      <span
        aria-hidden
        className="mx-1 h-4 w-px shrink-0"
        style={{ backgroundColor: 'var(--border-default)' }}
      />

      <IconButton
        icon="undo"
        label={t('toolbar.undo')}
        shortcut={undoShortcut}
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
      {showFileType && onFileTypeChange && (
        <Select
          value={fileType}
          options={fileTypeOptions}
          onValueChange={onFileTypeChange}
          aria-label={t('status.syntax')}
          className="ml-1 max-w-[132px] text-[var(--font-size-small)]"
        />
      )}
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
