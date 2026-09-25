// [v3.9] Gemini Notebook 워터마크 전용 복원.
//
// 실제 내보내기 파일(1376×768) 43장 실측으로 확인한 사실:
//  - 워터마크는 슬라이드 우하단 고정 위치에, 고정된 알파 지도로 순수 검정(0) 또는
//    순수 흰색(255)을 덧칠한 것이다 (7장 추출 지도의 상관계수 1.000).
//    → 배지가 없으면 덧칠을 역산해 원래 배경을 그대로 되살릴 수 있다.
//  - 사진처럼 복잡한 배경에서는 글자 아래에 둥근 배지(112×26, 반지름 9)가 깔린다.
//    배지 안은 배경을 강하게 흐리고 색을 입힌 것이라 역산이 불가능하므로,
//    배지 전체를 주변에서 조화 보간 + 질감으로 다시 채운다.
import { inpaintMask } from './inpaint.js';
import { structuredFill } from './structfill.js';
import { guidedPillFill } from './pillguide.js';

// 글자 알파 지도 108×18 (16비트 LE, 0~65535), 기준 해상도 1376×768에서 원점 (1264, 744).
// 민무늬 슬라이드 9장(검정 8·흰색 1)의 채널별 역산 평균 — 잡음 바닥 0.0003.
// 가장자리의 아주 옅은 안티앨리어싱(3% 미만)까지 담아야 역산 뒤 윤곽 잔상이 남지 않는다.
const ALPHA_B64 =
  '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';
const TW = 108;
const TH = 18;
const REF_W = 1376;
// 기준 해상도에서 템플릿 원점의 오른쪽·아래 가장자리 거리
const OFF_RIGHT = REF_W - 1264;
const OFF_BOTTOM = 768 - 744;
// 배지(1262..1373 × 740..765, 반지름 9): 템플릿 원점 기준 상대 위치(기준 해상도)
const PILL = { dx0: -2, dx1: 109, dy0: -4, dy1: 21, r: 9 };
// 이보다 불투명한 픽셀은 역산하지 않고 주변으로 메운다. 역산 오차는 1/(1−α)로 증폭되고,
// 질감 배경에서는 워터마크 합성 뒤 리샘플링 흔적 때문에 중간 알파부터 윤곽 잔상이 남는다
// (실파일 35장 잔상 점수: 0.72→0.026, 0.35→0.010, 자연 배경 대조군 0.019)
const ALPHA_CORE = 0.35;

// 회귀 테스트가 실제 워터마크를 합성할 때 쓰는 기준 형상
export function geminiReference() {
  return { alpha: getAlpha(), w: TW, h: TH, refW: REF_W, offRight: OFF_RIGHT, offBottom: OFF_BOTTOM, pill: PILL };
}

let baseAlpha = null;
function getAlpha() {
  if (baseAlpha) return baseAlpha;
  const bin = atob(ALPHA_B64);
  baseAlpha = new Float32Array(TW * TH);
  for (let i = 0; i < baseAlpha.length; i += 1) {
    baseAlpha[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 65535;
  }
  return baseAlpha;
}

// 알파 지도를 배율 s로 재표본화 (면적 평균에 가까운 쌍선형)
const scaledCache = new Map();
function scaledAlpha(s) {
  const key = s.toFixed(4);
  if (scaledCache.has(key)) return scaledCache.get(key);
  const src = getAlpha();
  if (Math.abs(s - 1) < 1e-3) {
    const res = { w: TW, h: TH, a: src };
    scaledCache.set(key, res);
    return res;
  }
  const w = Math.max(8, Math.round(TW * s));
  const h = Math.max(3, Math.round(TH * s));
  const a = new Float32Array(w * h);
  const sub = 3;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let sy = 0; sy < sub; sy += 1) {
        for (let sx = 0; sx < sub; sx += 1) {
          const fx = ((x + (sx + 0.5) / sub) * TW) / w - 0.5;
          const fy = ((y + (sy + 0.5) / sub) * TH) / h - 0.5;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const at = (xx, yy) =>
            xx < 0 || yy < 0 || xx >= TW || yy >= TH ? 0 : src[yy * TW + xx];
          sum +=
            at(x0, y0) * (1 - tx) * (1 - ty) +
            at(x0 + 1, y0) * tx * (1 - ty) +
            at(x0, y0 + 1) * (1 - tx) * ty +
            at(x0 + 1, y0 + 1) * tx * ty;
        }
      }
      a[y * w + x] = sum / (sub * sub);
    }
  }
  const res = { w, h, a };
  scaledCache.set(key, res);
  return res;
}

