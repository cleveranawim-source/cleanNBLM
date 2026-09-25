// 회귀 하네스 — dev 서버에서 import('/test/harness.js') 후 runMatrix() 호출.
// 같은 장면을 워터마크 유무로 두 번 그려, 복원 결과를 "워터마크 없는 정답"과 비교한다.
import { DEFAULT_SETTINGS, detectWatermark } from '/src/lib/detect.js';
import { cleanImage } from '/src/lib/pipeline.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BACKGROUNDS = {
  white: (ctx, w, h) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); },
  offwhite: (ctx, w, h) => { ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, w, h); },
  dark: (ctx, w, h) => { ctx.fillStyle = '#1f2126'; ctx.fillRect(0, 0, w, h); },
  midgray: (ctx, w, h) => { ctx.fillStyle = '#8a8d92'; ctx.fillRect(0, 0, w, h); },
  blue: (ctx, w, h) => { ctx.fillStyle = '#2d5fa8'; ctx.fillRect(0, 0, w, h); },
  gradient: (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e6b98a'); g.addColorStop(0.55, '#8e5a42'); g.addColorStop(1, '#3e2925');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },
  sand: (ctx, w, h) => {
    ctx.fillStyle = '#c9a77c'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 34;
      img.data[i] += n; img.data[i + 1] += n * 0.9; img.data[i + 2] += n * 0.8;
    }
    ctx.putImageData(img, 0, 0);
  },
  photo: (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9fc3e0'); g.addColorStop(0.6, '#6d8a6a'); g.addColorStop(1, '#3d4a35');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 90; i += 1) {
      ctx.fillStyle = `rgba(${40 + r() * 80},${60 + r() * 70},${30 + r() * 40},${0.25 + r() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, h * 0.55 + r() * h * 0.5, 20 + r() * 90, 8 + r() * 30, r() * 3, 0, 7);
      ctx.fill();
    }
  },
};

// 워터마크 스타일. s = 해상도 배율(1376폭 기준)
const WATERMARKS = {
  whiteText: (ctx, w, h, s) => {
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.font = `500 ${15 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('◉ NotebookLM', w - 10 * s, h - 12 * s);
  },
  darkText: (ctx, w, h, s) => {
    ctx.fillStyle = 'rgba(40,40,44,.92)';
    ctx.font = `500 ${15 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('◉ NotebookLM', w - 10 * s, h - 12 * s);
  },
  grayText: (ctx, w, h, s) => {
    ctx.fillStyle = 'rgba(150,150,150,.75)';
    ctx.font = `500 ${15 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('◉ NotebookLM', w - 10 * s, h - 12 * s);
  },
  // 실제 리브랜딩 워터마크: 단색 돔 아이콘 + "Gemini Notebook" (밝은 배경=검정, 어두운 배경=흰색)
  gnDark: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(24,24,24,.92)'),
  gnWhite: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(255,255,255,.94)'),
  gnGray: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(150,150,150,.8)'),
  gnDark12: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(24,24,24,.92)', 12),
  gnDark19: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(24,24,24,.92)', 19),
  gnWhite19: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(255,255,255,.94)', 19),
  gnDark24: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(24,24,24,.92)', 24),
  gnWhite24: (ctx, w, h, s) => drawGeminiNotebook(ctx, w, h, s, 'rgba(255,255,255,.94)', 24),
  gemini: (ctx, w, h, s) => {
    ctx.font = `500 ${14 * s}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    const tx = w - 10 * s;
    const ty = h - 12 * s;
    ctx.fillStyle = 'rgba(95,99,104,.95)';
    ctx.fillText('Gemini Notebook', tx, ty);
    const tw = ctx.measureText('Gemini Notebook').width;
    const cx = tx - tw - 11 * s;
    const cy = ty - 5 * s;
    const g = ctx.createLinearGradient(cx - 7 * s, cy - 7 * s, cx + 7 * s, cy + 7 * s);
    g.addColorStop(0, '#4285f4'); g.addColorStop(0.35, '#ea4335');
    g.addColorStop(0.7, '#fbbc04'); g.addColorStop(1, '#34a853');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7 * s); ctx.quadraticCurveTo(cx, cy, cx + 7 * s, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + 7 * s); ctx.quadraticCurveTo(cx, cy, cx - 7 * s, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - 7 * s); ctx.fill();
  },
};

function drawGeminiNotebook(ctx, w, h, s, color, fontPx = 15) {
  const fs = fontPx * s;
  ctx.font = `500 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  const tx = w - 10 * s;
  const ty = h - 12 * s;
  ctx.fillStyle = color;
  ctx.fillText('Gemini Notebook', tx, ty);
  const tw = ctx.measureText('Gemini Notebook').width;
  // 돔 아이콘: 반원 + 아래쪽 아치 3개 (NotebookLM 로고 계열)
  const iw = fs * 1.15;
  const ih = fs * 0.72;
  const ix1 = tx - tw - fs * 0.35;
  const ix0 = ix1 - iw;
  // 아치 구멍은 배경까지 뚫지 않도록 별도 캔버스에서 만든 뒤 합성
  const icon = document.createElement('canvas');
  icon.width = Math.ceil(iw) + 4;
  icon.height = Math.ceil(ih) + 4;
  const ic = icon.getContext('2d');
  ic.fillStyle = color;
  const base = ih + 2;
  ic.beginPath();
  ic.ellipse(icon.width / 2, base, iw / 2, ih, 0, Math.PI, 0);
  ic.closePath();
  ic.fill();
  ic.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k += 1) {
    const cx = 2 + iw * (0.22 + k * 0.28);
    ic.beginPath();
    ic.ellipse(cx, base, iw * 0.08, ih * 0.38, 0, Math.PI, 0);
    ic.fill();
  }
  ctx.drawImage(icon, ix0 - 2, ty - base);
}

// 코너 근처 슬라이드 콘텐츠(오탐 유발용)
const CONTENT = {
  none: () => {},
  underline: (ctx, w, h, s) => {
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(w * 0.62, h * 0.9); ctx.lineTo(w * 0.86, h * 0.9); ctx.stroke();
  },
  pageNumber: (ctx, w, h, s) => {
    ctx.fillStyle = '#555'; ctx.font = `600 ${18 * s}px system-ui`; ctx.textAlign = 'left';
    ctx.fillText('12', w * 0.5, h - 16 * s);
  },
};

function scene(bg, wm, content, w, h) {
  const s = w / 1376;
  const make = (withWm) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    BACKGROUNDS[bg](ctx, w, h);
    ctx.fillStyle = bg === 'dark' || bg === 'blue' ? '#fff' : '#222';
    ctx.font = `700 ${56 * s}px system-ui`; ctx.textAlign = 'left';
    ctx.fillText('Slide Title', 90 * s, 200 * s);
    CONTENT[content](ctx, w, h, s);
    if (withWm && wm) {
      // 'gnDark@10' 형태 = 1376폭 기준 글자 크기 지정
      const sized = /^(gnDark|gnWhite|gnGray|nbDark|nbWhite)@(\d+(?:\.\d+)?)$/.exec(wm);
      if (sized) {
        const color = {
          gnDark: 'rgba(24,24,24,.92)', gnWhite: 'rgba(255,255,255,.94)', gnGray: 'rgba(150,150,150,.8)',
          nbDark: 'rgba(40,40,44,.92)', nbWhite: 'rgba(255,255,255,.96)',
        }[sized[1]];
        if (sized[1].startsWith('gn')) drawGeminiNotebook(ctx, w, h, s, color, Number(sized[2]));
        else {
          ctx.fillStyle = color;
          ctx.font = `500 ${Number(sized[2]) * s}px system-ui, sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText('◉ NotebookLM', w - 10 * s, h - 12 * s);
        }
      } else {
        WATERMARKS[wm](ctx, w, h, s);
      }
    }
    return ctx.getImageData(0, 0, w, h);
  };
  return { truth: make(false), input: make(true) };
}

const luma = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

// 워터마크가 칠해진 픽셀(입력≠정답) bbox 안에서 복원 품질 측정
function measure(truth, input, out) {
  const { width: w, height: h } = truth;
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    if (Math.abs(luma(truth.data, o) - luma(input.data, o)) > 6 ||
      Math.abs(truth.data[o] - input.data[o]) > 12 || Math.abs(truth.data[o + 2] - input.data[o + 2]) > 12) {
      const x = i % w; const y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  let residue = 0; let errSum = 0; let n = 0; let eT = 0; let eO = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const o = (y * w + x) * 4;
      const e = Math.abs(luma(out.data, o) - luma(truth.data, o));
      errSum += e; n += 1;
      // 잔여 = 정답과 크게 다르면서 입력(워터마크)과 비슷한 픽셀
      const wmDiff = Math.abs(luma(input.data, o) - luma(truth.data, o));
      if (wmDiff > 20 && e > 20) residue += 1;
      if (x > minX) {
        eT += Math.abs(luma(truth.data, o) - luma(truth.data, o - 4));
        eO += Math.abs(luma(out.data, o) - luma(out.data, o - 4));
      }
    }
  }
  return {
    residue,
    meanErr: +(errSum / n).toFixed(1),
    texture: eT > n * 2 ? +(eO / eT).toFixed(2) : null,
  };
}

// 워터마크 bbox 밖에서 바뀐 픽셀 수(콘텐츠 훼손)
function collateral(truth, input, out) {
  const { width: w, height: h } = truth;
  let changed = 0;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const isWm = Math.abs(luma(truth.data, o) - luma(input.data, o)) > 3;
    if (isWm) continue;
    if (Math.abs(luma(out.data, o) - luma(input.data, o)) > 25) changed += 1;
  }
  return changed;
}

export function runCase(bg, wm, content = 'none', w = 1376, h = 768, settings = DEFAULT_SETTINGS) {
  const { truth, input } = scene(bg, wm, content, w, h);
  const t0 = performance.now();
  const det = detectWatermark(input, settings);
  const t1 = performance.now();
  const out = det.pixelCount ? cleanImage(input, det.mask, settings).imageData : input;
  const t2 = performance.now();
  const m = wm ? measure(truth, input, out) : null;
  // 오탐 케이스는 바뀐 픽셀 전체를, 정상 케이스는 워터마크 밖 훼손을 센다
  let collat;
  if (!wm) {
    collat = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (Math.abs(luma(out.data, i) - luma(input.data, i)) > 25) collat += 1;
    }
  } else {
    const box = measureBox(truth, input);
    collat = collateralOutside(input, out, box);
  }
  return {
    case: `${bg}+${wm ?? 'NONE'}${content !== 'none' ? `+${content}` : ''}@${w}`,
    mode: det.mode,
    maskPx: det.pixelCount,
    ...(m ?? {}),
    collateral: collat,
    detectMs: Math.round(t1 - t0),
    cleanMs: Math.round(t2 - t1),
    _out: out, _truth: truth, _input: input,
  };
}

function measureBox(truth, input) {
  const { width: w, height: h } = truth;
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    if (Math.abs(luma(truth.data, o) - luma(input.data, o)) > 3 ||
      Math.abs(truth.data[o] - input.data[o]) > 8) {
      const x = i % w; const y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX: minX - 6, minY: minY - 6, maxX: maxX + 6, maxY: maxY + 6 };
}

// 워터마크 bbox(+6px) 밖에서 25 luma 넘게 바뀐 픽셀 = 배경·콘텐츠 훼손
function collateralOutside(input, out, box) {
  const { width: w } = input;
  let changed = 0;
  for (let i = 0; i < input.data.length; i += 4) {
    const p = i / 4;
    const x = p % w; const y = (p / w) | 0;
    if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) continue;
    if (Math.abs(luma(out.data, i) - luma(input.data, i)) > 25) changed += 1;
  }
  return changed;
}

export const MATRIX = [
  ['white', 'darkText'], ['white', 'grayText'],
  ['offwhite', 'darkText'],
  ['dark', 'whiteText'], ['dark', 'grayText'],
  ['midgray', 'whiteText'], ['midgray', 'darkText'],
  ['blue', 'whiteText'],
  ['gradient', 'whiteText'],
  ['sand', 'whiteText'], ['sand', 'darkText'],
  ['photo', 'whiteText'], ['photo', 'darkText'],
  ['white', 'darkText', 'underline'], ['white', 'darkText', 'pageNumber'],
  // 오탐 케이스(워터마크 없음)
  ['white', null], ['blue', null], ['sand', null], ['photo', null],
  ['white', null, 'underline'], ['white', null, 'pageNumber'],
];

// 리브랜딩(Gemini Notebook) 워터마크 전용 — 배경 밝기에 맞춘 색
export const GEMINI_MATRIX = [
  ['white', 'gnDark'], ['offwhite', 'gnDark'], ['sand', 'gnDark'], ['midgray', 'gnDark'],
  ['dark', 'gnWhite'], ['blue', 'gnWhite'], ['gradient', 'gnWhite'], ['photo', 'gnWhite'],
  ['midgray', 'gnWhite'], ['sand', 'gnWhite'],
  ['white', 'gnGray'], ['dark', 'gnGray'],
  ['white', 'gnDark', 'underline'], ['white', 'gnDark', 'pageNumber'],
];

// 크기 강건성 — 1376폭 기준 글자 8~24px
export const SIZES = [8, 9, 10, 11, 12, 13, 15, 17, 19, 22, 24];
export const SIZE_MATRIX = SIZES.flatMap((px) => [
  ['white', `gnDark@${px}`], ['dark', `gnWhite@${px}`], ['photo', `gnWhite@${px}`],
  ['sand', `gnDark@${px}`], ['white', `nbDark@${px}`], ['gradient', `nbWhite@${px}`],
]);

export function runMatrix(w = 1376, h = 768, list = MATRIX) {
  return list.map(([bg, wm, content]) => {
    const r = runCase(bg, wm, content, w, h);
    delete r._out; delete r._truth; delete r._input;
    return r;
  });
}

// 확대 비교 크롭(정답 | 입력 | 결과)을 dataURL로
export function cropStrip(r, pad = 30, zoom = 3) {
  const box = measureBox(r._truth, r._input);
  const x0 = Math.max(0, box.minX - pad); const y0 = Math.max(0, box.minY - pad);
  const cw = Math.min(r._truth.width - x0, box.maxX - box.minX + pad * 2);
  const ch = Math.min(r._truth.height - y0, box.maxY - box.minY + pad * 2);
  const out = document.createElement('canvas');
  out.width = cw * zoom; out.height = ch * zoom * 3 + 8;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.fillStyle = '#f0f'; octx.fillRect(0, 0, out.width, out.height);
  [r._truth, r._input, r._out].forEach((img, k) => {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').putImageData(img, 0, 0);
    octx.drawImage(cv, x0, y0, cw, ch, 0, k * (ch * zoom + 4), cw * zoom, ch * zoom);
  });
  return out.toDataURL('image/png');
}
