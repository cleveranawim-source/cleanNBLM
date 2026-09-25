// 자체 PNG 인코더 — 브라우저 canvas.toBlob은 압축이 약해 원본보다 ~40% 커진다
// (실파일 1376×768: 원본 1,163KB → canvas 1,624KB → 이 인코더 1,019KB).
// 행마다 5가지 필터 중 가장 압축이 잘 될 것을 고르고, 압축은 브라우저 내장
// CompressionStream(zlib)에 맡긴다 — JS 압축 라이브러리보다 작고 5배 빠르다.
// 복원 후 완전히 불투명해진 이미지는 RGB로 저장하고, 원본의 부가 청크
// (C2PA 출처 기록 caBX, 색 프로파일 등)는 그대로 옮겨 픽셀 외에는 원본과 같게 둔다.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export const canEncodePng = () => typeof CompressionStream !== 'undefined';

// 픽셀 값과 무관한 메타 청크만 옮긴다. 색 청크(iCCP·gAMA·cHRM·sRGB)와 eXIf는 옮기지 않는다 —
// 브라우저가 디코딩하면서 이미 sRGB 변환·회전을 적용했으므로, 옮기면 두 번 적용된다.
const PORTABLE = new Set(['caBX', 'pHYs', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

export async function readPortableChunks(blob) {
  if (!blob || blob.type !== 'image/png') return [];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) return [];
  const view = new DataView(bytes.buffer);
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset + 12 + length > bytes.length) break;
    if (PORTABLE.has(type)) chunks.push({ type, data: bytes.slice(offset + 8, offset + 8 + length) });
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return chunks;
}

// 행마다 5가지 필터를 한 번에 계산해 "부호 있는 바이트 절댓값 합"이 가장 작은 것을 고른다
function filterRows(pixels, width, height, bpp) {
  const rowBytes = width * bpp;
  const out = new Uint8Array(height * (rowBytes + 1));
  const rows = [new Uint8Array(rowBytes), new Uint8Array(rowBytes)];
  const trial = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
  for (let y = 0; y < height; y += 1) {
    const cur = rows[y & 1];
    const prev = rows[(y + 1) & 1];
    const src = y * width * 4;
    if (bpp === 4) {
      cur.set(pixels.subarray(src, src + rowBytes));
    } else {
      for (let x = 0, j = 0, o = src; x < width; x += 1, j += 3, o += 4) {
        cur[j] = pixels[o];
        cur[j + 1] = pixels[o + 1];
        cur[j + 2] = pixels[o + 2];
      }
    }
    if (y === 0) prev.fill(0);
    const [f0, f1, f2, f3, f4] = trial;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    for (let i = 0; i < rowBytes; i += 1) {
      const x = cur[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = p > a ? p - a : a - p;
      const pb = p > b ? p - b : b - p;
      const pc = p > c ? p - c : c - p;
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v1 = (x - a) & 255;
      const v2 = (x - b) & 255;
      const v3 = (x - ((a + b) >> 1)) & 255;
      const v4 = (x - pr) & 255;
      f0[i] = x;
      f1[i] = v1;
      f2[i] = v2;
      f3[i] = v3;
      f4[i] = v4;
      s0 += x < 128 ? x : 256 - x;
      s1 += v1 < 128 ? v1 : 256 - v1;
      s2 += v2 < 128 ? v2 : 256 - v2;
      s3 += v3 < 128 ? v3 : 256 - v3;
      s4 += v4 < 128 ? v4 : 256 - v4;
    }
    const sums = [s0, s1, s2, s3, s4];
    let bestType = 0;
    for (let k = 1; k < 5; k += 1) if (sums[k] < sums[bestType]) bestType = k;
    const base = y * (rowBytes + 1);
    out[base] = bestType;
    out.set(trial[bestType], base + 1);
  }
  return out;
}

async function zlibCompress(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(imageData, { chunks = [] } = {}) {
  const { width, height, data } = imageData;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // 비트 깊이
  header[9] = opaque ? 2 : 6; // 2 = RGB, 6 = RGBA
  const compressed = await zlibCompress(filterRows(data, width, height, opaque ? 3 : 4));
  return new Blob(
    [
      new Uint8Array(SIGNATURE),
      makeChunk('IHDR', header),
      ...chunks.map((c) => makeChunk(c.type, c.data)),
      makeChunk('IDAT', compressed),
      makeChunk('IEND', new Uint8Array(0)),
    ],
    { type: 'image/png' },
  );
}
