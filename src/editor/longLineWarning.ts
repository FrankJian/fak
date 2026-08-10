import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';

/** SPEC P4：超过此值的单行不做语法高亮，并在可见行首明确提示降级。 */
export const LONG_LINE_BYTES = 4 * 1024;
const encoder = new TextEncoder();

export function isLongLine(text: string): boolean {
  // UTF-8 每个 code unit 最少占一个字节；短行无需分配编码缓冲区。
  return text.length >= LONG_LINE_BYTES || encoder.encode(text).byteLength > LONG_LINE_BYTES;
}

class LongLineWarningWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-fak-long-line-warning';
    element.title = this.label;
    element.setAttribute('aria-label', element.title);
    element.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Zm0 6v5m0 4h.01"/></svg>';
    return element;
  }

  eq() {
    return true;
  }
}

function warningDecorations(view: EditorView, warning: Decoration) {
  const builder = new RangeSetBuilder<Decoration>();
  const first = view.state.doc.lineAt(view.viewport.from).number;
  const last = view.state.doc.lineAt(view.viewport.to).number;
  for (let number = first; number <= last; number += 1) {
    const line = view.state.doc.line(number);
    if (isLongLine(line.text)) builder.add(line.from, line.from, warning);
  }
  return builder.finish();
}

/** 仅扫视口行，避免把 Tier B 的整份大文档重新遍历一遍。 */
export function longLineWarningExtension(label: string): Extension {
  const warning = Decoration.widget({ widget: new LongLineWarningWidget(label), side: -1 });
  return ViewPlugin.fromClass(
  class {
    decorations: ReturnType<typeof warningDecorations>;

    constructor(view: EditorView) {
      this.decorations = warningDecorations(view, warning);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = warningDecorations(update.view, warning);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
  );
}
