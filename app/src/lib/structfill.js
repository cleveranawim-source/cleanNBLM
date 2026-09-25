// 구조 이어 채우기 — 가림 영역(배지)을 가로지르는 색 경계선을 직선으로 이어 준다.
//
// 배지 둘레가 뚜렷한 두 색(예: 카드색·흰 바탕)으로 나뉘면, 둘레에서 색이 바뀌는 지점마다
// 바깥쪽 경계선을 따라가 직선을 맞추고, 그 직선을 배지 안으로 연장해 영역을 나눈다.
// 각 영역은 같은 색 쪽 둘레 픽셀만으로 조화 보간하고, 경계선 가까이의 그림자·음영은
// 바깥 단면을 그대로 옮겨 온다. 두 색으로 깔끔히 나뉘지 않으면 null (호출부가 기존 방식 사용).

const luma = (d, o) => d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114;

// 둘레 표본을 2색으로 나눈다 (루마 기준 2-means). 분리가 약하면 null.
// 시작점이 최소·최대면 소수의 어두운 테두리 픽셀이 한 무리를 차지하고 카드색과 흰 바탕이
// 한데 묶이는 일이 있어, 분위수 몇 가지로 시작해 무리 안 편차가 가장 작은 결과를 쓴다
function twoMeans(values, a0, b0) {
  let cA = a0;
  let cB = b0;
  for (let it = 0; it < 15; it += 1) {
    let sA = 0;
    let nA = 0;
    let sB = 0;
    let nB = 0;
    for (const l of values) {
      if (Math.abs(l - cA) <= Math.abs(l - cB)) {
        sA += l;
        nA += 1;
      } else {
        sB += l;
        nB += 1;
      }
    }
    if (!nA || !nB) return null;
    cA = sA / nA;
    cB = sB / nB;
  }
  let dA = 0;
  let nA = 0;
  let dB = 0;
  let nB = 0;
  for (const l of values) {
    if (Math.abs(l - cA) <= Math.abs(l - cB)) {
      dA += Math.abs(l - cA);
      nA += 1;
    } else {
      dB += Math.abs(l - cB);
      nB += 1;
    }
  }
  return { cA, cB, madA: dA / nA, madB: dB / nB, nA, nB, spread: (dA + dB) / values.length };
}

function twoClasses(samples) {
  const values = samples.map((s) => s.l).sort((a, b) => a - b);
  const q = (p) => values[Math.floor(p * (values.length - 1))];
  let best = null;
  for (const [lo, hi] of [[0.1, 0.9], [0.25, 0.75], [0, 1], [0.05, 0.95]]) {
    if (q(hi) - q(lo) < 1) continue;
    const r = twoMeans(values, q(lo), q(hi));
    if (r && (!best || r.spread < best.spread)) best = r;
  }
  if (!best) return null;
  const { cA, cB, madA, madB, nA, nB } = best;
  const sep = Math.abs(cB - cA);
  if (sep < 40) return null;
  // 두 색이 각자 고르고(평균 절대편차 < 분리의 20% — 소수의 어두운 테두리 픽셀에 덜 민감)
  // 한쪽이 너무 적지 않아야 "두 영역"으로 본다
  if (Math.min(nA, nB) / values.length < 0.08) return null;
  if (madA > sep * 0.2 || madB > sep * 0.2) return null;
  return { cA, cB, mid: (cA + cB) / 2 };
}

// 최소제곱 직선 v = a·u + b
function fitLine(points) {
  const n = points.length;
  let su = 0;
  let sv = 0;
  let suu = 0;
  let suv = 0;
  for (const [u, v] of points) {
    su += u;
    sv += v;
    suu += u * u;
    suv += u * v;
  }
  const den = n * suu - su * su;
  if (Math.abs(den) < 1e-9) return null;
  const a = (n * suv - su * sv) / den;
  const b = (sv - a * su) / n;
  let res = 0;
  for (const [u, v] of points) res += (v - (a * u + b)) ** 2;
  return { a, b, rms: Math.sqrt(res / n) };
}

