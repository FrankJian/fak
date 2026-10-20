import { useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { assetUrl } from "../ipc/assets";

export interface ImagePreviewProps {
  path: string;
  fileName: string;
}

/** 本地图片走 asset 协议，既不读入编辑器正文，也不经 IPC 传输二进制。 */
export function ImagePreview({ path, fileName }: ImagePreviewProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

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
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto bg-[var(--bg-inset)] p-[var(--space-4)]">
      <img
        src={assetUrl(path)}
        alt={fileName}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
