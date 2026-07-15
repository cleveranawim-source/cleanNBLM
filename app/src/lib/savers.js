import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

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

function outputName(sourceName, ext) {
  return `${sourceName.replace(/\.[^.]+$/, '')}_워터마크정리.${ext}`;
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
  const doc = await PDFDocument.create();
  for (const slide of slides) {
    const blob = slide.cleanedBlob ?? slide.originalBlob;
    const bytes = await blob.arrayBuffer();
    const image =
      blob.type === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
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
    const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
    zip.file(`slide-${String(i + 1).padStart(2, '0')}.${ext}`, blob);
  });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, outputName(sourceName, 'zip'));
}
