import {
  useEffect,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { assetUrl } from "../ipc/assets";

export interface ImagePreviewProps {
  path: string;
  fileName: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export function clampImageZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function fittedScale(
  image: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): number {
  if (!image || viewport.width === 0 || viewport.height === 0) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

/** 本地图片走 asset 协议，既不读入编辑器正文，也不经 IPC 传输二进制。 */
export function ImagePreview({ path, fileName }: ImagePreviewProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scale = fittedScale(imageSize, viewport);
  const percentage = Math.round(zoom * 100);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const updateViewport = () =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    updateViewport();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const adjustZoom = (delta: number) =>
    setZoom((current) => clampImageZoom(current + delta));

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    adjustZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

  if (failed) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-[var(--space-4)] text-[var(--text-secondary)]">
        <p className="m-0" style={{ fontSize: "var(--font-size-ui)" }}>
          {t("imagePreview.unavailable")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 bg-[var(--bg-inset)]">
      <div
        ref={viewportRef}
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-[var(--space-4)]"
        onWheel={handleWheel}
      >
        <img
          src={assetUrl(path)}
          alt={fileName}
          className="shrink-0"
          onError={() => setFailed(true)}
          onLoad={(event) =>
            setImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={
            imageSize
              ? {
                  width: `${imageSize.width * scale * zoom}px`,
                  height: `${imageSize.height * scale * zoom}px`,
                }
              : { maxHeight: "100%", maxWidth: "100%" }
          }
        />
      </div>
      <div
        role="toolbar"
        aria-label={t("imagePreview.zoomControls")}
        className="absolute right-[var(--space-3)] top-[var(--space-3)] flex items-center gap-[var(--space-1)] border border-[var(--border-default)] bg-[var(--bg-raised)] p-[var(--space-1)]"
      >
        <IconButton
          icon="zoomOut"
          label={t("imagePreview.zoomOut")}
          disabled={zoom <= MIN_ZOOM}
          onClick={() => adjustZoom(-ZOOM_STEP)}
        />
        <button
          type="button"
          aria-label={t("imagePreview.resetZoom")}
          onClick={() => setZoom(1)}
          className="min-w-[48px] rounded-[var(--radius-control)] px-[var(--space-1)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          style={{ height: "var(--h-icon-button)", fontSize: "var(--font-size-small)" }}
        >
          {percentage}%
        </button>
        <IconButton
          icon="zoomIn"
          label={t("imagePreview.zoomIn")}
          disabled={zoom >= MAX_ZOOM}
          onClick={() => adjustZoom(ZOOM_STEP)}
        />
      </div>
    </div>
  );
}
