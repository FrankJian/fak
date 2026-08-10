/**
 * 小地图（SPEC §181、§4.1 能力表）。
 *
 * 自绘 canvas，**不渲染真实文本**：数据是行长度与标记，所以画一份 1 GB 文件的
 * 小地图和画一份 1 KB 的开销一样。Tier A 画行长条 + 标记，Tier B/C 只画标记
 * （`density` 为空即表示该档位不渲染文本）。
 *
 * 颜色全部从 CSS 变量读，不写死——canvas 不吃 CSS，只能运行时取一次。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { lineToY, viewportRect, yToLine } from "../lib/minimap";

export interface MinimapMark {
  line: number;
}

interface MinimapProps {
  totalLines: number;
  topLine: number;
  visibleLines: number;
  /** Tier A 的行长度密度（0..1，每像素一格）；Tier B/C 传空数组 */
  density: readonly number[];
  matches: readonly MinimapMark[];
  changes: readonly MinimapMark[];
  autohide: boolean;
  onSeek: (line: number) => void;
}

function cssColor(element: HTMLElement, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function Minimap({
  totalLines,
  topLine,
  visibleLines,
  density,
  matches,
  changes,
  autohide,
  onSeek,
}: MinimapProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // 画布像素尺寸要跟着容器与 DPR 走，否则高分屏上是糊的
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const textColor = cssColor(canvas, "--text-tertiary");
    const matchColor = cssColor(canvas, "--accent");
    const changeColor = cssColor(canvas, "--diff-modify-gutter");
    const viewportColor = cssColor(canvas, "--bg-hover");

    context.fillStyle = textColor;
    density.forEach((value, y) => {
      if (value <= 0) return;
      context.globalAlpha = 0.25 + value * 0.45;
      context.fillRect(2, y, Math.max(1, (width - 4) * value), 1);
    });
    context.globalAlpha = 1;

    // 变更标记贴左，命中标记贴右，两者同时出现时不会互相盖住
    context.fillStyle = changeColor;
    for (const mark of changes) {
      context.fillRect(0, lineToY(mark.line, totalLines, height), 2, 2);
    }
    context.fillStyle = matchColor;
    for (const mark of matches) {
      context.fillRect(width - 3, lineToY(mark.line, totalLines, height), 3, 2);
    }

    const rect = viewportRect(topLine, visibleLines, totalLines, height);
    context.fillStyle = viewportColor;
    context.globalAlpha = 0.5;
    context.fillRect(0, rect.top, width, rect.height);
    context.globalAlpha = 1;
  }, [totalLines, topLine, visibleLines, density, matches, changes]);

  const seekTo = (clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    onSeek(yToLine(clientY - bounds.top, totalLines, bounds.height));
  };

  const visible = !autohide || hovered || dragging;

  return (
    <canvas
      ref={canvasRef}
      role="slider"
      tabIndex={-1}
      aria-label={t("minimap.label")}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, totalLines - 1)}
      aria-valuenow={topLine}
      className="h-full shrink-0 cursor-pointer transition-opacity"
      style={{
        width: "var(--w-minimap)",
        opacity: visible ? 1 : 0,
        transitionDuration: "var(--duration-fast)",
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekTo(event.clientY);
      }}
      onPointerMove={(event) => {
        if (dragging) seekTo(event.clientY);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
    />
  );
}
