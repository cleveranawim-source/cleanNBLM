import JSZip from 'jszip';
import { canvasToBlob, loadImage } from './image.js';

// pdf-lib는 PDF 저장 때만 필요하므로 첫 로딩 번들에서 분리
let pdfLibPromise = null;
const getPdfLib = () => {
  pdfLibPromise ??= import('pdf-lib');
  return pdfLibPromise;
};

async function reencodePng(blob) {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

// pdf-lib는 PNG·JPEG만 넣을 수 있다 — WebP 등은 PNG로 바꿔서 넣는다
async function embedImage(doc, blob) {
  try {
    if (blob.type === 'image/jpeg') return await doc.embedJpg(await blob.arrayBuffer());
    if (blob.type === 'image/png') return await doc.embedPng(await blob.arrayBuffer());
  } catch {
    /* 확장자와 실제 형식이 다른 경우 — 아래에서 PNG로 변환 */
  }
  return doc.embedPng(await (await reencodePng(blob)).arrayBuffer());
}

// 8비트·비인터레이스 RGB PNG(자체 인코더 출력)는 IDAT 압축 데이터를 그대로 PDF 이미지로 넣는다.
// PDF의 FlateDecode + PNG 예측자(Predictor 15)가 PNG와 같은 방식이라 재압축이 필요 없다.
// pdf-lib의 embedPng는 픽셀을 풀었다가 예측자 없이 다시 압축해 ~35% 커진다.
async function embedPngRaw(doc, blob) {
  if (blob.type !== 'image/png') return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.colorType !== 2 || header.interlace !== 0) return null;
  const data = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  for (const part of idat) {
    data.set(part, pos);
    pos += part.length;
  }
  const stream = doc.context.stream(data, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: header.width,
    Height: header.height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
    DecodeParms: { Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: header.width },
  });
  return doc.context.register(stream);
}

function extFor(blob) {
  if (blob.type === 'image/jpeg') return 'jpg';
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/gif') return 'gif';
  return 'png';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function outputName(sourceName, ext) {
  return `${sourceName.replace(/\.[^.]+$/, '')}_clean.${ext}`;
}

// PPTX: 원본 zip 구조를 그대로 두고 슬라이드 이미지 파트만 교체
export async function savePptx(pptxContext, slides) {
  for (const slide of slides) {
    if (!slide.sourcePath || !slide.cleanedBlob) continue;
    // createFolders:false — 원본에 없는 폴더 항목(ppt/, ppt/media/)을 끼워 넣지 않는다
    pptxContext.zip.file(slide.sourcePath, await slide.cleanedBlob.arrayBuffer(), {
      createFolders: false,
    });
  }
  const blob = await pptxContext.zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  triggerDownload(blob, outputName(pptxContext.sourceName, 'pptx'));
}

// PDF: [P1] 원본 페이지 크기(pt)를 알면 그대로 사용, 아니면 960pt 폭
export async function savePdf(sourceName, slides) {
  const {
    PDFDocument,
    pushGraphicsState,
    popGraphicsState,
    concatTransformationMatrix,
    drawObject,
  } = await getPdfLib();
  const doc = await PDFDocument.create();
  for (const slide of slides) {
    const blob = slide.cleanedBlob ?? slide.originalBlob;
    const pageWidth = slide.pdfPageSize?.width ?? 960;
    const pageHeight = slide.pdfPageSize?.height ?? pageWidth * (slide.height / slide.width);
    const page = doc.addPage([pageWidth, pageHeight]);
    const rawRef = await embedPngRaw(doc, blob);
    if (rawRef) {
      const name = page.node.newXObject('Im', rawRef);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(pageWidth, 0, 0, pageHeight, 0, 0),
        drawObject(name),
        popGraphicsState(),
      );
    } else {
      page.drawImage(await embedImage(doc, blob), {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }
  }
  const bytes = await doc.save();
  triggerDownload(
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    outputName(sourceName, 'pdf'),
  );
}

export async function saveZip(sourceName, slides) {
  const zip = new JSZip();
  slides.forEach((slide, i) => {
    const blob = slide.cleanedBlob ?? slide.originalBlob;
    zip.file(`slide-${String(i + 1).padStart(2, '0')}.${extFor(blob)}`, blob);
  });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, outputName(sourceName, 'zip'));
}
