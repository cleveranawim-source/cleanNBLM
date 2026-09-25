// 인페인팅: 마스크 픽셀을 주변 색으로 복원.
//
// [P0-3] "양파 껍질" 방식 — 마스크 바깥 테두리부터 한 겹씩 복원하고,
// 복원된 픽셀을 다음 겹의 참조로 재사용한다. 탐색 반경보다 두꺼운 마스크나
// 이미지 모서리에 붙은 마스크도 빈 픽셀 없이 채워진다.

function maskBounds(mask, width, height) {
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

function colorDistSq(data, a, b) {
  const dr = data[a * 4] - data[b * 4];
  const dg = data[a * 4 + 1] - data[b * 4 + 1];
  const db = data[a * 4 + 2] - data[b * 4 + 2];
  return dr * dr + dg * dg + db * db;
}

export function inpaintMask(imageData, mask, searchRadius, options = {}) {
  const { width, height } = imageData;
  const out = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
  const bounds = maskBounds(mask, width, height);
  if (!bounds) return out;

  const data = out.data;
  const remaining = mask.slice();
  let remainingCount = 0;
  for (const v of remaining) remainingCount += v;

  // 페더링은 "원래 마스크"의 경계에서만 적용 (한 겹 78% 블렌딩)
  const isOriginalEdge = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !mask[ny * width + nx]) {
          return true;
        }
      }
    }
    return false;
  };

  // 두 앵커의 거리 가중 보간 + 색상 일치도 점수
  const pairSample = (idxA, idxB, distA, distB) => {
    const span = distA + distB;
    const weightA = distB / span;
    const weightB = distA / span;
    return {
      r: data[idxA * 4] * weightA + data[idxB * 4] * weightB,
      g: data[idxA * 4 + 1] * weightA + data[idxB * 4 + 1] * weightB,
      b: data[idxA * 4 + 2] * weightA + data[idxB * 4 + 2] * weightB,
      score: colorDistSq(data, idxA, idxB) / span + span * span * 7,
    };
  };

  let radius = Math.max(12, searchRadius);
  const maxRadius = Math.max(width, height);

  while (remainingCount > 0) {
    const layer = [];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const idx = y * width + x;
        if (!remaining[idx]) continue;

        // 상하좌우에서 가장 가까운 "확정" 픽셀(비마스크 또는 이미 복원된 픽셀) 탐색.
        // 경계 바로 옆 픽셀은 글자의 안티앨리어싱 헤일로로 오염됐을 수 있으므로,
        // 가능하면 2px 더 바깥의 픽셀을 샘플로 쓴다.
        const offsetAnchor = (foundX, foundY, dirX, dirY, fallbackIdx) => {
          for (let extra = 2; extra >= 1; extra -= 1) {
            const ox = foundX + dirX * extra;
            const oy = foundY + dirY * extra;
            if (ox < 0 || ox >= width || oy < 0 || oy >= height) continue;
            const oIdx = oy * width + ox;
            if (!remaining[oIdx]) return oIdx;
          }
          return fallbackIdx;
        };
        let left = -1; let right = -1; let up = -1; let down = -1;
        let dLeft = 0; let dRight = 0; let dUp = 0; let dDown = 0;
        for (let step = 1; step <= radius; step += 1) {
          if (left < 0 && x - step >= 0 && !remaining[y * width + x - step]) {
            left = offsetAnchor(x - step, y, -1, 0, y * width + x - step); dLeft = step;
          }
          if (right < 0 && x + step < width && !remaining[y * width + x + step]) {
            right = offsetAnchor(x + step, y, 1, 0, y * width + x + step); dRight = step;
          }
          if (up < 0 && y - step >= 0 && !remaining[(y - step) * width + x]) {
            up = offsetAnchor(x, y - step, 0, -1, (y - step) * width + x); dUp = step;
          }
          if (down < 0 && y + step < height && !remaining[(y + step) * width + x]) {
            down = offsetAnchor(x, y + step, 0, 1, (y + step) * width + x); dDown = step;
          }
          if (left >= 0 && right >= 0 && up >= 0 && down >= 0) break;
        }

        const horizontal = left >= 0 && right >= 0 ? pairSample(left, right, dLeft, dRight) : null;
        const vertical = up >= 0 && down >= 0 ? pairSample(up, down, dUp, dDown) : null;
        let color = null;
        if (horizontal && vertical) {
          const wh = 1 / (horizontal.score + 1);
          const wv = 1 / (vertical.score + 1);
          const total = wh + wv;
          color = {
            r: (horizontal.r * wh + vertical.r * wv) / total,
            g: (horizontal.g * wh + vertical.g * wv) / total,
            b: (horizontal.b * wh + vertical.b * wv) / total,
          };
        } else {
          color = horizontal ?? vertical;
        }
        if (!color) {
          const anchor = [left, right, up, down].find((a) => a >= 0);
          if (anchor === undefined) continue; // 이번 겹에서는 못 채움 — 다음 겹에서 처리
          color = {
            r: data[anchor * 4],
            g: data[anchor * 4 + 1],
            b: data[anchor * 4 + 2],
          };
        }
        layer.push({ idx, x, y, color });
      }
    }

    if (!layer.length) {
      // 반경 안에 참조 픽셀이 하나도 없음 — 반경을 늘려 재시도
      radius *= 2;
      if (radius > maxRadius) break; // 이미지 전체가 마스크인 병리적 경우
      continue;
    }

    // 한 겹을 다 계산한 뒤 일괄 기록 (겹 내부의 상호 참조 방지)
    for (const { idx, x, y, color } of layer) {
      const blend = isOriginalEdge(x, y) ? 0.78 : 1;
      const o = idx * 4;
      data[o] = data[o] * (1 - blend) + color.r * blend;
      data[o + 1] = data[o + 1] * (1 - blend) + color.g * blend;
      data[o + 2] = data[o + 2] * (1 - blend) + color.b * blend;
      data[o + 3] = 255;
      remaining[idx] = 0;
    }
    remainingCount -= layer.length;
  }

  // [v3.9] 넓은 면(Gemini 배지 등)은 조화 보간으로 매끈하게 다듬는다.
  // 양파껍질은 픽셀마다 가로/세로 앵커 쌍을 따로 골라, 사진 경계가 가로지르면
  // 결과가 들쭉날쭉 찢어진다. 라플라스 방정식 해는 경계에서 부드럽게 이어진다.
  if (options.smooth) {
    harmonicSmooth(data, mask, width, height, bounds, options.smoothIterations ?? 220);
  }

  // [P2] 질감 보존 리파인 — 배경에 결이 있을 때만 패치 샘플링으로 질감 재현
  if (options.texture !== false) {
    textureRefine(out, mask, width, height, bounds);
  }

  return out;
}

