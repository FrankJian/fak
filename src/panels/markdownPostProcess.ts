/**
 * 预览的后处理：KaTeX 公式与 Mermaid 图（SPEC F8.1 步骤 4）。
 *
 * 两者都**动态 import**：合起来一百多个包，静态引入会把首屏 JS 直接顶穿
 * SPEC §8.1 的 200 KB gzip 预算，而大多数文档一个公式一张图都没有。
 *
 * 渲染失败不抛错，把原始文本留在原地——一条写错的公式不该让整篇预览开天窗。
 */
import { logger } from "../lib/logger";

/** `$...$` 行内、`$$...$$` 块级。转义过的 `\$` 不参与匹配。 */
const INLINE_MATH = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
const BLOCK_MATH = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;

function isInsideCode(node: Node): boolean {
  let current: Node | null = node.parentElement;
  while (current) {
    const tag = (current as HTMLElement).tagName;
    if (tag === "CODE" || tag === "PRE") return true;
    current = current.parentElement;
  }
  return false;
}

/** 只在文本节点上找公式：进 HTML 属性或代码块里替换都是错的。 */
function mathTextNodes(container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.includes("$") && !isInsideCode(node)) {
      found.push(node as Text);
    }
    node = walker.nextNode();
  }
  return found;
}

export async function renderMath(container: HTMLElement): Promise<void> {
  const nodes = mathTextNodes(container);
  if (nodes.length === 0) return;

  const katex = (await import("katex")).default;
  await import("katex/dist/katex.min.css");

  const render = (source: string, displayMode: boolean): string => {
    try {
      return katex.renderToString(source, {
        displayMode,
        throwOnError: false,
        output: "html",
      });
    } catch (error) {
      logger.warn("katex render failed", error);
      return "";
    }
  };

  for (const node of nodes) {
    const original = node.textContent ?? "";
    const replaced = original
      .replace(BLOCK_MATH, (whole, body: string) => render(body, true) || whole)
      .replace(
        INLINE_MATH,
        (whole, body: string) => render(body, false) || whole,
      );
    if (replaced === original) continue;
    const span = document.createElement("span");
    // KaTeX 的输出是它自己生成的 HTML，不来自源文档；源文档里的裸 HTML
    // 早在 Rust 侧就被转义成文本了（SPEC F8.1）
    span.innerHTML = replaced;
    node.replaceWith(span);
  }
}

export async function renderDiagrams(container: HTMLElement): Promise<void> {
  const blocks = [
    ...container.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
  ];
  if (blocks.length === 0) return;

  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

  for (const [index, block] of blocks.entries()) {
    const source = block.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`fak-mermaid-${index}`, source);
      const figure = document.createElement("div");
      figure.className = "markdown-mermaid";
      figure.innerHTML = svg;
      block.parentElement?.replaceWith(figure);
    } catch (error) {
      // 画不出来就把源码留着：至少用户还能看到自己写了什么
      logger.warn("mermaid render failed", error);
    }
  }
}
