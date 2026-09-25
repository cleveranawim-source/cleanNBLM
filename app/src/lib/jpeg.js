// JPEG 무손실 부분 교체 — 워터마크에 닿는 MCU(8×8 블록 묶음)의 DCT 계수만 새로 계산하고,
// 나머지 계수는 원본 그대로 다시 싣는다(jpegtran과 같은 계수 영역 처리).
// 전체를 canvas로 다시 압축하면 화질이 한 번 더 깎이고 용량도 커진다(q0.96 기준 원본의 ~2배).
// 지원: 8비트 허프만 부호화 순차(SOF0/1)·프로그레시브(SOF2), 1·3성분, 재시작 마커.
// 출력: 원본 양자화 표 + 최적화 허프만 표의 순차 JPEG, APPn·COM 세그먼트(EXIF·ICC 등) 보존.

const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27,
  20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

class Unsupported extends Error {}

function buildDecodeTable(counts, symbols) {
  const maxcode = new Int32Array(18).fill(-1);
  const mincode = new Int32Array(17);
  const valptr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    valptr[len] = k;
    mincode[len] = code;
    code += counts[len - 1];
    k += counts[len - 1];
    maxcode[len] = counts[len - 1] ? code - 1 : -1;
    code <<= 1;
  }
  return { maxcode, mincode, valptr, symbols };
}

// ── 파싱 + 계수 디코딩 ──────────────────────────────────────

export function parseJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Unsupported('not a JPEG');
  const quant = [];
  const dcTables = [];
  const acTables = [];
  const keep = [];
  let frame = null;
  let resetInterval = 0;
  let adobeTransform = null;
  let orientation = 1;
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xff) {
      offset -= 1;
      continue;
    }
    if (marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const start = offset + 2;
    const end = offset + length;

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      keep.push(bytes.slice(offset - 2, end));
      if (marker === 0xee && String.fromCharCode(...bytes.subarray(start, start + 5)) === 'Adobe') {
        adobeTransform = bytes[start + 11];
      }
      if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(start, start + 4)) === 'Exif') {
        orientation = readExifOrientation(bytes, start + 6, end);
      }
    } else if (marker === 0xdb) {
      let p = start;
      while (p < end) {
        const precision = bytes[p] >> 4;
        const id = bytes[p] & 15;
        p += 1;
        const table = new Uint16Array(64);
        for (let k = 0; k < 64; k += 1) {
          table[ZIGZAG[k]] = precision ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
          p += precision ? 2 : 1;
        }
        quant[id] = { table, precision };
      }
    } else if (marker === 0xc4) {
      let p = start;
      while (p < end) {
        const cls = bytes[p] >> 4;
        const id = bytes[p] & 15;
        const counts = bytes.subarray(p + 1, p + 17);
        let total = 0;
        for (const c of counts) total += c;
        const symbols = bytes.slice(p + 17, p + 17 + total);
        (cls === 0 ? dcTables : acTables)[id] = buildDecodeTable(counts, symbols);
        p += 17 + total;
      }
    } else if (marker === 0xdd) {
      resetInterval = (bytes[start] << 8) | bytes[start + 1];
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (bytes[start] !== 8) throw new Unsupported('precision');
      frame = {
        progressive: marker === 0xc2,
        height: (bytes[start + 1] << 8) | bytes[start + 2],
        width: (bytes[start + 3] << 8) | bytes[start + 4],
        components: [],
      };
      const n = bytes[start + 5];
      for (let i = 0; i < n; i += 1) {
        const o = start + 6 + i * 3;
        frame.components.push({ id: bytes[o], h: bytes[o + 1] >> 4, v: bytes[o + 1] & 15, tq: bytes[o + 2] });
      }
      prepareFrame(frame);
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      throw new Unsupported('coding'); // 무손실·계층·산술 부호화
    } else if (marker === 0xda) {
      if (!frame) throw new Unsupported('no frame');
      const count = bytes[start];
      const comps = [];
      for (let i = 0; i < count; i += 1) {
        const id = bytes[start + 1 + i * 2];
        const sel = bytes[start + 2 + i * 2];
        const comp = frame.components.find((c) => c.id === id);
        if (!comp) throw new Unsupported('component');
        comp.dcTable = dcTables[sel >> 4];
        comp.acTable = acTables[sel & 15];
        comps.push(comp);
      }
      const p = start + 1 + count * 2;
      const ss = bytes[p];
      const se = bytes[p + 1];
      const ah = bytes[p + 2] >> 4;
      const al = bytes[p + 2] & 15;
      offset = decodeScan(bytes, end, frame, comps, resetInterval, ss, se, ah, al);
      continue;
    }
    offset = end;
  }
  if (!frame) throw new Unsupported('no frame');
  return { frame, quant, keep, adobeTransform, orientation };
}

