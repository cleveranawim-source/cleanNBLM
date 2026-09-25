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
    pptxContext.zip.file(slide.sourcePath, await slide.cleanedBlob.arrayBuffer());
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
  const { PDFDocument } = await getPdfLib();
  const doc = await PDFDocument.create();
  for (const slide of slides) {
    const blob = slide.cleanedBlob ?? slide.originalBlob;
    const image = await embedImage(doc, blob);
    const pageWidth = slide.pdfPageSize?.width ?? 960;
    const pageHeight = slide.pdfPageSize?.height ?? pageWidth * (slide.height / slide.width);
    doc.addPage([pageWidth, pageHeight]).drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
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
