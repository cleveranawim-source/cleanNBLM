// [v3.6] 감지→복원→잔여물 스윕 파이프라인.
// 1차 복원 후 결과 이미지에서 워터마크를 다시 감지해(민감도 소폭 완화)
// 남은 조각을 최대 2회 추가 복원한다 — 부분 감지로 인한 잔여물의 안전망.
// 스윕은 1차 마스크의 bbox(+6px) 안으로 제한한다: 밖은 배경 콘텐츠이므로
// 건드리면 사진이 뭉개진다.
import { detectWatermark } from './detect.js';
import { inpaintMask } from './inpaint.js';
import { analyzeGemini, geminiMask, restoreGemini } from './gemini.js';

// Gemini 워터마크 영역(+2px) 밖에 남은 마스크 = 사용자가 브러시로 더 칠한 부분
function extraMask(mask, covered, width, height) {
  const grown = new Uint8Array(covered.length);
  for (let i = 0; i < covered.length; i += 1) {
    if (!covered[i]) continue;
    const x = i % width;
    const y = (i / width) | 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) grown[ny * width + nx] = 1;
      }
    }
  }
  const extra = new Uint8Array(mask.length);
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] && !grown[i]) {
      extra[i] = 1;
      count += 1;
    }
  }
  return { extra, count };
}

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

// options.lossy: JPEG처럼 손실 압축된 원본 (Gemini 워터마크 역산 대신 넓혀 채움)
export function cleanImage(imageData, mask, settings, options = {}) {
  const { width, height } = imageData;
  const gemini = analyzeGemini(imageData);
  if (gemini) {
    let restored = restoreGemini(imageData, gemini, settings.searchRadius, { lossy: !!options.lossy });
    const covered = geminiMask(imageData, gemini.loc, gemini.pill, Math.max(3, Math.round(3 * gemini.loc.s)));
    const { extra, count } = extraMask(mask, covered, width, height);
    if (count) restored = inpaintMask(restored, extra, settings.searchRadius);
    return { imageData: restored, sweptPx: 0 };
  }
  let out = inpaintMask(imageData, mask, settings.searchRadius);
  const box = maskBbox(mask, width, height);
  let sweptPx = 0;
  if (box) {
    const pad = 6;
    const x0 = Math.max(0, box.minX - pad);
    const x1 = Math.min(width - 1, box.maxX + pad);
    const y0 = Math.max(0, box.minY - pad);
    const y1 = Math.min(height - 1, box.maxY + pad);
    // 감지 영역을 1차 마스크 bbox까지 넓힌다 — 긴 워터마크(Gemini Notebook 큰 글자)는
    // 점선 영역 밖까지 뻗고, 영역과 안 겹치는 잔여 조각은 캐스케이드가 버리기 때문
    const rx0 = Math.min(x0, Math.floor(width * (1 - settings.rightMargin - settings.regionWidth)));
    const ry0 = Math.min(y0, Math.floor(height * (1 - settings.bottomMargin - settings.regionHeight)));
    const rx1 = Math.max(x1, Math.ceil(width * (1 - settings.rightMargin)));
    const ry1 = Math.max(y1, Math.ceil(height * (1 - settings.bottomMargin)));
    const sweepRegion = {
      rightMargin: (width - rx1) / width,
      bottomMargin: (height - ry1) / height,
      regionWidth: (rx1 - rx0) / width,
      regionHeight: (ry1 - ry0) / height,
    };
    for (let pass = 0; pass < 2; pass += 1) {
      const sweepSettings = {
        ...settings,
        ...sweepRegion,
        sensitivity: Math.max(9, Math.round(settings.sensitivity * 0.8)),
      };
      const det = detectWatermark(out, sweepSettings, { template: false });
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
