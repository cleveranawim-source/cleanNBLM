// 이미지 blob ↔ canvas 공용 헬퍼

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
      reject(new Error('이미지를 읽지 못했습니다.'));
    };
    img.src = url;
  });
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.'))),
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

export function slideToImageData(slide, img) {
  const canvas = document.createElement('canvas');
  canvas.width = slide.width;
  canvas.height = slide.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, slide.width, slide.height) };
}
