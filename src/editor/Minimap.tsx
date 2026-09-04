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
import {
  lineToY,
  resampleDensity,
  viewportRectFromScroll,
} from "../lib/minimap";

interface CanvasSize {
  width: number;
  height: number;
  ratio: number;
}

const EMPTY_CANVAS_SIZE: CanvasSize = { width: 0, height: 0, ratio: 1 };

export interface MinimapMark {
  line: number;
}

interface MinimapProps {
  totalLines: number;
  /** 原生滚动容器在可滚动距离中的位置（0..1）。 */
  scrollProgress: number;
  /** 视口高度占完整滚动高度的比例（0..1）。 */
  viewportFraction: number;
  /** Tier A 的行长度密度（0..1，每像素一格）；Tier B/C 传空数组 */
  density: readonly number[];
  matches: readonly MinimapMark[];
  changes: readonly MinimapMark[];
  autohide: boolean;
  /** 只滚动页面，不改变光标或选区。 */
  onScrollProgress: (progress: number) => void;
}

function cssColor(element: HTMLElement, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function Minimap({
  totalLines,
  scrollProgress,
  viewportFraction,
  density,
  matches,
  changes,
  autohide,
  onScrollProgress,
}: MinimapProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(EMPTY_CANVAS_SIZE);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      const next = {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        ratio: window.devicePixelRatio || 1,
      };
      setCanvasSize((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.ratio === next.ratio
          ? previous
          : next,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(canvas);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const { width, height, ratio } = canvasSize;
    if (width === 0 || height === 0) return;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    // 设置 width / height 会重置整个 2D 上下文。只在尺寸或 DPR 真正变化时设置，
    // 避免滚动期间反复释放并重建画布后备缓冲。
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const textColor = cssColor(canvas, "--text-tertiary");
    const matchColor = cssColor(canvas, "--accent");
    const changeColor = cssColor(canvas, "--diff-modify-gutter");

    context.fillStyle = textColor;
    resampleDensity(density, Math.ceil(height)).forEach((value, y) => {
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
  }, [
    totalLines,
    density,
    matches,
    changes,
    canvasSize,
  ]);

  const scrollFromPointer = (clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const rect = viewportRectFromScroll(
      scrollProgress,
      viewportFraction,
      bounds.height,
    );
    const trackHeight = Math.max(0, bounds.height - rect.height);
    if (trackHeight === 0) {
      onScrollProgress(0);
      return;
    }
    const thumbTop = Math.min(
      trackHeight,
      Math.max(0, clientY - bounds.top - dragOffsetRef.current),
    );
    onScrollProgress(thumbTop / trackHeight);
  };

  const visible = !autohide || hovered || dragging;
  const viewport = viewportRectFromScroll(
    scrollProgress,
    viewportFraction,
    canvasSize.height,
  );

  return (
    <div
      className="absolute bottom-0 right-[var(--w-scrollbar)] top-0 z-20 h-full bg-[var(--bg-base)]"
      style={{
        width: "var(--w-minimap)",
      }}
    >
      <canvas
        ref={canvasRef}
        role="slider"
        tabIndex={-1}
        aria-label={t("minimap.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scrollProgress * 100)}
        aria-valuetext={`${Math.round(scrollProgress * 100)}%`}
        className={`block h-full w-full transition-opacity ${dragging ? "cursor-grabbing" : "cursor-pointer"}`}
        style={{
          opacity: visible ? 1 : 0,
          transitionDuration: "var(--duration-fast)",
          touchAction: "none",
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          const rect = viewportRectFromScroll(
            scrollProgress,
            viewportFraction,
            bounds.height,
          );
          const localY = event.clientY - bounds.top;
          dragOffsetRef.current =
            localY >= rect.top && localY <= rect.top + rect.height
              ? localY - rect.top
              : rect.height / 2;
          draggingRef.current = true;
          setDragging(true);
          scrollFromPointer(event.clientY);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) scrollFromPointer(event.clientY);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          draggingRef.current = false;
          setDragging(false);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          draggingRef.current = false;
          setDragging(false);
        }}
      />
      <div
        data-minimap-viewport
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 w-full bg-[var(--bg-hover)] transition-opacity"
        style={{
          height: `${viewport.height}px`,
          opacity: visible ? (dragging ? 0.8 : hovered ? 0.65 : 0.5) : 0,
          transform: `translateY(${viewport.top}px)`,
          transitionDuration: "var(--duration-fast)",
        }}
      />
    </div>
  );
}
