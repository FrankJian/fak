import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * 竖标尺必须跟着编辑区横向滚动而不是用页面背景画：背景渐变既不能正确扣除
 * gutter 宽度，也违反 SPEC §6.2 对渐变的限制。
 */
export function rulerExtensions(columns: readonly number[]): Extension[] {
  const normalized = [...new Set(columns.filter((column) => Number.isInteger(column) && column > 0))].sort(
    (left, right) => left - right,
  );
  if (normalized.length === 0) return [];

  return [
    ViewPlugin.fromClass(
      class {
        private readonly overlay: HTMLDivElement;
        private readonly rulers: HTMLDivElement[];

        constructor(private readonly view: EditorView) {
          this.overlay = document.createElement('div');
          this.overlay.className = 'cm-fak-rulers';
          this.rulers = normalized.map(() => {
            const ruler = document.createElement('div');
            ruler.className = 'cm-fak-ruler';
            this.overlay.append(ruler);
            return ruler;
          });
          view.dom.append(this.overlay);
          view.scrollDOM.addEventListener('scroll', this.position);
          this.position();
        }

        update(update: ViewUpdate) {
          if (update.geometryChanged || update.viewportChanged) this.position();
        }

        destroy() {
          this.view.scrollDOM.removeEventListener('scroll', this.position);
          this.overlay.remove();
        }

        private position = () => {
          const left = this.view.contentDOM.offsetLeft - this.view.scrollDOM.scrollLeft;
          const charWidth = this.view.defaultCharacterWidth;
          this.rulers.forEach((ruler, index) => {
            ruler.style.left = `${left + normalized[index] * charWidth}px`;
          });
        };
      },
    ),
  ];
}