function readExifOrientation(bytes, tiff, end) {
  if (tiff + 8 > end) return 1;
  const le = bytes[tiff] === 0x49;
  const u16 = (o) => (le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
  const u32 = (o) =>
    le
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 1;
}

function prepareFrame(frame) {
  frame.maxH = Math.max(...frame.components.map((c) => c.h));
  frame.maxV = Math.max(...frame.components.map((c) => c.v));
  frame.mcusPerLine = Math.ceil(frame.width / (8 * frame.maxH));
  frame.mcusPerColumn = Math.ceil(frame.height / (8 * frame.maxV));
  for (const c of frame.components) {
    c.blocksPerLine = Math.ceil(Math.ceil((frame.width * c.h) / frame.maxH) / 8);
    c.blocksPerColumn = Math.ceil(Math.ceil((frame.height * c.v) / frame.maxV) / 8);
    c.stride = frame.mcusPerLine * c.h;
    c.coeffs = new Int16Array(64 * c.stride * frame.mcusPerColumn * c.v);
  }
}

function decodeScan(data, start, frame, components, resetInterval, spectralStart, spectralEnd, ah, al) {
  let offset = start;
  let bitsData = 0;
  let bitsCount = 0;
  const readBit = () => {
    if (bitsCount > 0) {
      bitsCount -= 1;
      return (bitsData >> bitsCount) & 1;
    }
    bitsData = data[offset];
    offset += 1;
    if (bitsData === 0xff) {
      if (data[offset] !== 0) {
        // 예상치 못한 마커(잘린 파일 등) — 이후 비트는 0으로 채운다
        offset -= 1;
        bitsData = 0;
      } else {
        offset += 1;
      }
    }
    bitsCount = 7;
    return (bitsData >>> 7) & 1;
  };
  const decodeHuffman = (t) => {
    if (!t) throw new Unsupported('huffman table');
    let code = 0;
    for (let len = 1; len <= 16; len += 1) {
      code = (code << 1) | readBit();
      if (code <= t.maxcode[len]) return t.symbols[t.valptr[len] + code - t.mincode[len]];
    }
    throw new Unsupported('bad code');
  };
  const receive = (length) => {
    let n = 0;
    for (let i = 0; i < length; i += 1) n = (n << 1) | readBit();
    return n;
  };
  const receiveExtend = (length) => {
    if (!length) return 0;
    const n = receive(length);
    return n >= 1 << (length - 1) ? n : n - (1 << length) + 1;
  };

  let eobrun = 0;
  const decodeBaseline = (c, o) => {
    c.pred += receiveExtend(decodeHuffman(c.dcTable));
    c.coeffs[o] = c.pred;
    let k = 1;
    while (k < 64) {
      const rs = decodeHuffman(c.acTable);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      c.coeffs[o + ZIGZAG[k]] = receiveExtend(s);
      k += 1;
    }
  };
  const decodeDCFirst = (c, o) => {
    c.pred += receiveExtend(decodeHuffman(c.dcTable));
    c.coeffs[o] = c.pred * (1 << al);
  };
  const decodeDCSuccessive = (c, o) => {
    if (readBit()) c.coeffs[o] |= 1 << al;
  };
  const decodeACFirst = (c, o) => {
    if (eobrun > 0) {
      eobrun -= 1;
      return;
    }
    let k = spectralStart;
    while (k <= spectralEnd) {
      const rs = decodeHuffman(c.acTable);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          eobrun = receive(r) + (1 << r) - 1;
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      c.coeffs[o + ZIGZAG[k]] = receiveExtend(s) * (1 << al);
      k += 1;
    }
  };
  let acState = 0;
  let acNext = 0;
  let acRun = 0;
  const decodeACSuccessive = (c, o) => {
    let k = spectralStart;
    const bit = 1 << al;
    while (k <= spectralEnd) {
      const z = o + ZIGZAG[k];
      const sign = c.coeffs[z] < 0 ? -1 : 1;
      switch (acState) {
        case 0: {
          const rs = decodeHuffman(c.acTable);
          const s = rs & 15;
          acRun = rs >> 4;
          if (s === 0) {
            if (acRun < 15) {
              eobrun = receive(acRun) + (1 << acRun);
              acState = 4;
            } else {
              acRun = 16;
              acState = 1;
            }
          } else {
            acNext = receiveExtend(s);
            acState = acRun ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          if (c.coeffs[z]) {
            c.coeffs[z] += sign * (readBit() ? bit : 0);
          } else {
            acRun -= 1;
            if (acRun === 0) acState = acState === 2 ? 3 : 0;
          }
          break;
        case 3:
          if (c.coeffs[z]) {
            c.coeffs[z] += sign * (readBit() ? bit : 0);
          } else {
            c.coeffs[z] = acNext * bit;
            acState = 0;
          }
          break;
        case 4:
          if (c.coeffs[z]) c.coeffs[z] += sign * (readBit() ? bit : 0);
          break;
        default:
          break;
      }
      k += 1;
    }
    if (acState === 4) {
      eobrun -= 1;
      if (eobrun === 0) acState = 0;
    }
  };

  let decode = decodeBaseline;
  if (frame.progressive) {
    if (spectralStart === 0) decode = ah === 0 ? decodeDCFirst : decodeDCSuccessive;
    else decode = ah === 0 ? decodeACFirst : decodeACSuccessive;
  }

  const single = components.length === 1;
  const total = single
    ? components[0].blocksPerLine * components[0].blocksPerColumn
    : frame.mcusPerLine * frame.mcusPerColumn;
  let mcu = 0;
  while (mcu < total) {
    const count = resetInterval ? Math.min(total - mcu, resetInterval) : total;
    for (const c of components) c.pred = 0;
    eobrun = 0;
    acState = 0;
    for (let n = 0; n < count; n += 1) {
      if (single) {
        const c = components[0];
        const row = (mcu / c.blocksPerLine) | 0;
        const col = mcu % c.blocksPerLine;
        decode(c, 64 * (row * c.stride + col));
      } else {
        const mcuRow = (mcu / frame.mcusPerLine) | 0;
        const mcuCol = mcu % frame.mcusPerLine;
        for (const c of components) {
          for (let j = 0; j < c.v; j += 1) {
            for (let i = 0; i < c.h; i += 1) {
              decode(c, 64 * ((mcuRow * c.v + j) * c.stride + mcuCol * c.h + i));
            }
          }
        }
      }
      mcu += 1;
    }
    // 재시작 마커(RSTn) 건너뛰기 — 바이트 정렬 후 다음 마커를 찾는다
    bitsCount = 0;
    while (offset < data.length && !(data[offset] === 0xff && data[offset + 1] !== 0 && data[offset + 1] !== 0xff)) {
      offset += 1;
    }
    if (offset < data.length && data[offset + 1] >= 0xd0 && data[offset + 1] <= 0xd7) offset += 2;
    else break;
  }
  // 스캔 끝: 다음 마커 위치로
  while (offset < data.length && !(data[offset] === 0xff && data[offset + 1] !== 0 && !(data[offset + 1] >= 0xd0 && data[offset + 1] <= 0xd7))) {
    offset += 1;
  }
  return offset;
}

// ── 계수 다시 계산 (바뀐 MCU만) ─────────────────────────────

const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x += 1) {
    for (let u = 0; u < 8; u += 1) {
      t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return t;
})();

function fdct(block) {
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let x = 0; x < 8; x += 1) s += block[y * 8 + x] * COS[x * 8 + u];
      tmp[y * 8 + u] = s / 2;
    }
  }
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let s = 0;
      for (let y = 0; y < 8; y += 1) s += tmp[y * 8 + u] * COS[y * 8 + v];
      out[v * 8 + u] = s / 2;
    }
  }
  return out;
}

