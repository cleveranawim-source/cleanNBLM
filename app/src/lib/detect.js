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

  // [v3.5] 대비 중심 감지 + 히스테리시스.
  // 절대 밝기 게이트(luma>190/<128)는 반투명·회색 워터마크(luma 128~190)를
  // 통째로 놓치는 사각지대를 만들었다. 이제 극성은 대비의 부호로만 판정한다.
  //  - strong: |대비| > 민감도 (또는 극단 밝기에서 절반 문턱) — 글자 본체
  //  - weak:   |대비| > 민감도×0.35, chroma<95 — 안티앨리어싱 헤일로(유채색 배경 포함)
  // weak 픽셀은 strong에 연결된 경우에만 마스크에 포함시킨다(헤일로 성장).
  const weak = new Uint8Array(width * height);
  const strength = new Float32Array(width * height); // 성분별 최대 대비 판정용
  const strongList = [];
  // 핵심 영역 안 "확실한 잉크"(진한 명암+강대비) bbox — 잘린 성분 트리밍의 기준점
  const inkBox = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = window_.y0; y <= window_.y1; y += 1) {
    for (let x = window_.x0; x <= window_.x1; x += 1) {
      const idx = y * width + x;
      const o = idx * 4;
      const bg = boxMean(integral, width, height, x, y, blurRadius);
      const contrast = luma[idx] - bg;
      const chroma =
        Math.max(data[o], data[o + 1], data[o + 2]) -
        Math.min(data[o], data[o + 1], data[o + 2]);
      const wantBright = settings.polarity !== 'dark';
      const wantDark = settings.polarity !== 'bright';
      // [v3.6.3] 유채색 워터마크(Gemini 그라데이션 로고 등) 허용 —
      // 대비가 민감도의 1.7배를 넘는 뚜렷한 픽셀은 색이 있어도 워터마크 후보
      const chromaOkStrong = chroma < 68 || Math.abs(contrast) > settings.sensitivity * 1.7;
      const strongBright =
        wantBright &&
        chromaOkStrong &&
        (contrast > settings.sensitivity ||
          (luma[idx] > 214 && contrast > settings.sensitivity * 0.48));
      const strongDark =
        wantDark &&
        chromaOkStrong &&
        (-contrast > settings.sensitivity ||
          (luma[idx] < 86 && -contrast > settings.sensitivity * 0.48));
      // [v3.6.3] 고채도 경로 — 그라데이션 로고의 원색 픽셀은 배경과 밝기가
      // 비슷해도(대비↓) 색 자체가 극명히 다르다. chroma>135는 슬라이드 배경에서
      // 거의 나오지 않는 값(구글 브랜드 원색 175+, 일반 배경 <130).
      const vividStrong =
        chroma > 135 && Math.abs(contrast) > 4 &&
        ((wantBright && contrast > 0) || (wantDark && contrast < 0) || settings.polarity === 'both');
      if (strongBright || strongDark || vividStrong) {
        candidates[idx] = 1;
        strength[idx] = Math.max(
          Math.abs(contrast),
          vividStrong ? settings.sensitivity * 1.5 : 0,
        );
        strongList.push(idx);
        if (
          x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1 &&
          Math.abs(contrast) > settings.sensitivity * 1.3 &&
          (luma[idx] < 150 || luma[idx] > 205)
        ) {
          if (x < inkBox.minX) inkBox.minX = x;
          if (x > inkBox.maxX) inkBox.maxX = x;
          if (y < inkBox.minY) inkBox.minY = y;
          if (y > inkBox.maxY) inkBox.maxY = y;
        }
      } else if (
        (chroma < 95 || Math.abs(contrast) > settings.sensitivity * 0.9) &&
        ((wantBright && contrast > settings.sensitivity * 0.35) ||
          (wantDark && -contrast > settings.sensitivity * 0.35))
      ) {
        weak[idx] = 1;
        strength[idx] = Math.abs(contrast);
      }
    }
  }
  // 히스테리시스: strong에서 8방향으로 연결된 weak 픽셀로 성장.
  // 헤일로는 글자에서 몇 px 이내이므로 성장 깊이를 제한한다 —
  // 제한이 없으면 질감 배경의 저대비 라인을 따라 마스크가 번질 수 있다.
  const maxGrow = Math.max(3, Math.round(width / 400));
  let frontier = strongList.slice();
  for (let depth = 0; depth < maxGrow && frontier.length; depth += 1) {
    const next = [];
    for (const idx of frontier) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (weak[nIdx] && !candidates[nIdx]) {
            candidates[nIdx] = 1;
            next.push(nIdx);
          }
        }
      }
    }
    frontier = next;
  }
  return {
    candidates,
    strength,
    region,
    window: window_,
    inkBox: inkBox.maxX >= 0 ? inkBox : null,
  };
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

