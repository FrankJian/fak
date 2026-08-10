/**
 * 全应用唯一允许 import lucide 的文件（SPEC §6.6.3，AGENTS.md §5.4，由 ESLint 强制）。
 *
 * 两条命名纪律：
 *   1. 键按**语义**取名（`save` / `find`），不按形状取名（`floppy` / `magnifier`）——
 *      换图标时只改这里一行，调用方不动。
 *   2. 同一语义只允许有一个键；不同语义共用同一个 lucide 组件是允许的
 *      （如 `copy` 与 `restoreWindow` 都是两个叠放的方框）。
 *
 * 走深路径 `lucide-react/icons/*` 而不是桶文件：桶文件在 Vite dev 下会拉入 4000+ 模块。
 * 类型声明见 src/lucide.d.ts，路径别名见 vite.config.ts / vitest.config.ts。
 */
import AlignLeft from "lucide-react/icons/align-left";
import ArrowDown from "lucide-react/icons/arrow-down";
import ArrowDownToLine from "lucide-react/icons/arrow-down-to-line";
import ArrowDownWideNarrow from "lucide-react/icons/arrow-down-wide-narrow";
import ArrowLeft from "lucide-react/icons/arrow-left";
import ArrowLeftToLine from "lucide-react/icons/arrow-left-to-line";
import ArrowRight from "lucide-react/icons/arrow-right";
import ArrowRightToLine from "lucide-react/icons/arrow-right-to-line";
import ArrowUp from "lucide-react/icons/arrow-up";
import ArrowUpNarrowWide from "lucide-react/icons/arrow-up-narrow-wide";
import Archive from "lucide-react/icons/archive";
import ArrowUpFromLine from "lucide-react/icons/arrow-up-from-line";
import Binary from "lucide-react/icons/binary";
import Blocks from "lucide-react/icons/blocks";
import Bold from "lucide-react/icons/bold";
import Bookmark from "lucide-react/icons/bookmark";
import BookmarkPlus from "lucide-react/icons/bookmark-plus";
import Box from "lucide-react/icons/box";
import Braces from "lucide-react/icons/braces";
import Brackets from "lucide-react/icons/brackets";
import CaseSensitive from "lucide-react/icons/case-sensitive";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import ChevronUp from "lucide-react/icons/chevron-up";
import ChevronsLeft from "lucide-react/icons/chevrons-left";
import ChevronsRight from "lucide-react/icons/chevrons-right";
import CircleAlert from "lucide-react/icons/circle-alert";
import CircleCheck from "lucide-react/icons/circle-check";
import CircleDot from "lucide-react/icons/circle-dot";
import CircleHelp from "lucide-react/icons/circle-help";
import CircleStop from "lucide-react/icons/circle-stop";
import ClipboardCopy from "lucide-react/icons/clipboard-copy";
import ClipboardPaste from "lucide-react/icons/clipboard-paste";
import Code from "lucide-react/icons/code";
import Columns2 from "lucide-react/icons/columns-2";
import CommandIcon from "lucide-react/icons/command";
import Contrast from "lucide-react/icons/contrast";
import Copy from "lucide-react/icons/copy";
import CopyMinus from "lucide-react/icons/copy-minus";
import CopyPlus from "lucide-react/icons/copy-plus";
import CornerDownLeft from "lucide-react/icons/corner-down-left";
import Download from "lucide-react/icons/download";
import Ellipsis from "lucide-react/icons/ellipsis";
import ExternalLink from "lucide-react/icons/external-link";
import Eye from "lucide-react/icons/eye";
import EyeOff from "lucide-react/icons/eye-off";
import FileIcon from "lucide-react/icons/file";
import FileCode from "lucide-react/icons/file-code";
import FileOutput from "lucide-react/icons/file-output";
import FilePlus from "lucide-react/icons/file-plus";
import FileSearch from "lucide-react/icons/file-search";
import FileText from "lucide-react/icons/file-text";
import Filter from "lucide-react/icons/filter";
import FilterX from "lucide-react/icons/filter-x";
import FoldHorizontal from "lucide-react/icons/fold-horizontal";
import FoldVertical from "lucide-react/icons/fold-vertical";
import Folder from "lucide-react/icons/folder";
import FolderOpen from "lucide-react/icons/folder-open";
import FolderSearch from "lucide-react/icons/folder-search";
import FolderTree from "lucide-react/icons/folder-tree";
import GripVertical from "lucide-react/icons/grip-vertical";
import HardDrive from "lucide-react/icons/hard-drive";
import Hash from "lucide-react/icons/hash";
import Heading from "lucide-react/icons/heading";
import History from "lucide-react/icons/history";
import ImageIcon from "lucide-react/icons/image";
import Inbox from "lucide-react/icons/inbox";
import KeyIcon from "lucide-react/icons/key";
import IndentDecrease from "lucide-react/icons/indent-decrease";
import IndentIncrease from "lucide-react/icons/indent-increase";
import Info from "lucide-react/icons/info";
import Italic from "lucide-react/icons/italic";
import Keyboard from "lucide-react/icons/keyboard";
import Languages from "lucide-react/icons/languages";
import Link from "lucide-react/icons/link";
import List from "lucide-react/icons/list";
import ListChecks from "lucide-react/icons/list-checks";
import ListOrdered from "lucide-react/icons/list-ordered";
import ListTree from "lucide-react/icons/list-tree";
import ListX from "lucide-react/icons/list-x";
import LoaderCircle from "lucide-react/icons/loader-circle";
import Locate from "lucide-react/icons/locate";
import Lock from "lucide-react/icons/lock";
import LockOpen from "lucide-react/icons/lock-open";
import Map from "lucide-react/icons/map";
import Maximize from "lucide-react/icons/maximize";
import Menu from "lucide-react/icons/menu";
import Minimize2 from "lucide-react/icons/minimize-2";
import Minus from "lucide-react/icons/minus";
import Monitor from "lucide-react/icons/monitor";
import Moon from "lucide-react/icons/moon";
import Package from "lucide-react/icons/package";
import Palette from "lucide-react/icons/palette";
import PanelBottom from "lucide-react/icons/panel-bottom";
import PanelLeft from "lucide-react/icons/panel-left";
import PanelRight from "lucide-react/icons/panel-right";
import Parentheses from "lucide-react/icons/parentheses";
import Pin from "lucide-react/icons/pin";
import PinOff from "lucide-react/icons/pin-off";
import Plus from "lucide-react/icons/plus";
import Quote from "lucide-react/icons/quote";
import Redo2 from "lucide-react/icons/redo-2";
import RefreshCw from "lucide-react/icons/refresh-cw";
import Regex from "lucide-react/icons/regex";
import Replace from "lucide-react/icons/replace";
import ReplaceAll from "lucide-react/icons/replace-all";
import RotateCcw from "lucide-react/icons/rotate-ccw";
import Save from "lucide-react/icons/save";
import SaveAll from "lucide-react/icons/save-all";
import Scissors from "lucide-react/icons/scissors";
import ScrollText from "lucide-react/icons/scroll-text";
import Search from "lucide-react/icons/search";
import Settings from "lucide-react/icons/settings";
import Sigma from "lucide-react/icons/sigma";
import Square from "lucide-react/icons/square";
import SquareFunction from "lucide-react/icons/square-function";
import SquareSlash from "lucide-react/icons/square-slash";
import Strikethrough from "lucide-react/icons/strikethrough";
import Sun from "lucide-react/icons/sun";
import Table from "lucide-react/icons/table";
import Terminal from "lucide-react/icons/terminal";
import TextCursor from "lucide-react/icons/text-cursor";
import TextSelect from "lucide-react/icons/text-select";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import TypeIcon from "lucide-react/icons/type";
import Undo2 from "lucide-react/icons/undo-2";
import UnfoldVertical from "lucide-react/icons/unfold-vertical";
import Variable from "lucide-react/icons/variable";
import WholeWord from "lucide-react/icons/whole-word";
import WrapText from "lucide-react/icons/wrap-text";
import X from "lucide-react/icons/x";
import Zap from "lucide-react/icons/zap";
import ZoomIn from "lucide-react/icons/zoom-in";
import ZoomOut from "lucide-react/icons/zoom-out";