// 성분 평면 값: 0=Y/회색, 1=Cb, 2=Cr (RGB JPEG이면 R/G/B 그대로)
function componentValue(data, o, index, rgb) {
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  if (rgb) return index === 0 ? r : index === 1 ? g : b;
  if (index === 0) return 0.299 * r + 0.587 * g + 0.114 * b;
  if (index === 1) return -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
  return 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
}

function reencodeMcus(jpeg, imageData, box) {
  const { frame, quant } = jpeg;
  const { width, height, data } = imageData;
  const rgb =
    jpeg.adobeTransform === 0 ||
    (frame.components.length === 3 &&
      frame.components[0].id === 82 &&
      frame.components[1].id === 71 &&
      frame.components[2].id === 66);
  const mcuW = 8 * frame.maxH;
  const mcuH = 8 * frame.maxV;
  const mx0 = Math.floor(box.x0 / mcuW);
  const mx1 = Math.min(frame.mcusPerLine - 1, Math.floor(box.x1 / mcuW));
  const my0 = Math.floor(box.y0 / mcuH);
  const my1 = Math.min(frame.mcusPerColumn - 1, Math.floor(box.y1 / mcuH));
  const block = new Float64Array(64);
  frame.components.forEach((c, index) => {
    const q = quant[c.tq]?.table;
    if (!q) throw new Unsupported('quant table');
    const sx = frame.maxH / c.h;
    const sy = frame.maxV / c.v;
    for (let my = my0; my <= my1; my += 1) {
      for (let mx = mx0; mx <= mx1; mx += 1) {
        for (let j = 0; j < c.v; j += 1) {
          for (let i = 0; i < c.h; i += 1) {
            const by = my * c.v + j;
            const bx = mx * c.h + i;
            for (let yy = 0; yy < 8; yy += 1) {
              for (let xx = 0; xx < 8; xx += 1) {
                // 성분 평면 좌표 → 원본 픽셀 sx×sy 영역 평균 (가장자리는 복제)
                let sum = 0;
                let n = 0;
                const px0 = (bx * 8 + xx) * sx;
                const py0 = (by * 8 + yy) * sy;
                for (let dy = 0; dy < sy; dy += 1) {
                  const py = Math.min(height - 1, py0 + dy);
                  for (let dx = 0; dx < sx; dx += 1) {
                    const px = Math.min(width - 1, px0 + dx);
                    sum += componentValue(data, (py * width + px) * 4, index, rgb);
                    n += 1;
                  }
                }
                block[yy * 8 + xx] = sum / n - 128;
              }
            }
            const f = fdct(block);
            const o = 64 * (by * c.stride + bx);
            for (let k = 0; k < 64; k += 1) {
              const limit = k === 0 ? 2047 : 1023;
              c.coeffs[o + k] = Math.max(-limit, Math.min(limit, Math.round(f[k] / q[k])));
            }
          }
        }
      }
    }
  });
}

