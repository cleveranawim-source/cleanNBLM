import JSZip from 'jszip';
import { buildSlide, canvasToBlob, mimeFromName } from './image.js';
import { t } from './i18n.js';

// pdf.js(약 400KB)는 PDF를 열 때만 필요하므로 첫 로딩 번들에서 분리
let pdfjsPromise = null;
function getPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

// PPTX 내부 상대 경로 해석 (slides/../media/image1.png → ppt/media/image1.png)
function resolveZipPath(basePath, target) {
  const parts = basePath.split('/');
  parts.pop();
  for (const seg of target.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

// NotebookLM PPTX: 각 슬라이드의 가장 큰 이미지(=전체 슬라이드 이미지)를 추출
export async function loadPptx(file) {
  const zip = await JSZip.loadAsync(file);
  const slideXmls = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return na - nb;
    });
  if (!slideXmls.length) throw new Error(t().errNoSlidesInPptx);

  const slides = [];
  for (let i = 0; i < slideXmls.length; i += 1) {
    const slidePath = slideXmls[i];
    const relsPath = `ppt/slides/_rels/${slidePath.split('/').pop()}.rels`;
    const relsFile = zip.file(relsPath);
    if (!relsFile) throw new Error(t().errNoRels(i + 1));
    const relsXml = await relsFile.async('text');
    const doc = new DOMParser().parseFromString(relsXml, 'application/xml');
    const imagePaths = Array.from(doc.getElementsByTagName('Relationship'))
      .filter((rel) => rel.getAttribute('Type')?.endsWith('/image'))
      .map((rel) => resolveZipPath(slidePath, rel.getAttribute('Target') ?? ''))
      .filter((p) => zip.file(p));
    if (!imagePaths.length) {
      throw new Error(t().errNotImagePptx(i + 1));
    }
    const images = await Promise.all(
      imagePaths.map(async (path) => ({ path, blob: await zip.file(path).async('blob') })),
    );
    images.sort((a, b) => b.blob.size - a.blob.size);
    const biggest = images[0];
    const ext = biggest.path.split('.').pop()?.toLowerCase() ?? 'png';
    const typedBlob = new Blob([await biggest.blob.arrayBuffer()], {
      type: mimeFromName(`slide.${ext}`),
    });
    slides.push(
      await buildSlide(typedBlob, t().slideName(String(i + 1).padStart(2, '0')), biggest.path),
    );
  }
  return { slides, kind: 'pptx', sourceName: file.name, pptxContext: { zip, sourceName: file.name } };
}

export async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const slides = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error(t().errPdfRender);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas);
    slides.push(
      await buildSlide(blob, t().pageName(String(n).padStart(2, '0')), undefined, {
        // [P1] PDF 저장 시 원본 페이지 크기(pt)를 유지하기 위해 기록
        pdfPageSize: { width: base.width, height: base.height },
      }),
    );
  }
  return { slides, kind: 'pdf', sourceName: file.name };
}

export async function loadImages(files) {
  return {
    slides: await Promise.all(files.map((f, i) => buildSlide(f, f.name || t().imageName(i + 1)))),
    kind: 'images',
    sourceName: files.length === 1 ? files[0].name : t().imagesName(files.length),
  };
}

// 데모용 "Gemini Notebook" 워터마크: 돔 아이콘(아래쪽 아치 3개) + 글자, 오른쪽 끝 정렬
function drawDemoWatermark(ctx, right, baseline, color) {
  const fs = 15;
  ctx.font = `500 ${fs}px system-ui, sans-serif`;
  const label = 'Gemini Notebook';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(label, right - tw, baseline);
  const iw = fs * 1.15;
  const ih = fs * 0.72;
  // 아치 구멍이 슬라이드 배경까지 뚫지 않도록 별도 캔버스에서 만든 뒤 합성
  const icon = document.createElement('canvas');
  icon.width = Math.ceil(iw) + 4;
  icon.height = Math.ceil(ih) + 4;
  const ic = icon.getContext('2d');
  const base = ih + 2;
  ic.fillStyle = color;
  ic.beginPath();
  ic.ellipse(icon.width / 2, base, iw / 2, ih, 0, Math.PI, 0);
  ic.closePath();
  ic.fill();
  ic.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k += 1) {
    ic.beginPath();
    ic.ellipse(2 + iw * (0.22 + k * 0.28), base, iw * 0.08, ih * 0.38, 0, Math.PI, 0);
    ic.fill();
  }
  ctx.drawImage(icon, right - tw - fs * 0.35 - iw - 2, baseline - base);
}

export async function loadDemo() {
  const canvas = document.createElement('canvas');
  canvas.width = 1390;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#e6b98a');
  gradient.addColorStop(0.55, '#8e5a42');
  gradient.addColorStop(1, '#3e2925');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.18;
  for (let y = 20; y < canvas.height; y += 18) {
    ctx.strokeStyle = y % 36 ? '#fff3dd' : '#25110d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(350, y - 8, 940, y + 10, canvas.width, y - 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff8ed';
  ctx.font = '700 68px system-ui, sans-serif';
  ctx.fillText(t().demoHeadline, 100, 220);
  ctx.fillStyle = '#f4dcc2';
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillText(t().demoSubline, 105, 280);
  drawDemoWatermark(ctx, canvas.width - 12, canvas.height - 13, 'rgba(255,255,255,.95)');
  const blob = await canvasToBlob(canvas);
  return {
    slides: [await buildSlide(blob, t().demoName)],
    kind: 'demo',
    sourceName: t().demoName,
  };
}

export function kindLabel(kind) {
  if (kind === 'pptx') return t().kindPptx;
  if (kind === 'pdf') return t().kindPdf;
  if (kind === 'images') return t().kindImages;
  if (kind === 'demo') return t().kindDemo;
  return '';
}

export function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