const lumaAt = (data, idx) => data[idx * 4] * 0.299 + data[idx * 4 + 1] * 0.587 + data[idx * 4 + 2] * 0.114;

// 고역 통과(자기 − 2px 떨어진 상하좌우 평균) — 카드 경계·그라데이션 같은 느린 배경 변화를 지워
// 글자 모양만 비교한다. 배경 경계가 글자 상자를 가로지르면 일반 NCC는 0.73까지 떨어지지만
// 고역 NCC는 0.96을 유지하고, 3px만 어긋나도 0.07로 떨어져 위치도 더 정확하다
function highPass(src, w, h) {
  const out = new Float32Array(w * h);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : src[y * w + x]);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
        const v = at(x + dx, y + dy);
        if (v !== null) {
          sum += v;
          n += 1;
        }
      }
      out[y * w + x] = src[y * w + x] - (n ? sum / n : 0);
    }
  }
  return out;
}

const hpCache = new Map();
function templateHighPass(tpl) {
  if (hpCache.has(tpl)) return hpCache.get(tpl);
  // 템플릿 바깥은 알파 0(배경)으로 본다
  const pad = 2;
  const w = tpl.w + pad * 2;
  const h = tpl.h + pad * 2;
  const padded = new Float32Array(w * h);
  for (let y = 0; y < tpl.h; y += 1) {
    for (let x = 0; x < tpl.w; x += 1) padded[(y + pad) * w + x + pad] = tpl.a[y * tpl.w + x];
  }
  const hp = highPass(padded, w, h);
  const out = new Float32Array(tpl.w * tpl.h);
  for (let y = 0; y < tpl.h; y += 1) {
    for (let x = 0; x < tpl.w; x += 1) out[y * tpl.w + x] = hp[(y + pad) * w + x + pad];
  }
  hpCache.set(tpl, out);
  return out;
}

function ncc(image, iw, px, py, t, tw, th) {
  let n = 0;
  let sa = 0;
  let sv = 0;
  let saa = 0;
  let svv = 0;
  let sav = 0;
  for (let y = 0; y < th; y += 1) {
    const row = (py + y) * iw + px;
    for (let x = 0; x < tw; x += 1) {
      const av = t[y * tw + x];
      const v = image[row + x];
      n += 1;
      sa += av;
      sv += v;
      saa += av * av;
      svv += v * v;
      sav += av * v;
    }
  }
  const cov = sav / n - (sa / n) * (sv / n);
  const va = saa / n - (sa / n) ** 2;
  const vv = svv / n - (sv / n) ** 2;
  if (va <= 0 || vv < 0.25) return 0;
  return cov / Math.sqrt(va * vv);
}