// ── 인코딩 (순차 JPEG + 최적화 허프만) ───────────────────────

function bitLength(v) {
  let n = 0;
  let a = v < 0 ? -v : v;
  while (a) {
    n += 1;
    a >>= 1;
  }
  return n;
}

// JPEG 부록 K.2 — 16비트 제한 최적 허프만 부호 길이
function optimalTable(counts) {
  const freq = new Float64Array(257);
  freq.set(counts);
  freq[256] = 1;
  const codesize = new Int32Array(257);
  const others = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1;
    let v = Infinity;
    for (let i = 0; i <= 256; i += 1) {
      if (freq[i] && freq[i] <= v) {
        v = freq[i];
        c1 = i;
      }
    }
    let c2 = -1;
    v = Infinity;
    for (let i = 0; i <= 256; i += 1) {
      if (freq[i] && freq[i] <= v && i !== c1) {
        v = freq[i];
        c2 = i;
      }
    }
    if (c2 < 0) break;
    freq[c1] += freq[c2];
    freq[c2] = 0;
    codesize[c1] += 1;
    while (others[c1] >= 0) {
      c1 = others[c1];
      codesize[c1] += 1;
    }
    others[c1] = c2;
    codesize[c2] += 1;
    while (others[c2] >= 0) {
      c2 = others[c2];
      codesize[c2] += 1;
    }
  }
  const bits = new Int32Array(33);
  for (let i = 0; i <= 256; i += 1) if (codesize[i]) bits[codesize[i]] += 1;
  for (let i = 32; i > 16; i -= 1) {
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j -= 1;
      bits[i] -= 2;
      bits[i - 1] += 1;
      bits[j + 1] += 2;
      bits[j] -= 1;
    }
  }
  let top = 16;
  while (bits[top] === 0) top -= 1;
  bits[top] -= 1; // 예약 기호 제거
  const values = [];
  for (let len = 1; len <= 32; len += 1) {
    for (let s = 0; s < 256; s += 1) if (codesize[s] === len) values.push(s);
  }
  const lengths = Array.from(bits.subarray(1, 17));
  const code = new Int32Array(256);
  const size = new Int32Array(256);
  let c = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < lengths[len - 1]; i += 1) {
      code[values[k]] = c;
      size[values[k]] = len;
      c += 1;
      k += 1;
    }
    c <<= 1;
  }
  return { lengths, values, code, size };
}

class BitWriter {
  constructor(capacity) {
    this.buf = new Uint8Array(capacity);
    this.len = 0;
    this.acc = 0;
    this.n = 0;
  }

  push(byte) {
    if (this.len >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len] = byte;
    this.len += 1;
  }