function filterComponents(components, width, region, windowRect, mode, strength, sensitivity, inkBox) {
  const mask = [];
  // 엄격 모드 상한은 해상도에 비례 (원본 튜닝 기준 ≈ 1400px 폭)
  const scale = Math.max(1, width / 1400);
  const windowArea = (windowRect.x1 - windowRect.x0 + 1) * (windowRect.y1 - windowRect.y0 + 1);
  for (const comp of components) {
    if (!intersectsRegion(comp, region)) continue;
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const size = comp.pixels.length;
    // [v3.5] 질감 오탐 억제
    let peak = 0;
    if (strength) {
      for (const idx of comp.pixels) if (strength[idx] > peak) peak = strength[idx];
    }
    // ① 얇은 수평 조각(배경 라인 파편) 거부
    if (h <= 3 && w >= h * 6) continue;
    // ② 탐색 창을 거의 가로지르는 넓은 띠 = 창에 잘린 배경 구조물.
    //    단, 피크 대비가 충분히 높으면 워터마크가 질감과 붙은 경우로 보고 유지.
    const windowW = windowRect.x1 - windowRect.x0 + 1;
    if (strength && sensitivity && w >= windowW * 0.9 && peak < sensitivity * 2) continue;
    // ③ 성분 최대 대비가 낮으면 배경 무늬로 판정.
    if (strength && sensitivity && peak < sensitivity * 1.25) continue;
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
    if (!keep) continue;
    // [v3.6] 창 경계에 잘린 성분은 트리밍 — 워터마크는 코너 영역 안에 담기므로,
    // 왼쪽/위쪽 창 경계에 닿은 성분(바깥에서 이어지는 사진 가장자리 등)은
    // 핵심 영역(+여유 4px) 안의 픽셀만 남겨 배경 뭉갬을 막는다.
    const clipped = comp.minX <= windowRect.x0 + 1 || comp.minY <= windowRect.y0 + 1;
    if (clipped) {
      // 잘린 성분(사진 콘텐츠가 섞임): 핵심 영역 안이면서, "확실한 잉크" bbox
      // 주변(±8px)에 있는 픽셀만 남긴다 — 글자와 그 헤일로는 유지되고,
      // bbox 밖의 그림자·가구 가장자리는 제외된다.
      const pad = 8;
      // 로고 기호는 항상 글자열 왼쪽(글자높이의 ~1.6배 거리)에 있으므로 좌측 패딩만 넓게
      const padLeft = inkBox
        ? Math.max(24, Math.round((inkBox.maxY - inkBox.minY + 1) * 2.5))
        : pad;
      for (const idx of comp.pixels) {
        const px = idx % width;
        const py = Math.floor(idx / width);
        if (px < region.x0 - 4 || py < region.y0 - 4) continue;
        // 위쪽 패딩은 2px만 — 글자 바로 위 행에 수평으로 이어지는
        // 사진 그림자 띠(글자만큼 어두움)가 마스크에 쓸려 들어오는 것을 막는다
        if (
          inkBox &&
          (px < inkBox.minX - padLeft || px > inkBox.maxX + pad ||
            py < inkBox.minY - 2 || py > inkBox.maxY + pad)
        ) {
          continue;
        }
        mask.push(idx);
      }
    } else {
      mask.push(...comp.pixels);
    }
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

// ── [P2] 템플릿 매칭 ─────────────────────────────────────────
// "NotebookLM" 글자 모양을 정규화 상관계수(NCC)로 우하단에서 직접 찾는다.
// 밝기·배경과 무관하게 위치를 잡으며(어두운 글자는 음의 상관으로 매칭),
// 실패하면 기존 임계값 캐스케이드로 폴백한다.

let templateCache = null;

// 3탭 박스 블러를 가로·세로로 2회 (≈ 가우시안 σ 1.2). 거친 탐색 전용 —
// 1~2px 획의 NCC 봉우리를 넓혀, 3px 간격 격자가 정답 근처를 놓치지 않게 한다.
function blurTwice(src, w, h) {
  let a = src;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) {
        const l = a[row + Math.max(0, x - 1)];
        const r = a[row + Math.min(w - 1, x + 1)];
        b[row + x] = (l + a[row + x] + r) / 3;
      }
    }
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const up = Math.max(0, y - 1) * w;
      const dn = Math.min(h - 1, y + 1) * w;
      const row = y * w;
      for (let x = 0; x < w; x += 1) c[row + x] = (b[up + x] + b[row + x] + b[dn + x]) / 3;
    }
    a = c;
  }
  return a;
}