// 워터마크 위치 찾기 — 기대 위치 주변만 탐색하므로 빠르고, 슬라이드 콘텐츠에 오매칭되지 않는다.
// 반환: { x, y, s, score, ink(0|255), tpl } 또는 null
export function locateGemini(imageData) {
  const { width, height, data } = imageData;
  const base = width / REF_W;
  if (width < 400 || height < 200) return null;
  // 탐색 창(모든 배율·오프셋을 덮는 우하단 영역)의 루마와 고역 성분을 한 번만 계산
  const wx0 = Math.max(0, Math.floor(width - OFF_RIGHT * base * 1.1 - 8 * base - 6));
  const wy0 = Math.max(0, Math.floor(height - OFF_BOTTOM * base * 1.1 - 8 * base - 6));
  const ww = width - wx0;
  const wh = height - wy0;
  const lum = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y += 1) {
    for (let x = 0; x < ww; x += 1) lum[y * ww + x] = lumaAt(data, (wy0 + y) * width + wx0 + x);
  }
  const hp = highPass(lum, ww, wh);
  let best = null;
  for (const factor of [1, 0.96, 1.04, 0.92, 1.08]) {
    const s = base * factor;
    const tpl = scaledAlpha(s);
    const thp = templateHighPass(tpl);
    const cx = Math.round(width - OFF_RIGHT * s);
    const cy = Math.round(height - OFF_BOTTOM * s);
    const r = Math.max(5, Math.round(6 * s));
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < wx0 || y < wy0 || x + tpl.w > width || y + tpl.h > height) continue;
        const score = ncc(hp, ww, x - wx0, y - wy0, thp, tpl.w, tpl.h);
        if (!best || Math.abs(score) > Math.abs(best.score)) best = { x, y, s, score, tpl };
      }
    }
    // 정배율에서 확실히 찾았으면 다른 배율은 볼 필요 없다
    if (best && Math.abs(best.score) > 0.9) break;
  }
  if (!best) return null;
  // 위치는 고역 NCC로 잡고, 수락은 고역(≥0.8) 또는 일반 NCC(≥0.85) 중 하나로 —
  // 리샘플된 PDF 렌더링은 고역 성분이 뭉개져 고역 점수만으로는 경계선(0.81)에 걸린다
  if (Math.abs(best.score) < 0.8) {
    const plain = ncc(lum, ww, best.x - wx0, best.y - wy0, best.tpl.a, best.tpl.w, best.tpl.h);
    if (Math.abs(plain) < 0.85 || Math.sign(plain) !== Math.sign(best.score)) return null;
  }
  return { ...best, ink: best.score > 0 ? 255 : 0 };
}

function pillRect(loc, width, height) {
  const { x, y, s } = loc;
  return {
    x0: Math.max(0, Math.round(x + PILL.dx0 * s)),
    x1: Math.min(width - 1, Math.round(x + PILL.dx1 * s)),
    y0: Math.max(0, Math.round(y + PILL.dy0 * s)),
    y1: Math.min(height - 1, Math.round(y + PILL.dy1 * s)),
    r: PILL.r * s,
  };
}

function insidePill(P, px, py) {
  if (px < P.x0 || px > P.x1 || py < P.y0 || py > P.y1) return false;
  const fx = px + 0.5;
  const fy = py + 0.5;
  const cxL = P.x0 + P.r;
  const cxR = P.x1 + 1 - P.r;
  const cyT = P.y0 + P.r;
  const cyB = P.y1 + 1 - P.r;
  const cx = fx < cxL ? cxL : fx > cxR ? cxR : null;
  const cy = fy < cyT ? cyT : fy > cyB ? cyB : null;
  if (cx === null || cy === null) return true;
  return (fx - cx) ** 2 + (fy - cy) ** 2 <= P.r * P.r;
}

// 배지 유무 — 배지 안은 배경을 흐려 질감이 사라지고, 경계에 밝기 단차가 생긴다
function detectPill(imageData, P, s) {
  const { width, height, data } = imageData;
  const L = (x, y) => lumaAt(data, y * width + x);
  if (pillEdgeScore(imageData, P, s) >= 0.75) return true;
  const inb = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
  const lap = (x, y) =>
    Math.abs(4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1));
  const band = Math.max(1, Math.round((P.y1 - P.y0) / 26));
  const margin = Math.round(P.r * 1.8);
  let inE = 0;
  let inN = 0;
  let outE = 0;
  let outN = 0;
  for (let x = P.x0 + margin; x <= P.x1 - margin; x += 1) {
    for (const k of [3, 4, 5]) {
      const yi = P.y0 + k * band;
      if (inb(x, yi)) { inE += lap(x, yi); inN += 1; }
      const yo = P.y0 - (k + 1) * band;
      if (inb(x, yo)) { outE += lap(x, yo); outN += 1; }
    }
  }
  const texIn = inN ? inE / inN : 0;
  const texOut = outN ? outE / outN : 0;
  return texOut >= 2 && texIn < texOut * 0.35;
}