  write(value, count) {
    if (!count) return;
    this.acc = (this.acc << count) | (value & ((1 << count) - 1));
    this.n += count;
    while (this.n >= 8) {
      const byte = (this.acc >>> (this.n - 8)) & 0xff;
      this.push(byte);
      if (byte === 0xff) this.push(0);
      this.n -= 8;
    }
    this.acc &= (1 << this.n) - 1;
  }

  flush() {
    if (this.n > 0) this.write((1 << (8 - this.n)) - 1, 8 - this.n);
  }
}

// 모든 블록을 부호화 순서대로 돌며 (DC/AC 기호, 추가 비트)를 넘긴다
function walkBlocks(frame, emit) {
  const comps = frame.components;
  const preds = comps.map(() => 0);
  const encodeBlock = (c, ci, o) => {
    const diff = c.coeffs[o] - preds[ci];
    preds[ci] = c.coeffs[o];
    const dcSize = bitLength(diff);
    emit(0, ci, dcSize, diff < 0 ? diff - 1 : diff, dcSize);
    let run = 0;
    for (let k = 1; k < 64; k += 1) {
      const v = c.coeffs[o + ZIGZAG[k]];
      if (!v) {
        run += 1;
        continue;
      }
      while (run > 15) {
        emit(1, ci, 0xf0, 0, 0);
        run -= 16;
      }
      const s = bitLength(v);
      emit(1, ci, (run << 4) | s, v < 0 ? v - 1 : v, s);
      run = 0;
    }
    if (run) emit(1, ci, 0x00, 0, 0);
  };
  if (comps.length === 1) {
    const c = comps[0];
    for (let row = 0; row < c.blocksPerColumn; row += 1) {
      for (let col = 0; col < c.blocksPerLine; col += 1) encodeBlock(c, 0, 64 * (row * c.stride + col));
    }
    return;
  }
  for (let my = 0; my < frame.mcusPerColumn; my += 1) {
    for (let mx = 0; mx < frame.mcusPerLine; mx += 1) {
      comps.forEach((c, ci) => {
        for (let j = 0; j < c.v; j += 1) {
          for (let i = 0; i < c.h; i += 1) {
            encodeBlock(c, ci, 64 * ((my * c.v + j) * c.stride + mx * c.h + i));
          }
        }
      });
    }
  }
}

function segment(marker, body) {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (body.length + 2) >> 8;
  out[3] = (body.length + 2) & 0xff;
  out.set(body, 4);
  return out;
}

// DC만 (프로그레시브 첫 스캔, 여러 성분이면 인터리브 순서)
function walkDcScan(frame, emit) {
  const comps = frame.components;
  const preds = comps.map(() => 0);
  const dc = (c, ci, o) => {
    const diff = c.coeffs[o] - preds[ci];
    preds[ci] = c.coeffs[o];
    const size = bitLength(diff);
    emit(0, ci, size, diff < 0 ? diff - 1 : diff, size);
  };
  if (comps.length === 1) {
    const c = comps[0];
    for (let row = 0; row < c.blocksPerColumn; row += 1) {
      for (let col = 0; col < c.blocksPerLine; col += 1) dc(c, 0, 64 * (row * c.stride + col));
    }
    return;
  }
  for (let my = 0; my < frame.mcusPerColumn; my += 1) {
    for (let mx = 0; mx < frame.mcusPerLine; mx += 1) {
      comps.forEach((c, ci) => {
        for (let j = 0; j < c.v; j += 1) {
          for (let i = 0; i < c.h; i += 1) dc(c, ci, 64 * ((my * c.v + j) * c.stride + mx * c.h + i));
        }
      });
    }
  }
}

// 한 성분의 AC 대역 [ss, se] (프로그레시브, 연속 근사 없음) — 빈 블록은 EOBRUN으로 묶는다
function walkAcScan(c, ss, se, emit) {
  let eobrun = 0;
  const flushEob = () => {
    if (!eobrun) return;
    const nbits = bitLength(eobrun) - 1;
    emit(1, 0, nbits << 4, eobrun - (1 << nbits), nbits);
    eobrun = 0;
  };
  for (let row = 0; row < c.blocksPerColumn; row += 1) {
    for (let col = 0; col < c.blocksPerLine; col += 1) {
      const o = 64 * (row * c.stride + col);
      let run = 0;
      for (let k = ss; k <= se; k += 1) {
        const v = c.coeffs[o + ZIGZAG[k]];
        if (!v) {
          run += 1;
          continue;
        }
        flushEob();
        while (run > 15) {
          emit(1, 0, 0xf0, 0, 0);
          run -= 16;
        }
        const s = bitLength(v);
        emit(1, 0, (run << 4) | s, v < 0 ? v - 1 : v, s);
        run = 0;
      }
      if (run) {
        eobrun += 1;
        if (eobrun === 0x7fff) flushEob();
      }
    }
  }
  flushEob();
}