// SOR(과이완 가우스-자이델)로 마스크 안을 라플라스 방정식 해로 수렴시킨다.
// 초기값(양파껍질 결과)이 이미 가까워서 수백 회면 충분하다.
function harmonicSmooth(data, mask, width, height, bounds, iterations) {
  const bw = bounds.maxX - bounds.minX + 1;
  const bh = bounds.maxY - bounds.minY + 1;
  const channels = [0, 1, 2].map(() => new Float32Array(bw * bh));
  const targets = [];
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const idx = (bounds.minY + y) * width + bounds.minX + x;
      const local = y * bw + x;
      for (let c = 0; c < 3; c += 1) channels[c][local] = data[idx * 4 + c];
      if (mask[idx]) targets.push(local);
    }
  }
  // 바깥 이웃 값 조회: bbox 밖이면 원본 data에서 직접 읽는다
  const sample = (c, gx, gy) => {
    const lx = gx - bounds.minX;
    const ly = gy - bounds.minY;
    if (lx >= 0 && lx < bw && ly >= 0 && ly < bh) return channels[c][ly * bw + lx];
    return data[(gy * width + gx) * 4 + c];
  };
  const omega = 1.9;
  for (let it = 0; it < iterations; it += 1) {
    for (const local of targets) {
      const lx = local % bw;
      const ly = (local / bw) | 0;
      const gx = bounds.minX + lx;
      const gy = bounds.minY + ly;
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        let n = 0;
        if (gx > 0) { sum += sample(c, gx - 1, gy); n += 1; }
        if (gx < width - 1) { sum += sample(c, gx + 1, gy); n += 1; }
        if (gy > 0) { sum += sample(c, gx, gy - 1); n += 1; }
        if (gy < height - 1) { sum += sample(c, gx, gy + 1); n += 1; }
        const cur = channels[c][local];
        channels[c][local] = cur + omega * (sum / n - cur);
      }
    }
  }
  for (const local of targets) {
    const idx = ((bounds.minY + ((local / bw) | 0)) * width + bounds.minX + (local % bw)) * 4;
    for (let c = 0; c < 3; c += 1) data[idx + c] = channels[c][local];
  }
}