// 배지 경계를 가로지르는 밝기 단차가, 바로 바깥의 같은 간격 대조 단차보다 뚜렷한 비율.
// 배경 기울기와 무관하고 해상도가 달라도 유지된다 (실파일: 배지 0.76~1.00, 없음 ≤0.48)
function pillEdgeScore(imageData, P, s) {
  const { width, height, data } = imageData;
  const L = (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.round(y)));
    return lumaAt(data, cy * width + cx);
  };
  const d = Math.max(1.5, 1.5 * s);
  const g = Math.max(1, s);
  const crosses = (e, c) => e > Math.max(3, 2 * c + 1.5);
  let hit = 0;
  let n = 0;
  for (let t = 0.15; t <= 0.851; t += 0.02) {
    const x = P.x0 + (P.x1 - P.x0) * t;
    const e = Math.abs(L(x, P.y0 + d) - L(x, P.y0 - 1 - d));
    const c = Math.abs(L(x, P.y0 - 1 - d - 2 * g) - L(x, P.y0 - 1 - 3 * d - 2 * g));
    n += 1;
    if (crosses(e, c)) hit += 1;
  }
  for (let t = 0.35; t <= 0.651; t += 0.05) {
    const y = P.y0 + (P.y1 - P.y0) * t;
    const e = Math.abs(L(P.x0 + d, y) - L(P.x0 - 1 - d, y));
    const c = Math.abs(L(P.x0 - 1 - d - 2 * g, y) - L(P.x0 - 1 - 3 * d - 2 * g, y));
    n += 1;
    if (crosses(e, c)) hit += 1;
  }
  return hit / n;
}

// 화면 표시·일반 경로 호환용 마스크 (배지면 배지 전체, 아니면 글자 알파>3%) — grow px만큼 넓힌다
export function geminiMask(imageData, loc, pill, grow = 1) {
  const { width, height } = imageData;
  const mask = new Uint8Array(width * height);
  if (pill) {
    const P = pillRect(loc, width, height);
    const pad = grow;
    const Q = { x0: P.x0 - pad, x1: P.x1 + pad, y0: P.y0 - pad, y1: P.y1 + pad, r: P.r + pad };
    for (let y = Math.max(0, Q.y0); y <= Math.min(height - 1, Q.y1); y += 1) {
      for (let x = Math.max(0, Q.x0); x <= Math.min(width - 1, Q.x1); x += 1) {
        if (insidePill(Q, x, y)) mask[y * width + x] = 1;
      }
    }
    return mask;
  }
  const { w, h, a } = loc.tpl;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (a[y * w + x] <= 0.03) continue;
      for (let dy = -grow; dy <= grow; dy += 1) {
        for (let dx = -grow; dx <= grow; dx += 1) {
          const gx = loc.x + x + dx;
          const gy = loc.y + y + dy;
          if (gx >= 0 && gy >= 0 && gx < width && gy < height) mask[gy * width + gx] = 1;
        }
      }
    }
  }
  return mask;
}

export function analyzeGemini(imageData) {
  const loc = locateGemini(imageData);
  if (!loc) return null;
  const pill = detectPill(imageData, pillRect(loc, imageData.width, imageData.height), loc.s);
  return { loc, pill };
}