function headerParts(jpeg, sofMarker) {
  const { frame, quant, keep } = jpeg;
  const parts = [new Uint8Array([0xff, 0xd8]), ...keep];
  let extended = false;
  for (const id of [...new Set(frame.components.map((c) => c.tq))]) {
    const { table, precision } = quant[id];
    if (precision) extended = true;
    const body = new Uint8Array(1 + 64 * (precision ? 2 : 1));
    body[0] = (precision << 4) | id;
    for (let k = 0; k < 64; k += 1) {
      const v = table[ZIGZAG[k]];
      if (precision) {
        body[1 + k * 2] = v >> 8;
        body[2 + k * 2] = v & 0xff;
      } else {
        body[1 + k] = v;
      }
    }
    parts.push(segment(0xdb, body));
  }
  const sof = new Uint8Array(6 + frame.components.length * 3);
  sof[0] = 8;
  sof[1] = frame.height >> 8;
  sof[2] = frame.height & 0xff;
  sof[3] = frame.width >> 8;
  sof[4] = frame.width & 0xff;
  sof[5] = frame.components.length;
  frame.components.forEach((c, i) => {
    sof[6 + i * 3] = c.id;
    sof[7 + i * 3] = (c.h << 4) | c.v;
    sof[8 + i * 3] = c.tq;
  });
  // 순차 방식에서 16비트 양자화 표가 있으면 확장 순차(SOF1)로 표시해야 한다
  const marker = sofMarker === 0xc0 && extended ? 0xc1 : sofMarker;
  parts.push(segment(marker, sof));
  return parts;
}

// 스캔 하나 = (기호 빈도 → 최적 표 → DHT) + SOS + 엔트로피 데이터.
// emit(cls, ci, symbol, extra, extraLen): symbol<0이면 허프만 기호 없이 원시 비트만(보정 비트)
function writeScan(parts, walk, scanComps, ss, se, ah, al, tableOf) {
  const counts = [0, 1].map(() => [new Float64Array(256), new Float64Array(256)]);
  walk((cls, ci, symbol) => {
    if (symbol >= 0) counts[cls][tableOf(ci)][symbol] += 1;
  });
  const tables = [0, 1].map((cls) =>
    [0, 1].map((id) => (counts[cls][id].some((v) => v) ? optimalTable(counts[cls][id]) : null)),
  );
  for (const cls of [0, 1]) {
    for (const id of [0, 1]) {
      const t = tables[cls][id];
      if (!t) continue;
      const body = new Uint8Array(17 + t.values.length);
      body[0] = (cls << 4) | id;
      body.set(t.lengths, 1);
      body.set(t.values, 17);
      parts.push(segment(0xc4, body));
    }
  }
  const sos = new Uint8Array(4 + scanComps.length * 2);
  sos[0] = scanComps.length;
  scanComps.forEach((c, i) => {
    sos[1 + i * 2] = c.id;
    sos[2 + i * 2] = (tableOf(i) << 4) | tableOf(i);
  });
  sos[sos.length - 3] = ss;
  sos[sos.length - 2] = se;
  sos[sos.length - 1] = (ah << 4) | al;
  parts.push(segment(0xda, sos));
  const writer = new BitWriter(1 << 18);
  walk((cls, ci, symbol, extra, extraLen) => {
    if (symbol >= 0) {
      const t = tables[cls][tableOf(ci)];
      writer.write(t.code[symbol], t.size[symbol]);
    }
    writer.write(extra, extraLen);
  });
  writer.flush();
  parts.push(writer.buf.subarray(0, writer.len));
}

// ── 연속 근사(successive approximation) 프로그레시브 — libjpeg jcphuff.c와 같은 방식 ──

function forEachBlock(frame, comps, fn) {
  if (comps.length === 1) {
    const c = comps[0];
    const ci = frame.components.indexOf(c);
    for (let row = 0; row < c.blocksPerColumn; row += 1) {
      for (let col = 0; col < c.blocksPerLine; col += 1) fn(c, ci === 0 ? 0 : 1, 64 * (row * c.stride + col), 0);
    }
    return;
  }
  for (let my = 0; my < frame.mcusPerColumn; my += 1) {
    for (let mx = 0; mx < frame.mcusPerLine; mx += 1) {
      comps.forEach((c, si) => {
        for (let j = 0; j < c.v; j += 1) {
          for (let i = 0; i < c.h; i += 1) fn(c, si, 64 * ((my * c.v + j) * c.stride + mx * c.h + i), si);
        }
      });
    }
  }
}