// ── [P2] PatchMatch 간이판 ──────────────────────────────────
// 선형 보간 결과를 초기값으로 두고, 마스크 주변 링에서 5×5 패치를 샘플링해
// 문맥이 가장 잘 맞는 원본 질감을 입힌다. 배경이 매끈하면(분산 낮음) 건너뛴다.

function textureRefine(out, mask, width, height, bounds) {
  const R = 2; // 5×5 문맥 창
  const band = 28; // 마스크 주변 샘플 링 폭

  // 링 영역의 질감 강도 측정 (루마 표준편차)
  const rx0 = Math.max(R, bounds.minX - band);
  const rx1 = Math.min(width - 1 - R, bounds.maxX + band);
  const ry0 = Math.max(R, bounds.minY - band);
  const ry1 = Math.min(height - 1 - R, bounds.maxY + band);
  const data = out.data;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const ringLuma = (idx) =>
    data[idx * 4] * 0.299 + data[idx * 4 + 1] * 0.587 + data[idx * 4 + 2] * 0.114;
  for (let y = ry0; y <= ry1; y += 2) {
    for (let x = rx0; x <= rx1; x += 2) {
      const idx = y * width + x;
      if (mask[idx]) continue;
      const v = ringLuma(idx);
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  if (n < 60) return;
  const std = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  if (std <= 3) return; // 매끈한 배경 — 선형 결과가 이미 최적

  // 소스 후보: 5×5 창 전체가 마스크 밖인 위치 (cleanMap = 전파 검증용 전체 지도)
  const cleanMap = new Uint8Array(width * height);
  const allSources = [];
  for (let y = ry0; y <= ry1; y += 1) {
    for (let x = rx0; x <= rx1; x += 1) {
      let clean = true;
      for (let dy = -R; dy <= R && clean; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) {
          if (mask[(y + dy) * width + x + dx]) {
            clean = false;
            break;
          }
        }
      }
      if (clean) {
        cleanMap[y * width + x] = 1;
        allSources.push(y * width + x);
      }
    }
  }
  if (allSources.length < 30) return;
  // 무작위 후보 풀은 셔플 후 상한 적용 (속도)
  for (let i = allSources.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSources[i], allSources[j]] = [allSources[j], allSources[i]];
  }
  const sources = allSources.slice(0, 700);

  const targets = [];
  for (let y = Math.max(R, bounds.minY); y <= Math.min(height - 1 - R, bounds.maxY); y += 1) {
    for (let x = Math.max(R, bounds.minX); x <= Math.min(width - 1 - R, bounds.maxX); x += 1) {
      if (mask[y * width + x]) targets.push(y * width + x);
    }
  }
  if (!targets.length) return;

  // [v3.7.2] 저주파 매칭 — 패치의 '평균 색'만 비교한다.
  // 픽셀 단위 SSD는 선형으로 메워진 매끈한 문맥과 가장 비슷한 = 가장 매끈한
  // 소스를 골라버려 질감 복원이 자기모순으로 무력화된다. 입자(고주파)는
  // 어차피 무작위라 맞출 필요가 없고, 색·능선(저주파)만 맞으면 된다.
  const patchMean = (idx) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dy = -R; dy <= R; dy += 1) {
      const row = (idx + dy * width) * 4;
      for (let dx = -R; dx <= R; dx += 1) {
        r += data[row + dx * 4];
        g += data[row + dx * 4 + 1];
        b += data[row + dx * 4 + 2];
      }
    }
    const n25 = (2 * R + 1) ** 2;
    return [r / n25, g / n25, b / n25];
  };
  const meanCache = new Map();
  const patchSSD = (tIdx, sIdx) => {
    let tm = meanCache.get(tIdx);
    if (!tm) { tm = patchMean(tIdx); meanCache.set(tIdx, tm); }
    let sm = meanCache.get(sIdx);
    if (!sm) { sm = patchMean(sIdx); meanCache.set(sIdx, sm); }
    const dr = tm[0] - sm[0];
    const dg = tm[1] - sm[1];
    const db = tm[2] - sm[2];
    return dr * dr + dg * dg + db * db;
  };

  const bestSource = new Map();
  const pickRandom = () => sources[Math.floor(Math.random() * sources.length)];

  const evaluate = (tIdx, candidates) => {
    let best = bestSource.get(tIdx);
    let bestScore = best !== undefined ? patchSSD(tIdx, best) : Infinity;
    for (const cand of candidates) {
      if (cand === undefined || cand === best) continue;
      const score = patchSSD(tIdx, cand);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    bestSource.set(tIdx, best);
  };

  // 2회 반복: 순방향(좌상→우하, 이웃 오프셋 전파) + 역방향
  for (let iter = 0; iter < 2; iter += 1) {
    const order = iter === 0 ? targets : [...targets].reverse();
    const dir = iter === 0 ? 1 : -1;
    for (const tIdx of order) {
      const candidates = [pickRandom(), pickRandom(), pickRandom()];
      // 전파: 이웃 타깃의 소스를 한 칸 평행이동한 위치
      const nH = bestSource.get(tIdx - dir);
      if (nH !== undefined && cleanMap[nH + dir]) candidates.push(nH + dir);
      const nV = bestSource.get(tIdx - dir * width);
      if (nV !== undefined && cleanMap[nV + dir * width]) candidates.push(nV + dir * width);
      evaluate(tIdx, candidates);
    }
  }

  // 스냅샷에서 읽어 일괄 적용 (피드백 방지).
  // [v3.7.2] 내부는 소스 입자를 100% 복사해 질감을 온전히 살리고,
  // 마스크 경계 2px 안쪽만 블렌딩해 이음새를 죽인다.
  const snapshot = new Uint8ClampedArray(data);
  const edgeDist = (tIdx) => {
    const x = tIdx % width;
    const y = Math.floor(tIdx / width);
    for (let d = 1; d <= 2; d += 1) {
      for (let dy = -d; dy <= d; dy += 1) {
        for (let dx = -d; dx <= d; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (!mask[ny * width + nx]) return d;
        }
      }
    }
    return 3;
  };
  for (const tIdx of targets) {
    const sIdx = bestSource.get(tIdx);
    if (sIdx === undefined) continue;
    const d = edgeDist(tIdx);
    const w = d >= 3 ? 1 : d === 2 ? 0.75 : 0.45;
    const to = tIdx * 4;
    const so = sIdx * 4;
    data[to] = snapshot[to] * (1 - w) + snapshot[so] * w;
    data[to + 1] = snapshot[to + 1] * (1 - w) + snapshot[so + 1] * w;
    data[to + 2] = snapshot[to + 2] * (1 - w) + snapshot[so + 2] * w;
  }
}
