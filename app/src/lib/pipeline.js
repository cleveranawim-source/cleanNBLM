// [v3.6] 감지→복원→잔여물 스윕 파이프라인.
// 1차 복원 후 결과 이미지에서 워터마크를 다시 감지해(민감도 소폭 완화)
// 남은 조각을 최대 2회 추가 복원한다 — 부분 감지로 인한 잔여물의 안전망.
// 스윕은 1차 마스크의 bbox(+6px) 안으로 제한한다: 밖은 배경 콘텐츠이므로
// 건드리면 사진이 뭉개진다.
import { detectWatermark } from './detect.js';
import { inpaintMask } from './inpaint.js';

function maskBbox(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

export function cleanImage(imageData, mask, settings) {
  const { width, height } = imageData;
  let out = inpaintMask(imageData, mask, settings.searchRadius);
  const box = maskBbox(mask, width, height);
  let sweptPx = 0;
  if (box) {
    const pad = 6;
    const x0 = Math.max(0, box.minX - pad);
    const x1 = Math.min(width - 1, box.maxX + pad);
    const y0 = Math.max(0, box.minY - pad);
    const y1 = Math.min(height - 1, box.maxY + pad);
    for (let pass = 0; pass < 2; pass += 1) {
      const sweepSettings = {
        ...settings,
        sensitivity: Math.max(9, Math.round(settings.sensitivity * 0.8)),
      };
      const det = detectWatermark(out, sweepSettings);
      const sweepMask = new Uint8Array(width * height);
      let count = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const idx = y * width + x;
          if (det.mask[idx]) {
            sweepMask[idx] = 1;
            count += 1;
          }
        }
      }
      if (count < 12) break;
      out = inpaintMask(out, sweepMask, settings.searchRadius);
      sweptPx += count;
    }
  }
  return { imageData: out, sweptPx };
}