// 복원 본체 — 새 ImageData 반환
// lossy=true: JPEG 원본 — 압축이 덧칠 픽셀을 뭉개고 글자 주변에 링잉(번짐)을 남겨 역산이 맞지 않는다.
// 역산 없이 글자를 3px 넓혀 채운다 (실파일 JPEG q75~95: 2px는 q75에서 점 잔상, 3px는 깨끗)
export function restoreGemini(imageData, info, searchRadius = 24, { lossy = false } = {}) {
  const { width, height } = imageData;
  const { loc, pill } = info;
  // 채우기는 조화 보간만 쓴다: 양파껍질의 경계 페더링은 원래 픽셀을 22% 남겨
  // 가는 글자 심지에 어두운 잔상(평균 −37 luma)을 만들고, 패치 질감 복사는
  // 배지 테두리의 사진 경계선 조각을 흩뿌려 줄무늬를 만든다 (실파일 측정)
  const fill = { smooth: true, texture: false };
  if (pill) {
    const pad = lossy ? Math.max(3, Math.round(3 * loc.s)) : Math.max(1, Math.round(loc.s));
    const mask = geminiMask(imageData, loc, true, pad);
    // 배지가 색 경계(카드 모서리·사진 가장자리)에 걸쳐 있으면 경계선을 이어 채운다
    const P = pillRect(loc, width, height);
    const structured = structuredFill(imageData, mask, {
      x0: P.x0 - pad,
      x1: P.x1 + pad,
      y0: P.y0 - pad,
      y1: P.y1 + pad,
    });
    if (structured) return makeOpaque(structured, loc);
    // 사진처럼 여러 색이면: 배지 안 흐린 배경을 단서로 복원 (정배율 PNG에서만 — 배지 경계가
    // 픽셀 단위로 딱 떨어져야 색조 모델이 맞는다)
    if (!lossy && Math.abs(loc.s - 1) < 1e-3) {
      const guided = guidedPillFill(
        imageData,
        geminiMask(imageData, loc, true, 0),
        // 글자 가장자리의 옅은 번짐까지 지워야 색조 역산 때 글자 줄 잔상(띠)이 남지 않는다
        geminiMask(imageData, loc, false, 2),
        searchRadius,
      );
      if (guided) return makeOpaque(guided, loc);
    }
    return makeOpaque(inpaintMask(imageData, mask, searchRadius, fill), loc);
  }
  // 정배율·확실한 정합일 때만 역산 — 재표본화된 지도는 픽셀 격자가 어긋나 오차가 커진다
  const exact = !lossy && Math.abs(loc.s - 1) < 1e-3 && Math.abs(loc.score) > 0.9;
  if (!exact) {
    return makeOpaque(
      inpaintMask(imageData, geminiMask(imageData, loc, false, Math.max(2, Math.round(3 * loc.s))), searchRadius, fill),
      loc,
    );
  }

  const out = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
  const d = out.data;
  const core = new Uint8Array(width * height);
  let coreCount = 0;
  const { w, h, a } = loc.tpl;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const al = a[y * w + x];
      if (al <= 0) continue;
      const idx = (loc.y + y) * width + loc.x + x;
      if (al >= ALPHA_CORE) {
        core[idx] = 1;
        coreCount += 1;
        continue;
      }
      const o = idx * 4;
      for (let c = 0; c < 3; c += 1) {
        d[o + c] = (d[o + c] - loc.ink * al) / (1 - al);
      }
    }
  }
  return makeOpaque(coreCount ? inpaintMask(out, core, searchRadius, fill) : out, loc);
}

// 워터마크 글자 픽셀은 PNG 자체의 알파까지 낮춰져 있다(실파일 43장 모두 정확히 605px, 최소 191).
// 색만 되돌리고 알파를 그대로 두면 PowerPoint의 흰 슬라이드 바탕과 섞여 밝은 점 윤곽이 남는다.
function makeOpaque(out, loc) {
  const { width, height, data } = out;
  const pad = Math.max(2, Math.round(2 * loc.s));
  const x0 = Math.max(0, loc.x - pad);
  const y0 = Math.max(0, loc.y - pad);
  const x1 = Math.min(width - 1, loc.x + loc.tpl.w + pad);
  const y1 = Math.min(height - 1, loc.y + loc.tpl.h + pad);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) data[(y * width + x) * 4 + 3] = 255;
  }
  return out;
}