function sampleStats(samples) {
  let mean = 0;
  for (const s of samples) mean += s.v;
  mean /= samples.length;
  let variance = 0;
  for (const s of samples) variance += (s.v - mean) ** 2;
  return { mean, std: Math.sqrt(variance / samples.length) };
}

function getTemplates() {
  if (templateCache) return templateCache;
  // NCC는 글자 크기에 민감하므로 10~20px 구간은 1px 단위로 촘촘하게
  const heights = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 27, 30];
  // 리브랜딩 대응: 두 가지 워터마크 문구를 모두 찾는다.
  // padLeft = 글자열 왼쪽 로고 기호까지의 여유(글자 크기 배수) —
  // Gemini Notebook의 돔 아이콘은 ◉보다 넓다.
  const texts = [
    { text: 'NotebookLM', padLeft: 1.6 },
    { text: 'Gemini Notebook', padLeft: 1.95 },
  ];
  templateCache = texts.flatMap(({ text, padLeft }) => heights
    .map((h) => {
      const cv = document.createElement('canvas');
      const probe = cv.getContext('2d');
      const font = `500 ${h}px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif`;
      probe.font = font;
      const textWidth = Math.ceil(probe.measureText(text).width);
      cv.width = textWidth + 4;
      cv.height = Math.ceil(h * 1.4);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#fff';
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 2, cv.height / 2);
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const raw = new Float32Array(cv.width * cv.height);
      for (let i = 0; i < raw.length; i += 1) raw[i] = data[i * 4];
      const soft = blurTwice(raw, cv.width, cv.height);
      // NCC 계산은 2px 격자 서브샘플로 (속도). samples=정밀용 원본, coarse=거친 탐색용 블러본
      const samples = [];
      const coarse = [];
      for (let y = 0; y < cv.height; y += 2) {
        for (let x = 0; x < cv.width; x += 2) {
          samples.push({ x, y, v: raw[y * cv.width + x] });
          coarse.push({ x, y, v: soft[y * cv.width + x] });
        }
      }
      const fine = sampleStats(samples);
      const rough = sampleStats(coarse);
      return {
        text,
        w: cv.width,
        h: cv.height,
        glyphHeight: h,
        padLeft,
        fine: { samples, mean: fine.mean, std: fine.std },
        coarse: { samples: coarse, mean: rough.mean, std: rough.std },
      };
    }))
    .filter((t) => t.fine.std > 1 && t.coarse.std > 1);
  return templateCache;
}

function nccAt(luma, width, set, px, py) {
  const { samples, mean: tMean, std: tStd } = set;
  let sum = 0;
  let sumSq = 0;
  let cross = 0;
  for (const s of samples) {
    const v = luma[(py + s.y) * width + px + s.x];
    sum += v;
    sumSq += v * v;
    cross += v * s.v;
  }
  const n = samples.length;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  if (variance < 1) return 0;
  const std = Math.sqrt(variance);
  return (cross / n - tMean * mean) / (tStd * std);
}

