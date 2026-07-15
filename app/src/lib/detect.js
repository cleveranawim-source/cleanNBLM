// 워터마크 감지: 우하단 영역에서 주변 대비가 큰 무채색 픽셀을 찾는다.
//
// [P0-2] 연결성분 필터를 2단계 캐스케이드로 완화:
//   1차(엄격) — 기존 동작. "글자 하나" 크기의 성분만 통과 (샘플 PPTX 튜닝값, 해상도 비례 스케일).
//   2차(완화) — 1차가 0px이면 자동 재시도. 글자들이 안티앨리어싱으로 붙어
//               한 덩어리가 된 워터마크도 통과시키되, 감지 영역을 거의 다 덮는
//               "배경 홍수" 성분만 걸러낸다.

export const DEFAULT_SETTINGS = {
  sensitivity: 16,
  expansion: 1,
  regionWidth: 0.082,
  regionHeight: 0.029,
  rightMargin: 0.006,
  bottomMargin: 0.006,
  polarity: 'both',
  searchRadius: 24,
};

export function regionRect(width, height, s) {
  return {
    x0: Math.max(0, Math.floor(width * (1 - s.rightMargin - s.regionWidth))),
    x1: Math.min(width - 1, Math.ceil(width * (1 - s.rightMargin))),
    y0: Math.max(0, Math.floor(height * (1 - s.bottomMargin - s.regionHeight))),
    y1: Math.min(height - 1, Math.ceil(height * (1 - s.bottomMargin))),
  };
}

function buildIntegral(luma, width, height) {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += luma[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  return integral;
}

function boxMean(integral, width, height, x, y, radius) {
  const stride = width + 1;
  const left = Math.max(0, x - radius);
  const top = Math.max(0, y - radius);
  const right = Math.min(width - 1, x + radius);
  const bottom = Math.min(height - 1, y + radius);
  return (
    (integral[(bottom + 1) * stride + right + 1] -
      integral[top * stride + right + 1] -
      integral[(bottom + 1) * stride + left] +
      integral[top * stride + left]) /
    ((right - left + 1) * (bottom - top + 1))
  );
}

// 감지 영역보다 살짝 넓은 "후보 탐색 창".
// 워터마크가 영역 경계에 몇 픽셀 걸쳐 있어도 성분 전체를 잡을 수 있게 한다.
// (채택 여부는 나중에 "핵심 영역과 겹치는가"로 판정)
function expandedRect(region, width, height) {
  const growX = Math.round((region.x1 - region.x0 + 1) * 0.5);
  const growY = Math.round((region.y1 - region.y0 + 1) * 1.0);
  return {
    x0: Math.max(0, region.x0 - growX),
    x1: width - 1,
    y0: Math.max(0, region.y0 - growY),
    y1: height - 1,
  };
}

// 임계값 단계: 탐색 창 안에서 워터마크 후보 픽셀 표시
function thresholdCandidates(imageData, settings) {
  const { width, height, data } = imageData;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    luma[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  const integral = buildIntegral(luma, width, height);
  const candidates = new Uint8Array(width * height);
  const region = regionRect(width, height, settings);
  const window_ = expandedRect(region, width, height);
  const blurRadius = Math.max(4, Math.round(width / 280));

  for (let y = window_.y0; y <= window_.y1; y += 1) {
    for (let x = window_.x0; x <= window_.x1; x += 1) {
      const idx = y * width + x;
      const o = idx * 4;
      const bg = boxMean(integral, width, height, x, y, blurRadius);
      const contrast = luma[idx] - bg;
      const chroma =
        Math.max(data[o], data[o + 1], data[o + 2]) -
        Math.min(data[o], data[o + 1], data[o + 2]);
      const isBright =
        luma[idx] > 190 &&
        chroma < 68 &&
        (contrast > settings.sensitivity ||
          (luma[idx] > 214 && contrast > settings.sensitivity * 0.48));
      const isDark =
        luma[idx] < 86 &&
        chroma < 68 &&
        (-contrast > settings.sensitivity ||
          (luma[idx] < 55 && -contrast > settings.sensitivity * 0.48));
      if (
        (settings.polarity === 'bright' && isBright) ||
        (settings.polarity === 'dark' && isDark) ||
        (settings.polarity === 'both' && (isBright || isDark))
      ) {
        candidates[idx] = 1;
      }
    }
  }
  return { candidates, region, window: window_ };
}

// 연결성분(8방향) 수집
function collectComponents(candidates, width, height) {
  const visited = new Uint8Array(candidates.length);
  const components = [];
  const stack = [];
  for (let start = 0; start < candidates.length; start += 1) {
    if (!candidates[start] || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    const pixels = [];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    while (stack.length) {
      const idx = stack.pop();
      pixels.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (candidates[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    components.push({ pixels, minX, maxX, minY, maxY });
  }
  return components;
}

// 성분이 핵심 감지 영역과 겹치는지 (탐색 창에서 찾았어도 영역 밖 콘텐츠는 제외)
function intersectsRegion(comp, region) {
  return !(
    comp.maxX < region.x0 ||
    comp.minX > region.x1 ||
    comp.maxY < region.y0 ||
    comp.minY > region.y1
  );
}

function filterComponents(components, width, region, windowRect, mode) {
  const mask = [];
  // 엄격 모드 상한은 해상도에 비례 (원본 튜닝 기준 ≈ 1400px 폭)
  const scale = Math.max(1, width / 1400);
  const windowArea = (windowRect.x1 - windowRect.x0 + 1) * (windowRect.y1 - windowRect.y0 + 1);
  for (const comp of components) {
    if (!intersectsRegion(comp, region)) continue;
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const size = comp.pixels.length;
    let keep;
    if (mode === 'strict') {
      keep =
        size >= 2 &&
        size <= 420 * scale * scale &&
        w <= 38 * scale &&
        h <= 28 * scale &&
        comp.minX < width - 8;
    } else {
      // 완화 모드: 점 노이즈(1px)와, 탐색 창을 거의 다 덮는 배경 홍수만 제외
      keep = size >= 2 && size <= windowArea * 0.92;
    }
    if (keep) mask.push(...comp.pixels);
  }
  return mask;
}

function dilate(mask, width, height, iterations) {
  if (iterations <= 0) return mask;
  let current = mask;
  for (let it = 0; it < iterations; it += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (current[idx]) continue;
        if (
          current[idx - 1] || current[idx + 1] ||
          current[idx - width] || current[idx + width] ||
          current[idx - width - 1] || current[idx - width + 1] ||
          current[idx + width - 1] || current[idx + width + 1]
        ) {
          next[idx] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

// 감지 본체 — { mask, pixelCount, mode } 반환
export function detectWatermark(imageData, settings) {
  const { width, height } = imageData;
  const { candidates, region, window: windowRect } = thresholdCandidates(imageData, settings);
  const components = collectComponents(candidates, width, height);

  let mode = 'strict';
  let kept = filterComponents(components, width, region, windowRect, 'strict');
  if (!kept.length) {
    mode = 'lenient';
    kept = filterComponents(components, width, region, windowRect, 'lenient');
  }

  let mask = new Uint8Array(width * height);
  for (const idx of kept) mask[idx] = 1;
  mask = dilate(mask, width, height, settings.expansion);

  let pixelCount = 0;
  for (const v of mask) pixelCount += v;
  return { mask, pixelCount, mode };
}
