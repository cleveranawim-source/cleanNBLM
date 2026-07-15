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

export function inpaintMask(imageData, mask, searchRadius) {
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

  return out;
}