export function matchTemplate(luma, width, height) {
  // 탐색 창: 우하단 (슬라이더 설정과 무관하게 고정, 관대하게)
  const x0 = Math.floor(width * 0.7);
  const y0 = Math.floor(height * 0.84);
  const ww = width - x0;
  const wh = height - y0;
  const sub = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y += 1) {
    for (let x = 0; x < ww; x += 1) sub[y * ww + x] = luma[(y0 + y) * width + x0 + x];
  }
  const soft = blurTwice(sub, ww, wh);

  // [v3.8] 1단계(거친 탐색): 블러본끼리 3px 간격으로 비교해 템플릿마다 최고점 기록.
  // 원본끼리 3px 간격으로 비교하면 정답을 1px만 비껴가도 점수가 급락해,
  // 엉뚱한 크기의 템플릿이 약한 점수로 이기거나(끝 글자 누락) 매칭 자체가 실패했다.
  const perTemplate = [];
  for (const template of getTemplates()) {
    if (template.w >= ww || template.h >= wh) continue;
    let best = null;
    for (let y = 0; y <= wh - template.h; y += 3) {
      for (let x = 0; x <= ww - template.w; x += 3) {
        const score = nccAt(soft, ww, template.coarse, x, y);
        if (!best || Math.abs(score) > Math.abs(best.score)) best = { score, x, y };
      }
    }
    if (best) perTemplate.push({ template, x: best.x + x0, y: best.y + y0, coarse: best.score });
  }
  perTemplate.sort((a, b) => Math.abs(b.coarse) - Math.abs(a.coarse));

  // 2단계(정밀 탐색): 상위 후보 몇 개를 원본 해상도에서 ±3px, 1px 단위로 재평가
  let best = null;
  for (const cand of perTemplate.slice(0, 5)) {
    const { template } = cand;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const x = cand.x + dx;
        const y = cand.y + dy;
        if (x < 0 || y < 0 || x + template.w > width || y + template.h > height) continue;
        const score = nccAt(luma, width, template.fine, x, y);
        if (!best || Math.abs(score) > Math.abs(best.score)) best = { score, x, y, template };
      }
    }
  }
  if (!best || Math.abs(best.score) < 0.6) return null;
  return best;
}

// 템플릿 매칭 성공 시: 매칭 박스(+ 왼쪽 로고 기호 여유) 안에서만 대비 픽셀을 마스킹
function maskFromMatch(imageData, luma, integral, match, settings) {
  const { width, height } = imageData;
  const { data } = imageData;
  const t = match.template;
  const padLeft = Math.round(t.glyphHeight * t.padLeft); // "◉"·돔 아이콘 같은 선행 기호 포함
  const pad = Math.max(2, Math.round(t.glyphHeight * 0.2));
  const bx0 = Math.max(0, match.x - padLeft);
  const bx1 = Math.min(width - 1, match.x + t.w + pad);
  const by0 = Math.max(0, match.y - pad);
  const by1 = Math.min(height - 1, match.y + t.h + pad);
  const blurRadius = Math.max(4, Math.round(width / 280));
  const wantBright = match.score > 0;
  const mask = new Uint8Array(width * height);
  let count = 0;
  const minContrast = Math.max(5, settings.sensitivity * 0.45);
  for (let y = by0; y <= by1; y += 1) {
    for (let x = bx0; x <= bx1; x += 1) {
      const idx = y * width + x;
      const o = idx * 4;
      const bg = boxMean(integral, width, height, x, y, blurRadius);
      const contrast = luma[idx] - bg;
      const chroma =
        Math.max(data[o], data[o + 1], data[o + 2]) -
        Math.min(data[o], data[o + 1], data[o + 2]);
      if (chroma >= 95) continue;
      // [v3.5] 양방향 마스킹 — 외곽선·그림자·JPEG 링잉 등 반대 극성 성분도
      // 매칭 박스 안이라면 함께 지운다 (위치는 이미 NCC로 확정됨)
      if (Math.abs(contrast) > minContrast) {
        mask[idx] = 1;
        count += 1;
      }
    }
  }
  return { mask, count };
}