function walkDcSA(frame, comps, ah, al, emit) {
  const preds = comps.map(() => 0);
  forEachBlock(frame, comps, (c, ci, o, si) => {
    if (ah) {
      emit(0, ci, -1, (c.coeffs[o] >> al) & 1, 1);
      return;
    }
    const value = c.coeffs[o] >> al;
    const diff = value - preds[si];
    preds[si] = value;
    const size = bitLength(diff);
    emit(0, ci, size, diff < 0 ? diff - 1 : diff, size);
  });
}

function walkAcFirstSA(c, ss, se, al, emit) {
  let eobrun = 0;
  const flushEob = () => {
    if (!eobrun) return;
    const nbits = bitLength(eobrun) - 1;
    emit(1, 0, nbits << 4, eobrun, nbits);
    eobrun = 0;
  };
  for (let row = 0; row < c.blocksPerColumn; row += 1) {
    for (let col = 0; col < c.blocksPerLine; col += 1) {
      const o = 64 * (row * c.stride + col);
      let run = 0;
      for (let k = ss; k <= se; k += 1) {
        const v = c.coeffs[o + ZIGZAG[k]];
        const mag = (v < 0 ? -v : v) >> al;
        if (!mag) {
          run += 1;
          continue;
        }
        flushEob();
        while (run > 15) {
          emit(1, 0, 0xf0, 0, 0);
          run -= 16;
        }
        const s = bitLength(mag);
        emit(1, 0, (run << 4) | s, v < 0 ? -mag - 1 : mag, s);
        run = 0;
      }
      if (run) {
        eobrun += 1;
        if (eobrun === 0x7fff) flushEob();
      }
    }
  }
  flushEob();
}

function walkAcRefineSA(c, ss, se, al, emit) {
  let eobrun = 0;
  let pending = []; // EOBRUN에 묶인 이전 블록들의 보정 비트
  const flushEob = () => {
    if (!eobrun) return;
    const nbits = bitLength(eobrun) - 1;
    emit(1, 0, nbits << 4, eobrun, nbits);
    eobrun = 0;
    for (const bit of pending) emit(1, 0, -1, bit, 1);
    pending = [];
  };
  const abs = new Int32Array(64);
  for (let row = 0; row < c.blocksPerColumn; row += 1) {
    for (let col = 0; col < c.blocksPerLine; col += 1) {
      const o = 64 * (row * c.stride + col);
      let eob = 0;
      for (let k = ss; k <= se; k += 1) {
        const v = c.coeffs[o + ZIGZAG[k]];
        abs[k] = (v < 0 ? -v : v) >> al;
        if (abs[k] === 1) eob = k;
      }
      let run = 0;
      let bits = []; // 이 블록의 보정 비트
      for (let k = ss; k <= se; k += 1) {
        const mag = abs[k];
        if (!mag) {
          run += 1;
          continue;
        }
        while (run > 15 && k <= eob) {
          flushEob();
          emit(1, 0, 0xf0, 0, 0);
          run -= 16;
          for (const bit of bits) emit(1, 0, -1, bit, 1);
          bits = [];
        }
        if (mag > 1) {
          bits.push(mag & 1);
          continue;
        }
        flushEob();
        emit(1, 0, (run << 4) | 1, c.coeffs[o + ZIGZAG[k]] < 0 ? 0 : 1, 1);
        for (const bit of bits) emit(1, 0, -1, bit, 1);
        bits = [];
        run = 0;
      }
      if (run > 0 || bits.length) {
        eobrun += 1;
        pending.push(...bits);
        if (eobrun === 0x7fff || pending.length > 937) flushEob();
      }
    }
  }
  flushEob();
}

