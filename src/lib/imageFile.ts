/**
 * 浏览器可直接预览的本地图像类型。打开流程据此避开文本解码器，避免把图片误判成
 * 二进制文本；格式范围与 WebView 的 `<img>` 支持范围保持一致。
 */
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

export function isImageFilePath(path: string): boolean {
  const pathParts = path.split(/[\\/]/);
  const name = pathParts[pathParts.length - 1] ?? "";
  const nameParts = name.split(".");
  const extension = (nameParts[nameParts.length - 1] ?? "").toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}