export function structuredFill(imageData, mask, rect) {
  const { width, height, data } = imageData;
  const { x0, x1, y0, y1 } = rect;
  const inImage = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const L = (x, y) => luma(data, (y * width + x) * 4);

  // 1) 둘레 표본: 마스크 바로 바깥(1~3px) 픽셀
  const ring = [];
  const seen = new Uint8Array(width * height);
  for (let y = y0 - 3; y <= y1 + 3; y += 1) {
    for (let x = x0 - 3; x <= x1 + 3; x += 1) {
      if (!inImage(x, y) || mask[y * width + x]) continue;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (inImage(nx, ny) && mask[ny * width + nx]) {
            near = true;
            break;
          }
        }
      }
      if (near && !seen[y * width + x]) {
        seen[y * width + x] = 1;
        ring.push({ x, y, l: L(x, y) });
      }
    }
  }
  if (ring.length < 40) return null;
  const cls = twoClasses(ring);
  if (!cls) return null;
  const classOf = (l) => (Math.abs(l - cls.cA) <= Math.abs(l - cls.cB) ? 0 : 1);

  // 2) 경계선 추적: 왼쪽 끝 바깥(가로 경계선)과 윗변 바깥(세로 경계선)
  //    각 열/행에서 두 색의 중간값을 지나는 지점을 부분 픽셀로 찾아 직선을 맞춘다
  const band = 22;
  const lines = [];
  const crossing = (profile) => {
    // profile: [{t, l}] 순서대로 — 중간값을 가로지르는 첫 지점(여러 개면 전부)
    const hits = [];
    for (let i = 1; i < profile.length; i += 1) {
      const a = profile[i - 1].l - cls.mid;
      const b = profile[i].l - cls.mid;
      if (a === 0 || a * b < 0) {
        const t = profile[i - 1].t + (a / (a - b)) * (profile[i].t - profile[i - 1].t);
        hits.push(t);
      }
    }
    return hits;
  };
  // 가로 경계선 (왼쪽에서 들어옴): 열마다 세로 단면
  const hPoints = new Map();
  for (let x = x0 - band; x <= x0 - 2; x += 1) {
    if (x < 0) continue;
    const profile = [];
    for (let y = y0 - 1; y <= y1 + 1; y += 1) if (inImage(x, y)) profile.push({ t: y, l: L(x, y) });
    for (const t of crossing(profile)) {
      const key = Math.round(t);
      if (!hPoints.has(key)) hPoints.set(key, []);
      hPoints.get(key).push([x, t]);
    }
  }
  // 세로 경계선 (위에서 들어옴): 행마다 가로 단면
  const vPoints = new Map();
  for (let y = y0 - band; y <= y0 - 2; y += 1) {
    if (y < 0) continue;
    const profile = [];
    for (let x = x0 - 1; x <= x1 + 1; x += 1) if (inImage(x, y)) profile.push({ t: x, l: L(x, y) });
    for (const t of crossing(profile)) {
      const key = Math.round(t);
      if (!vPoints.has(key)) vPoints.set(key, []);
      vPoints.get(key).push([y, t]);
    }
  }
  // 같은 선에 속한 점들을 묶는다 (인접 위치끼리 합침) → 충분히 길고 곧으면 채택
  const groupLines = (pointsMap, orient) => {
    const keys = [...pointsMap.keys()].sort((a, b) => a - b);
    const groups = [];
    for (const k of keys) {
      const last = groups[groups.length - 1];
      if (last && k - last.maxKey <= 3) {
        last.points.push(...pointsMap.get(k));
        last.maxKey = k;
      } else {
        groups.push({ points: [...pointsMap.get(k)], maxKey: k });
      }
    }
    for (const g of groups) {
      if (g.points.length < band * 0.6) continue;
      const fit = fitLine(g.points);
      if (!fit || fit.rms > 1.6 || Math.abs(fit.a) > 1.2) continue;
      lines.push({ orient, ...fit });
    }
  };
  groupLines(hPoints, 'h'); // y = a·x + b
  groupLines(vPoints, 'v'); // x = a·y + b
  if (!lines.length) return null;

  // 3) 연장한 직선으로 마스크를 나눈다 — 이웃 연결이 선을 넘으면 끊는다
  const side = (line, x, y) =>
    line.orient === 'h' ? Math.sign(y + 0.5 - (line.a * (x + 0.5) + line.b)) : Math.sign(x + 0.5 - (line.a * (y + 0.5) + line.b));
  const crosses = (xa, ya, xb, yb) => lines.some((ln) => side(ln, xa, ya) !== side(ln, xb, yb));

  const comp = new Int32Array(width * height).fill(-1);
  const comps = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = y * width + x;
      if (!mask[idx] || comp[idx] >= 0) continue;
      const id = comps.length;
      const pixels = [];
      const votes = [0, 0];
      const stack = [idx];
      comp[idx] = id;
      while (stack.length) {
        const p = stack.pop();
        pixels.push(p);
        const px = p % width;
        const py = (p / width) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx;
          const ny = py + dy;
          if (!inImage(nx, ny) || crosses(px, py, nx, ny)) continue;
          const n = ny * width + nx;
          if (mask[n]) {
            if (comp[n] < 0) {
              comp[n] = id;
              stack.push(n);
            }
          } else {
            votes[classOf(L(nx, ny))] += 1;
          }
        }
      }
      const total = votes[0] + votes[1];
      const cl = votes[0] >= votes[1] ? 0 : 1;
      // 둘레와 닿지 않거나 두 색이 섞여 닿으면 판단 불가 → 전체를 기존 방식으로
      if (!total || Math.min(votes[0], votes[1]) / total > 0.3) return null;
      comps.push({ pixels, cl });
    }
  }

  // 초기값·출력 버퍼
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const od = out.data;
  const fillValue = new Float32Array(width * height * 3);
  for (const c of comps) {
    const base = c.cl === 0 ? cls.cA : cls.cB;
    // 초기값: 같은 색 둘레 픽셀 평균색
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const s of ring) {
      if (classOf(s.l) !== c.cl) continue;
      const o = (s.y * width + s.x) * 4;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      n += 1;
    }
    for (const p of c.pixels) {
      fillValue[p * 3] = n ? r / n : base;
      fillValue[p * 3 + 1] = n ? g / n : base;
      fillValue[p * 3 + 2] = n ? b / n : base;
    }
  }
  // 4) 경계선 음영 — 바깥에서 선까지의 거리별 단면을 잰다
  const W = 6;
  const dist = (line, x, y) => {
    const norm = Math.sqrt(1 + line.a * line.a);
    return line.orient === 'h'
      ? (y + 0.5 - (line.a * (x + 0.5) + line.b)) / norm
      : (x + 0.5 - (line.a * (y + 0.5) + line.b)) / norm;
  };
  const shading = lines.map((line) => {
    // 선에서 부호 있는 거리 d(−W..W)별 평균 색 — 바깥 추적 구간의 픽셀로
    const acc = new Float64Array((2 * W + 1) * 3);
    const cnt = new Float64Array(2 * W + 1);
    const lo = line.orient === 'h' ? [x0 - band, x0 - 2] : [y0 - band, y0 - 2];
    for (let u = lo[0]; u <= lo[1]; u += 1) {
      for (let k = -W - 1; k <= W + 1; k += 1) {
        const center = line.a * (u + 0.5) + line.b;
        const x = line.orient === 'h' ? u : Math.floor(center) + k;
        const y = line.orient === 'h' ? Math.floor(center) + k : u;
        if (!inImage(x, y) || mask[y * width + x]) continue;
        const d = Math.round(dist(line, x, y));
        if (d < -W || d > W) continue;
        const o = (y * width + x) * 4;
        acc[(d + W) * 3] += data[o];
        acc[(d + W) * 3 + 1] += data[o + 1];
        acc[(d + W) * 3 + 2] += data[o + 2];
        cnt[d + W] += 1;
      }
    }
    // 각 쪽(선 위/왼쪽 = 음수, 아래/오른쪽 = 양수) 단면이 어느 색 영역의 것인지
    const sideClass = (k) => {
      const i = k + W;
      if (!cnt[i]) return -1;
      return classOf(
        (acc[i * 3] / cnt[i]) * 0.299 + (acc[i * 3 + 1] / cnt[i]) * 0.587 + (acc[i * 3 + 2] / cnt[i]) * 0.114,
      );
    };
    return { acc, cnt, negClass: sideClass(-W), posClass: sideClass(W) };
  });
  // 선 반대편(선을 넘어 2px) 지점이 어느 색 영역인지 — 같은 색이면 그 구간은 실제 경계가 아니다
  const acrossClass = (line, px, py, d) => {
    const norm = Math.sqrt(1 + line.a * line.a);
    const nx = line.orient === 'h' ? -line.a / norm : 1 / norm;
    const ny = line.orient === 'h' ? 1 / norm : -line.a / norm;
    const step = -(d < 0 ? -1 : 1) * (Math.abs(d) + 2);
    const qx = Math.round(px + nx * step);
    const qy = Math.round(py + ny * step);
    if (!inImage(qx, qy)) return -1;
    const q = qy * width + qx;
    if (mask[q]) return comp[q] >= 0 ? comps[comp[q]].cl : -1;
    return classOf(L(qx, qy));
  };
  // 부분 픽셀 거리에서 단면값 (정수 칸 사이 선형 보간 — 기울어진 선이 계단지지 않게)
  const profileAt = (sh, d, ch) => {
    const f = Math.max(-W, Math.min(W, d));
    const k0 = Math.floor(f);
    const k1 = Math.min(W, k0 + 1);
    const t = f - k0;
    const at = (k) => (sh.cnt[k + W] ? sh.acc[(k + W) * 3 + ch] / sh.cnt[k + W] : null);
    const v0 = at(k0);
    const v1 = at(k1);
    if (v0 === null) return v1;
    if (v1 === null) return v0;
    return v0 + (v1 - v0) * t;
  };
  // 위치 (px,py)의 색 영역 cl에서 경계선 음영 변화량 [r,g,b] — 없으면 null.
  // 가장 가까운 "실제 경계" 선 하나만: 선을 연장한 부분이 같은 색 사이를 지나면(카드 모서리
  // 너머 흰 바탕) 음영을 두지 않고, 모서리에서 두 선이 겹쳐 진해지지 않게 한다
  const shadeDelta = (px, py, cl) => {
    let best = null;
    lines.forEach((line, li) => {
      const d = dist(line, px, py);
      if (Math.abs(d) > W) return;
      const sideCls = d < 0 ? shading[li].negClass : shading[li].posClass;
      if (sideCls !== cl) return;
      const other = acrossClass(line, px, py, d);
      if (other < 0 || other === cl) return;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, li };
    });
    if (!best) return null;
    const sh = shading[best.li];
    const d = best.d < 0 ? Math.min(-0.01, best.d) : Math.max(0, best.d);
    const out3 = [0, 0, 0];
    for (let ch = 0; ch < 3; ch += 1) {
      const here = profileAt(sh, d, ch);
      const ref = profileAt(sh, best.d < 0 ? -W : W, ch);
      if (here === null || ref === null) return null;
      out3[ch] = here - ref;
    }
    return out3;
  };

  // 5) 영역별 조화 보간 — 같은 색 쪽 둘레 픽셀만 경계값으로, 선 너머 이웃은 무시.
  //    경계값에서는 음영을 먼저 빼 "바탕색"만 보간하고, 음영은 마지막에 한 번만 더한다
  //    (빼지 않으면 테두리 근처가 두 번 어두워진다)
  const boundaryCache = new Map();
  const boundaryValue = (q, nx, ny, cl) => {
    const key = q * 2 + cl;
    let v = boundaryCache.get(key);
    if (!v) {
      const o = q * 4;
      const delta = shadeDelta(nx, ny, cl);
      v = delta
        ? [data[o] - delta[0], data[o + 1] - delta[1], data[o + 2] - delta[2]]
        : [data[o], data[o + 1], data[o + 2]];
      boundaryCache.set(key, v);
    }
    return v;
  };
  for (let it = 0; it < 400; it += 1) {
    for (const c of comps) {
      for (const p of c.pixels) {
        const px = p % width;
        const py = (p / width) | 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx;
          const ny = py + dy;
          if (!inImage(nx, ny) || crosses(px, py, nx, ny)) continue;
          const q = ny * width + nx;
          if (mask[q]) {
            r += fillValue[q * 3];
            g += fillValue[q * 3 + 1];
            b += fillValue[q * 3 + 2];
            n += 1;
          } else if (classOf(L(nx, ny)) === c.cl) {
            const v = boundaryValue(q, nx, ny, c.cl);
            r += v[0];
            g += v[1];
            b += v[2];
            n += 1;
          }
        }
        if (!n) continue;
        fillValue[p * 3] += 1.85 * (r / n - fillValue[p * 3]);
        fillValue[p * 3 + 1] += 1.85 * (g / n - fillValue[p * 3 + 1]);
        fillValue[p * 3 + 2] += 1.85 * (b / n - fillValue[p * 3 + 2]);
      }
    }
  }

  for (const c of comps) {
    for (const p of c.pixels) {
      const delta = shadeDelta(p % width, (p / width) | 0, c.cl);
      for (let ch = 0; ch < 3; ch += 1) od[p * 4 + ch] = fillValue[p * 3 + ch] + (delta ? delta[ch] : 0);
      od[p * 4 + 3] = 255;
    }
  }
  return out;
}