// 감지 본체 — { mask, pixelCount, mode, matchScore? } 반환
// options.template=false: 템플릿 매칭 생략 (잔여물 스윕처럼 위치가 이미 정해진 재감지용)
export function detectWatermark(imageData, settings, options = {}) {
  const { width, height } = imageData;

  // 1차: 템플릿 매칭 (설정 영역과 무관하게 로고 글자를 직접 탐색)
  const luma = new Float32Array(width * height);
  const { data } = imageData;
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    luma[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  const match = options.template === false ? null : matchTemplate(luma, width, height);
  let templateResult = null;
  // [v3.6.2] 매칭 위치 검증 — 진짜 워터마크는 감지 영역(점선 박스)과 겹친다.
  // 탐색 창 안의 슬라이드 콘텐츠(판서 밑줄 등)에 오매칭되면 기각하고 캐스케이드 사용.
  const regionForGate = regionRect(width, height, settings);
  const matchOverlapsRegion =
    match &&
    !(match.x + match.template.w < regionForGate.x0 - 12 ||
      match.x > regionForGate.x1 + 12 ||
      match.y + match.template.h < regionForGate.y0 - 12 ||
      match.y > regionForGate.y1 + 12);
  if (match && matchOverlapsRegion) {
    const integral = buildIntegral(luma, width, height);
    const fromMatch = maskFromMatch(imageData, luma, integral, match, settings);
    // [v3.5] 수락 기준을 템플릿 면적 비례로 — 부분 매칭(수십 px)이
    // 더 정확한 캐스케이드 폴백을 차단하지 않도록 한다
    const minAccept = Math.max(24, Math.round(match.template.w * match.template.h * 0.05));
    if (fromMatch.count >= minAccept) {
      templateResult = { mask: fromMatch.mask, count: fromMatch.count, score: match.score };
    }
  }

  // 2차: 임계값 + 연결성분 캐스케이드
  const { candidates, strength, region, window: windowRect, inkBox } = thresholdCandidates(imageData, settings);
  const components = collectComponents(candidates, width, height);

  // [v3.5] strict가 "일부만" 잡은 경우(예: 로고 기호나 파편만) lenient로 폴백.
  // lenient는 strict의 상위집합이므로, strict 픽셀 수가 lenient의 절반 미만이면
  // 글자 본체가 strict 크기 상한에서 통째로 탈락한 것으로 보고 lenient를 쓴다.
  let mode = 'strict';
  let kept = filterComponents(
    components, width, region, windowRect, 'strict', strength, settings.sensitivity, inkBox,
  );
  const lenientKept = filterComponents(
    components, width, region, windowRect, 'lenient', strength, settings.sensitivity, inkBox,
  );
  if (lenientKept.length && kept.length < lenientKept.length * 0.5) {
    mode = 'lenient';
    kept = lenientKept;
  }

  // [v3.6] 템플릿 결과 교차 검증 — NCC가 사진 텍스처 등에 오매칭되면
  // 엉뚱한 곳만 지우고 진짜 워터마크가 통째로 남는다(실파일 슬라이드 6 사례).
  // 캐스케이드가 템플릿보다 훨씬 많은 픽셀을 찾았다면 캐스케이드를 신뢰한다.
  if (templateResult && templateResult.count >= kept.length * 0.6) {
    const mask = dilate(templateResult.mask, width, height, settings.expansion);
    let pixelCount = 0;
    for (const v of mask) pixelCount += v;
    return { mask, pixelCount, mode: 'template', matchScore: templateResult.score };
  }

  let mask = new Uint8Array(width * height);
  for (const idx of kept) mask[idx] = 1;
  mask = dilate(mask, width, height, settings.expansion);

  let pixelCount = 0;
  for (const v of mask) pixelCount += v;
  return { mask, pixelCount, mode };
}