export const icons = {
  // —— 文件与文档
  newFile: FilePlus,
  openFile: FolderOpen,
  openFolder: FolderTree,
  save: Save,
  saveAll: SaveAll,
  saveAs: FileOutput,
  file: FileIcon,
  fileText: FileText,
  fileSyntax: FileCode,
  folder: Folder,
  folderOpen: FolderOpen,
  revealInFolder: FolderSearch,
  copyPath: ClipboardCopy,
  recent: History,
  reload: RefreshCw,
  delete: Trash2,
  restore: RotateCcw,

  // —— 编辑
  undo: Undo2,
  redo: Redo2,
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  duplicate: CopyPlus,
  selectAll: TextSelect,
  toggleComment: SquareSlash,
  indent: IndentIncrease,
  outdent: IndentDecrease,
  formatDocument: AlignLeft,
  minify: FoldVertical,
  translate: Languages,
  wordCount: Sigma,
  removeEmptyLines: ListX,
  removeDuplicateLines: CopyMinus,
  trimStart: ArrowLeftToLine,
  trimEnd: ArrowRightToLine,
  trimBoth: FoldHorizontal,
  base64: Binary,
  formatBold: Bold,
  formatItalic: Italic,
  formatStrikethrough: Strikethrough,
  formatInlineCode: Code,
  formatQuote: Quote,
  formatUnorderedList: List,
  formatOrderedList: ListOrdered,
  formatTaskList: ListChecks,
  formatLink: Link,
  formatImage: ImageIcon,
  formatTable: Table,
  formatRule: Minus,

  // —— 查找与过滤
  find: Search,
  findInFiles: FileSearch,
  replace: Replace,
  replaceAll: ReplaceAll,
  findNext: ChevronDown,
  findPrevious: ChevronUp,
  matchCase: CaseSensitive,
  matchWholeWord: WholeWord,
  matchRegex: Regex,
  filter: Filter,
  filterClear: FilterX,
  stop: CircleStop,
  goToLine: Locate,
  quickOpen: FileSearch,

  // —— 视图与面板
  fileTree: FolderTree,
  outline: ListTree,
  bookmark: Bookmark,
  bookmarkAdd: BookmarkPlus,
  preview: Eye,
  hide: EyeOff,
  diff: Columns2,
  wordWrap: WrapText,
  lineNumbers: ListOrdered,
  minimap: Map,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  expandAll: UnfoldVertical,
  collapseAll: FoldVertical,
  sidebarLeft: PanelLeft,
  sidebarRight: PanelRight,
  panelBottom: PanelBottom,
  followTail: ArrowDownToLine,
  sortAscending: ArrowUpNarrowWide,
  sortDescending: ArrowDownWideNarrow,
  dragHandle: GripVertical,

  // —— 大纲符号种类（SPEC F6：靠图标区分种类，不靠颜色）
  symbolFunction: SquareFunction,
  symbolMethod: Parentheses,
  symbolClass: Box,
  symbolInterface: Blocks,
  symbolEnum: Brackets,
  symbolConstant: CircleDot,
  symbolType: TypeIcon,
  symbolModule: Package,
  symbolHeading: Heading,
  symbolKey: KeyIcon,
  symbolProperty: Variable,

  // —— 窗口
  minimizeWindow: Minus,
  maximizeWindow: Square,
  restoreWindow: Copy,
  closeWindow: X,
  fullscreen: Maximize,
  exitFullscreen: Minimize2,
  alwaysOnTop: Pin,
  alwaysOnTopOff: PinOff,
  lock: Lock,
  unlock: LockOpen,

  // —— 状态栏
  encoding: Binary,
  lineEnding: CornerDownLeft,
  syntax: Code,
  cursorPosition: TextCursor,
  textCursor: TextCursor,
  lineCount: Hash,
  fileSize: HardDrive,
  largeFile: Zap,
  syncing: RefreshCw,
  backup: Archive,

  // —— 通用导航与反馈
  close: X,
  more: Ellipsis,
  menu: Menu,
  check: Check,
  add: Plus,
  remove: Minus,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  scrollTabsLeft: ChevronsLeft,
  scrollTabsRight: ChevronsRight,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  copyToLeft: ArrowLeft,
  copyToRight: ArrowRight,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
  success: CircleCheck,
  help: CircleHelp,
  loading: LoaderCircle,
  empty: Inbox,

  // —— 设置与外部
  settings: Settings,
  appearance: Palette,
  themeLight: Sun,
  themeDark: Moon,
  themeSystem: Monitor,
  themeHighContrast: Contrast,
  language: Languages,
  shortcuts: Keyboard,
  import: ArrowDownToLine,
  export: ArrowUpFromLine,
  commandPalette: CommandIcon,
  logs: ScrollText,
  externalTool: Terminal,
  externalLink: ExternalLink,
  update: Download,

  // —— Markdown 工具栏
  mdHeading: Heading,
  mdBold: Bold,
  mdItalic: Italic,
  mdStrikethrough: Strikethrough,
  mdCode: Code,
  mdCodeBlock: Braces,
  mdLink: Link,
  mdImage: ImageIcon,
  mdList: List,
  mdListOrdered: ListOrdered,
  mdTaskList: ListChecks,
  mdQuote: Quote,
  mdTable: Table,
} as const;

export type IconName = keyof typeof icons;
