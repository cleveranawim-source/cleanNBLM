// 이미지 blob ↔ canvas 공용 헬퍼
import { t } from './i18n.js';

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t().errImageLoad));
    };
    img.src = url;
  });
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t().errImageConvert))),
      type,
      quality,
    );
  });
}

export function mimeFromName(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

// 슬라이드 한 장의 공통 데이터 구조
export async function buildSlide(blob, name, sourcePath, extra = {}) {
  const img = await loadImage(blob);
  return {
    id: crypto.randomUUID(),
    name,
    originalBlob: blob,
    originalUrl: URL.createObjectURL(blob),
    width: img.naturalWidth,
    height: img.naturalHeight,
    sourcePath,
    sourceMime: blob.type || mimeFromName(name),
    ...extra,
  };
}

// 색 프로필 변환 없이 파일에 저장된 그대로의 픽셀 — JPEG 계수를 부분 교체할 때
// 원본의 색 프로필과 같은 공간에서 계산해야 교체 부분만 색이 어긋나지 않는다
export async function decodeRawImageData(blob) {
  try {
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

export function slideToImageData(slide, img) {
  const canvas = document.createElement('canvas');
  canvas.width = slide.width;
  canvas.height = slide.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, slide.width, slide.height) };
}
