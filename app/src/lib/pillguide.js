// 배지 안쪽 단서로 복원 — Gemini Notebook 배지는 아래 배경을 흐리고(≈가우시안 σ 5px)
// 색을 입힌 것이다: 배지 = a + k·흐림(배경). 가장자리에서 a·k·흐림 정도를 맞춰 색조를 걷어내면
// 배지 밑에 있던 것(신발·바지·바닥 등)의 흐린 모습이 제자리에 나온다. 알려진 흐림을
// 역으로 풀어(Landweber 역블러) 윤곽을 되살리고, 경계는 포아송 합성으로 이음새 없이 맞춘다.
// 주변을 섞기만 하는 조화 보간은 배지 밑 물체를 한 덩어리 얼룩으로 만든다(실파일 13번).
import { inpaintMask } from './inpaint.js';

const RADII = [3, 5, 7, 10];

// 세 번 겹친 박스 흐림 (≈ 가우시안 σ ≈ √(r(r+1)))
function boxBlur3(src, w, h, r) {
  let a = src;
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x += 1) {
        tmp[row + x] = sum / (2 * r + 1);
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y += 1) {
        out[y * w + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    a = out;
  }
  return a;
}

// pill: 실제 배지 픽셀(여유 없이), glyph: 배지 안 글자 픽셀 (알파>2% + 1px)
export function guidedPillFill(imageData, pill, glyph, searchRadius = 24) {
  const { width, height, data } = imageData;
  let bx0 = width;
  let bx1 = -1;
  let by0 = height;
  let by1 = -1;
  for (let i = 0; i < pill.length; i += 1) {
    if (!pill[i]) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  if (bx1 < 0) return null;
  const margin = 3 * RADII[RADII.length - 1] + 2;
  const X0 = Math.max(0, bx0 - margin);
  const X1 = Math.min(width - 1, bx1 + margin);
  const Y0 = Math.max(0, by0 - margin);
  const Y1 = Math.min(height - 1, by1 + margin);
  const w = X1 - X0 + 1;
  const h = Y1 - Y0 + 1;

  // 1) 배지 안 글자만 지운 배지 색 P (배지 안쪽은 매끈해서 조화 보간이 정확)
  const noText = inpaintMask(imageData, glyph, searchRadius, { smooth: true, texture: false });
  // 2) 배경 추정 E: 배지 전체를 조화 보간 — 가장자리 띠에서 흐림 모델을 맞추는 데만 쓴다
  const rough = inpaintMask(imageData, pill, searchRadius, { smooth: true, texture: false });

  const inPill = new Uint8Array(w * h);
  const edgeBand = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const gi = (Y0 + y) * width + X0 + x;
      if (!pill[gi]) continue;
      inPill[y * w + x] = 1;
      let near = false;
      for (let dy = -4; dy <= 4 && !near; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const nx = X0 + x + dx;
          const ny = Y0 + y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && !pill[ny * width + nx]) {
            near = true;
            break;
          }
        }
      }
      if (near) edgeBand.push(y * w + x);
    }
  }
  if (edgeBand.length < 60) return null;

  const channel = (img, c) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) out[y * w + x] = img.data[((Y0 + y) * width + X0 + x) * 4 + c];
    }
    return out;
  };
  const P = [0, 1, 2].map((c) => channel(noText, c));
  const E = [0, 1, 2].map((c) => channel(rough, c));

  // 3) 흐림 반경 r·색조(a, k)를 가장자리 띠에서 최소제곱으로 — 가장 잘 맞는 r
  let best = null;
  for (const r of RADII) {
    let r2 = 0;
    const fits = [];
    for (let c = 0; c < 3; c += 1) {
      const B = boxBlur3(E[c], w, h, r);
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      const n = edgeBand.length;
      for (const li of edgeBand) {
        const bx = B[li];
        const py = P[c][li];
        sx += bx;
        sy += py;
        sxx += bx * bx;
        sxy += bx * py;
        syy += py * py;
      }
      const vx = n * sxx - sx * sx;
      const vy = n * syy - sy * sy;
      if (vx < 1e-6 || vy < 1e-6) return null; // 배경이 너무 매끈 — 조화 보간으로 충분
      const k = (n * sxy - sx * sy) / vx;
      fits.push({ k, a: (sy - k * sx) / n });
      r2 += (n * sxy - sx * sy) ** 2 / (vx * vy);
    }
    r2 /= 3;
    if (!best || r2 > best.r2) best = { r, r2, fits };
  }
  // 모델이 맞지 않으면(다른 종류의 배지·손실 압축) 쓰지 않는다
  if (best.r2 < 0.75 || best.fits.some((f) => f.k < 0.25 || f.k > 1.05)) return null;

  // 4) 색조 걷어내기 → 알려진 흐림을 역으로 (Landweber 20회, 배지 밖은 원본 고정)
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const targets = [];
  for (let li = 0; li < w * h; li += 1) if (inPill[li]) targets.push(li);
  const pos = new Int32Array(w * h).fill(-1);
  targets.forEach((li, t) => {
    pos[li] = t;
  });
  for (let c = 0; c < 3; c += 1) {
    const { a, k } = best.fits[c];
    const obs = new Float32Array(w * h);
    const S = channel(imageData, c);
    for (const li of targets) {
      obs[li] = (P[c][li] - a) / k;
      S[li] = Math.max(0, Math.min(255, obs[li]));
    }
    for (let it = 0; it < 20; it += 1) {
      const blurred = boxBlur3(S, w, h, best.r);
      const residual = new Float32Array(w * h);
      for (const li of targets) residual[li] = obs[li] - blurred[li];
      const corr = boxBlur3(residual, w, h, best.r);
      for (const li of targets) S[li] = Math.max(0, Math.min(255, S[li] + corr[li]));
    }
    // 5) 포아송 합성 — 경계 불일치를 안쪽으로 매끈하게 퍼뜨려 이음새를 없앤다
    const delta = new Float32Array(targets.length);
    for (let it = 0; it < 500; it += 1) {
      targets.forEach((li, t) => {
        const x = li % w;
        const y = (li / w) | 0;
        let s = 0;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (pos[q] >= 0) s += delta[pos[q]];
          else s += data[((Y0 + ny) * width + X0 + nx) * 4 + c] - S[li];
          n += 1;
        }
        delta[t] += 1.85 * (s / n - delta[t]);
      });
    }
    targets.forEach((li, t) => {
      const gi = (Y0 + ((li / w) | 0)) * width + X0 + (li % w);
      out.data[gi * 4 + c] = S[li] + delta[t];
      out.data[gi * 4 + 3] = 255;
    });
  }
  // 6) 매끈한 조화 보간과 거의 같으면(배지 밑에 구조가 없는 매끈한 배경) 쓰지 않는다 —
  //    그런 배경에선 역산 과정의 작은 오차가 글자 줄 모양의 희미한 띠로만 드러난다
  let diff = 0;
  let n = 0;
  for (const li of targets) {
    const gi = (Y0 + ((li / w) | 0)) * width + X0 + (li % w);
    if (glyph[gi]) continue;
    const o = gi * 4;
    diff += Math.abs(
      (out.data[o] - rough.data[o]) * 0.299 +
        (out.data[o + 1] - rough.data[o + 1]) * 0.587 +
        (out.data[o + 2] - rough.data[o + 2]) * 0.114,
    );
    n += 1;
  }
  if (!n || diff / n < 3) return null;
  return out;
}