// mode: 'sequential'(한 스캔) · 'spectral'(스펙트럼 선택 프로그레시브)
//       · 'successive'(libjpeg 기본 프로그레시브 스크립트 — 연속 근사 포함)
export function encodeJpeg(jpeg, { mode = 'sequential' } = {}) {
  const { frame } = jpeg;
  const comps = frame.components;
  const lumaChroma = (ci) => (ci === 0 ? 0 : 1);
  const acOnly = () => 0;
  if (mode === 'sequential') {
    const parts = headerParts(jpeg, 0xc0);
    writeScan(parts, (emit) => walkBlocks(frame, emit), comps, 0, 63, 0, 0, lumaChroma);
    parts.push(new Uint8Array([0xff, 0xd9]));
    return new Blob(parts, { type: 'image/jpeg' });
  }
  const parts = headerParts(jpeg, 0xc2);
  const Y = 0;
  const [Cb, Cr] = [1, 2];
  if (mode === 'spectral') {
    writeScan(parts, (emit) => walkDcScan(frame, emit), comps, 0, 0, 0, 0, lumaChroma);
    const acScans =
      comps.length === 1 ? [[Y, 1, 5], [Y, 6, 63]] : [[Y, 1, 5], [Cb, 1, 63], [Cr, 1, 63], [Y, 6, 63]];
    for (const [ci, ss, se] of acScans) {
      writeScan(parts, (emit) => walkAcScan(comps[ci], ss, se, emit), [comps[ci]], ss, se, 0, 0, acOnly);
    }
  } else {
    // [성분, Ss, Se, Ah, Al] — 성분 -1 = DC(전 성분)
    const script =
      comps.length === 1
        ? [[-1, 0, 0, 0, 1], [Y, 1, 5, 0, 2], [Y, 6, 63, 0, 2], [Y, 1, 63, 2, 1], [-1, 0, 0, 1, 0], [Y, 1, 63, 1, 0]]
        : [
            [-1, 0, 0, 0, 1], [Y, 1, 5, 0, 2], [Cr, 1, 63, 0, 1], [Cb, 1, 63, 0, 1], [Y, 6, 63, 0, 2],
            [Y, 1, 63, 2, 1], [-1, 0, 0, 1, 0], [Cr, 1, 63, 1, 0], [Cb, 1, 63, 1, 0], [Y, 1, 63, 1, 0],
          ];
    for (const [ci, ss, se, ah, al] of script) {
      if (ci < 0) {
        writeScan(parts, (emit) => walkDcSA(frame, comps, ah, al, emit), comps, 0, 0, ah, al, lumaChroma);
      } else if (ah === 0) {
        writeScan(parts, (emit) => walkAcFirstSA(comps[ci], ss, se, al, emit), [comps[ci]], ss, se, ah, al, acOnly);
      } else {
        writeScan(parts, (emit) => walkAcRefineSA(comps[ci], ss, se, al, emit), [comps[ci]], ss, se, ah, al, acOnly);
      }
    }
  }
  parts.push(new Uint8Array([0xff, 0xd9]));
  return new Blob(parts, { type: 'image/jpeg' });
}

// 세 방식으로 모두 만들어 가장 작은 쪽
export function encodeJpegSmallest(jpeg) {
  let best = null;
  for (const mode of ['sequential', 'spectral', 'successive']) {
    const blob = encodeJpeg(jpeg, { mode });
    if (!best || blob.size < best.size) best = blob;
  }
  return best;
}

// ── 공개 API ────────────────────────────────────────────────

// 원본 JPEG에서 바뀐 픽셀 영역의 MCU만 다시 인코딩한 JPEG 반환. 지원하지 않는 형식이면 null.
export async function patchJpeg(originalBlob, before, after) {
  let box = null;
  const { width, height } = after;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (
        before.data[o] !== after.data[o] ||
        before.data[o + 1] !== after.data[o + 1] ||
        before.data[o + 2] !== after.data[o + 2]
      ) {
        if (!box) box = { x0: x, y0: y, x1: x, y1: y };
        if (x < box.x0) box.x0 = x;
        if (x > box.x1) box.x1 = x;
        if (y < box.y0) box.y0 = y;
        if (y > box.y1) box.y1 = y;
      }
    }
  }
  if (!box) return originalBlob;
  try {
    const jpeg = parseJpeg(new Uint8Array(await originalBlob.arrayBuffer()));
    const n = jpeg.frame.components.length;
    if (n !== 1 && n !== 3) return null; // CMYK 등
    if (jpeg.orientation !== 1) return null; // 브라우저가 회전해 디코딩 — 좌표계가 다르다
    if (jpeg.frame.width !== width || jpeg.frame.height !== height) return null;
    reencodeMcus(jpeg, after, box);
    return encodeJpegSmallest(jpeg);
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

// 대체 경로용: DQT의 휘도 표로 원본 품질(IJG 기준) 추정
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

export async function estimateJpegQuality(blob) {
  try {
    const jpeg = parseJpeg(new Uint8Array(await blob.arrayBuffer()));
    const q = jpeg.quant[jpeg.frame.components[0].tq]?.table;
    if (!q) return 0.92;
    let scale = 0;
    for (let i = 0; i < 64; i += 1) scale += (q[i] * 100) / STD_LUMA[i];
    scale /= 64;
    const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
    return Math.max(0.5, Math.min(0.98, quality / 100));
  } catch {
    return 0.92;
  }
}
