import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brush,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Eraser,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Image as ImageIcon,
  Images,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Undo2,
  UploadCloud,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import { DEFAULT_SETTINGS, detectWatermark, regionRect } from './lib/detect.js';
import { inpaintMask } from './lib/inpaint.js';
import { loadImage, canvasToBlob, slideToImageData } from './lib/image.js';
import { loadDemo, loadImages, loadPdf, loadPptx, kindLabel, formatBytes } from './lib/loaders.js';
import { savePdf, savePptx, saveZip } from './lib/savers.js';

const SETTINGS_KEY = 'cleanslide.settings.v2';
const HISTORY_LIMIT = 15;

function loadStoredSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (stored && typeof stored === 'object') return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    /* 무시 — 기본값 사용 */
  }
  return { ...DEFAULT_SETTINGS };
}

export default function App() {
  const [slides, setSlides] = useState([]);
  const [sourceName, setSourceName] = useState('');
  const [kind, setKind] = useState(null);
  const [pptxContext, setPptxContext] = useState();
  const [current, setCurrent] = useState(0);
  const [settings, setSettings] = useState(loadStoredSettings);
  const [view, setView] = useState('original');
  const [showMask, setShowMask] = useState(true);
  const [showLoupe, setShowLoupe] = useState(true);
  const [brushMode, setBrushMode] = useState('none');
  const [brushSize, setBrushSize] = useState(14);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const cursorRef = useRef(null);
  const loupeOrigRef = useRef(null);
  const loupeCleanRef = useRef(null);
  const paintingRef = useRef(false);
  const regionDragRef = useRef(null);
  const imageCacheRef = useRef(new Map());
  const historyRef = useRef(new Map());

  const currentSlide = slides[current];
  const cleanedCount = slides.filter((s) => s.cleanedBlob).length;
  const detectedCount = slides.filter((s) => s.mask).length;
  const failedCount = slides.filter((s) => s.cleanFailed).length;
  const totalBytes = useMemo(
    () => slides.reduce((sum, s) => sum + s.originalBlob.size, 0),
    [slides],
  );

  // [P1] 설정 localStorage 저장 (디바운스)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, 250);
    return () => clearTimeout(timer);
  }, [settings]);

  const getCachedImage = (url, blob) => {
    const cache = imageCacheRef.current;
    if (!cache.has(url)) {
      cache.set(url, loadImage(blob));
      if (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    return cache.get(url);
  };

  const updateSlide = (index, patch) => {
    setSlides((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const applyLoaded = (result) => {
    setSlides(result.slides);
    setSourceName(result.sourceName);
    setKind(result.kind);
    setPptxContext(result.pptxContext);
    setCurrent(0);
    setView('original');
    setShowMask(true);
    imageCacheRef.current.clear();
    historyRef.current.clear();
    setNotice(`${result.slides.length}장의 슬라이드를 불러왔습니다.`);
  };

  const handleFiles = async (files) => {
    if (!files.length || busy) return;
    setBusy('파일을 브라우저 안에서 읽는 중…');
    setError('');
    setNotice('');
    try {
      const first = files[0];
      const ext = first.name.split('.').pop()?.toLowerCase();
      let result;
      if (ext === 'pptx') result = await loadPptx(first);
      else if (ext === 'pdf') result = await loadPdf(first);
      else {
        const imageFiles = files.filter((f) => f.type.startsWith('image/'));
        if (!imageFiles.length) throw new Error('PPTX, PDF, PNG, JPG 파일을 선택해 주세요.');
        result = await loadImages(imageFiles);
      }
      applyLoaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일을 여는 중 오류가 발생했습니다.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  };

  const handleDemo = async () => {
    setBusy('데모를 만드는 중…');
    setError('');
    try {
      applyLoaded(await loadDemo());
    } finally {
      setBusy('');
    }
  };

  const slideImageData = async (slide) => {
    const img = await getCachedImage(slide.originalUrl, slide.originalBlob);
    return slideToImageData(slide, img).imageData;
  };

  const detectForSlide = async (slide) => detectWatermark(await slideImageData(slide), settings);

  const cleanSlide = async (slide, mask) => {
    const img = await getCachedImage(slide.originalUrl, slide.originalBlob);
    const { canvas, ctx, imageData } = slideToImageData(slide, img);
    ctx.putImageData(inpaintMask(imageData, mask, settings.searchRadius), 0, 0);
    const mime = slide.sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, 0.96);
    return { blob, url: URL.createObjectURL(blob) };
  };

  const detectCurrent = async () => {
    if (!currentSlide || busy) return;
    setBusy('워터마크 모양을 읽는 중…');
    setError('');
    try {
      const result = await detectForSlide(currentSlide);
      updateSlide(current, {
        mask: result.mask,
        maskPixelCount: result.pixelCount,
        detectMode: result.mode,
        cleanedBlob: undefined,
        cleanedUrl: undefined,
        cleanFailed: !result.pixelCount,
      });
      setView('original');
      setShowMask(true);
      setNotice(
        result.pixelCount
          ? `${result.pixelCount.toLocaleString()}개 픽셀을 워터마크 후보로 찾았습니다.${
              result.mode === 'lenient' ? ' (완화 기준으로 감지)' : ''
            }`
          : '',
      );
      if (!result.pixelCount) {
        setError('감지된 픽셀이 없습니다. 민감도를 낮추거나 밝기 유형을 바꿔 보세요.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '워터마크 감지에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const restoreCurrent = async () => {
    if (!currentSlide || busy) return;
    setBusy('주변 질감으로 복원하는 중…');
    setError('');
    try {
      const detection =
        currentSlide.mask && (currentSlide.maskPixelCount ?? 0) > 0
          ? {
              mask: currentSlide.mask,
              pixelCount: currentSlide.maskPixelCount ?? 0,
              mode: currentSlide.detectMode,
            }
          : await detectForSlide(currentSlide);

      // [P0-1] 감지 0px이면 성공 처리하지 않는다
      if (!detection.pixelCount) {
        updateSlide(current, {
          mask: detection.mask,
          maskPixelCount: 0,
          detectMode: detection.mode,
          cleanedBlob: undefined,
          cleanedUrl: undefined,
          cleanFailed: true,
        });
        setView('original');
        setShowMask(true);
        setError(
          '감지된 픽셀이 없어 복원할 내용이 없습니다. 민감도를 낮추거나(더 많이 감지), 브러시로 직접 칠한 뒤 다시 복원해 주세요.',
        );
        return;
      }

      const cleaned = await cleanSlide(currentSlide, detection.mask);
      updateSlide(current, {
        mask: detection.mask,
        maskPixelCount: detection.pixelCount,
        detectMode: detection.mode,
        cleanedBlob: cleaned.blob,
        cleanedUrl: cleaned.url,
        cleanFailed: false,
      });
      setView('cleaned');
      setNotice('현재 슬라이드를 복원했습니다. 원본과 비교해 보세요.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '슬라이드 복원에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const restoreAll = async () => {
    if (!slides.length || busy) return;
    setBusy('전체 슬라이드를 정리하는 중…');
    setError('');
    setProgress(0);
    try {
      const next = [...slides];
      let done = 0;
      let skipped = 0;
      for (let i = 0; i < next.length; i += 1) {
        const slide = next[i];
        const detection =
          slide.mask && (slide.maskPixelCount ?? 0) > 0
            ? { mask: slide.mask, pixelCount: slide.maskPixelCount ?? 0, mode: slide.detectMode }
            : await detectForSlide(slide);

        if (!detection.pixelCount) {
          // [P0-1] 감지 실패한 장은 건너뛰고 ⚠ 표시
          skipped += 1;
          next[i] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: 0,
            detectMode: detection.mode,
            cleanedBlob: undefined,
            cleanedUrl: undefined,
            cleanFailed: true,
          };
        } else {
          const cleaned = await cleanSlide(slide, detection.mask);
          done += 1;
          next[i] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: detection.pixelCount,
            detectMode: detection.mode,
            cleanedBlob: cleaned.blob,
            cleanedUrl: cleaned.url,
            cleanFailed: false,
          };
        }
        setSlides([...next]);
        setProgress(((i + 1) / next.length) * 100);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (done && !skipped) {
        setView('cleaned');
        setNotice(`${done}장 전체를 정리했습니다. 결과를 내려받을 수 있습니다.`);
      } else if (done && skipped) {
        setView('cleaned');
        setNotice(
          `${done}장 복원 완료 · ${skipped}장은 감지된 워터마크가 없어 건너뛰었습니다(썸네일 ⚠). 해당 장은 브러시로 칠한 뒤 다시 복원해 주세요.`,
        );
      } else {
        setError(
          '감지된 워터마크가 없습니다. 민감도를 낮추거나(더 많이 감지) 밝기 유형을 바꿔 보세요.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '전체 처리 중 오류가 발생했습니다.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  };

  const resetCurrent = () => {
    if (!currentSlide) return;
    historyRef.current.delete(currentSlide.id);
    updateSlide(current, {
      mask: undefined,
      maskPixelCount: undefined,
      detectMode: undefined,
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setNotice('현재 장의 감지 결과를 초기화했습니다.');
  };

  const exportAs = async (target) => {
    if (!slides.length || busy) return;
    setBusy('결과 파일을 만드는 중…');
    setError('');
    try {
      if (target === 'pptx') {
        if (!pptxContext) throw new Error('PPTX 원본을 불러온 경우에만 PPTX로 저장할 수 있습니다.');
        await savePptx(pptxContext, slides);
      } else if (target === 'pdf') {
        await savePdf(sourceName, slides);
      } else {
        await saveZip(sourceName, slides);
      }
      setNotice('정리된 결과 파일을 저장했습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과 파일 생성에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  // ── 마스크 브러시 ──────────────────────────────────────────────

  const pushHistory = (slide) => {
    const stack = historyRef.current.get(slide.id) ?? [];
    stack.push(slide.mask ? slide.mask.slice() : null);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    historyRef.current.set(slide.id, stack);
  };

  const undoMask = () => {
    if (!currentSlide) return;
    const stack = historyRef.current.get(currentSlide.id);
    if (!stack?.length) return;
    const prev = stack.pop();
    let count = 0;
    if (prev) for (const v of prev) count += v;
    updateSlide(current, {
      mask: prev ?? undefined,
      maskPixelCount: prev ? count : undefined,
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setShowMask(true);
    setNotice('마스크를 한 단계 되돌렸습니다.');
  };

  const canUndo = !!historyRef.current.get(currentSlide?.id)?.length;

  // [P1] Ctrl/Cmd+Z 실행취소
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      undoMask();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const paintAt = (event) => {
    if (!currentSlide || brushMode === 'none' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = Math.round(((event.clientX - rect.left) / rect.width) * canvas.width);
    const cy = Math.round(((event.clientY - rect.top) / rect.height) * canvas.height);
    const radius = Math.max(2, Math.round((brushSize / rect.width) * canvas.width));
    const mask = currentSlide.mask?.slice() ?? new Uint8Array(canvas.width * canvas.height);
    for (let y = Math.max(0, cy - radius); y <= Math.min(canvas.height - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(canvas.width - 1, cx + radius); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
          mask[y * canvas.width + x] = brushMode === 'add' ? 1 : 0;
        }
      }
    }
    let count = 0;
    for (const v of mask) count += v;
    updateSlide(current, {
      mask,
      maskPixelCount: count,
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setShowMask(true);
  };

  // ── [P1] 감지 영역 드래그/리사이즈 ─────────────────────────────

  const canvasFraction = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      fx: (event.clientX - rect.left) / rect.width,
      fy: (event.clientY - rect.top) / rect.height,
      rect,
    };
  };

  const hitTestRegion = (fx, fy, rect) => {
    const left = 1 - settings.rightMargin - settings.regionWidth;
    const top = 1 - settings.bottomMargin - settings.regionHeight;
    const right = 1 - settings.rightMargin;
    const bottom = 1 - settings.bottomMargin;
    const tolX = 12 / rect.width;
    const tolY = 12 / rect.height;
    if (Math.abs(fx - left) < tolX && Math.abs(fy - top) < tolY) return 'resize';
    if (fx >= left - tolX && fx <= right + tolX && fy >= top - tolY && fy <= bottom + tolY) {
      return 'move';
    }
    return null;
  };

  const applyRegionDrag = (fx, fy) => {
    const drag = regionDragRef.current;
    if (!drag) return;
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    if (drag.mode === 'move') {
      setSettings((prev) => ({
        ...prev,
        rightMargin: clamp(drag.start.rightMargin - (fx - drag.startFx), 0, 1 - prev.regionWidth),
        bottomMargin: clamp(
          drag.start.bottomMargin - (fy - drag.startFy),
          0,
          1 - prev.regionHeight,
        ),
      }));
    } else {
      setSettings((prev) => ({
        ...prev,
        regionWidth: clamp(1 - prev.rightMargin - fx, 0.02, 0.5),
        regionHeight: clamp(1 - prev.bottomMargin - fy, 0.01, 0.4),
      }));
    }
  };

  const moveBrushCursor = (event) => {
    const cursor = cursorRef.current;
    const stage = stageRef.current;
    if (!cursor || !stage) return;
    const rect = stage.getBoundingClientRect();
    cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`;
  };

  const onCanvasPointerDown = (event) => {
    if (!currentSlide) return;
    if (brushMode !== 'none') {
      pushHistory(currentSlide);
      paintingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* 합성 이벤트 등 pointerId가 없을 때 무시 */
      }
      paintAt(event);
      return;
    }
    if (view === 'original' && showMask) {
      const { fx, fy, rect } = canvasFraction(event);
      const hit = hitTestRegion(fx, fy, rect);
      if (hit) {
        regionDragRef.current = { mode: hit, startFx: fx, startFy: fy, start: { ...settings } };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 무시 */
        }
      }
    }
  };

  const onCanvasPointerMove = (event) => {
    if (brushMode !== 'none') moveBrushCursor(event);
    if (paintingRef.current) {
      paintAt(event);
      return;
    }
    if (regionDragRef.current) {
      const { fx, fy } = canvasFraction(event);
      applyRegionDrag(fx, fy);
      return;
    }
    // 커서 힌트
    if (brushMode === 'none' && view === 'original' && showMask && canvasRef.current) {
      const { fx, fy, rect } = canvasFraction(event);
      const hit = hitTestRegion(fx, fy, rect);
      canvasRef.current.style.cursor =
        hit === 'resize' ? 'nwse-resize' : hit === 'move' ? 'move' : '';
    }
  };

  const onCanvasPointerUp = () => {
    paintingRef.current = false;
    regionDragRef.current = null;
  };

  // ── 캔버스 + 루페 렌더링 ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas || !currentSlide) return;
      const useCleaned = view === 'cleaned' && currentSlide.cleanedBlob;
      const blob = useCleaned ? currentSlide.cleanedBlob : currentSlide.originalBlob;
      const url = useCleaned ? currentSlide.cleanedUrl : currentSlide.originalUrl;
      const img = await getCachedImage(url, blob);
      if (cancelled) return;

      canvas.width = currentSlide.width;
      canvas.height = currentSlide.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (view === 'original' && showMask) {
        if (currentSlide.mask) {
          const tinted = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < currentSlide.mask.length; i += 1) {
            if (!currentSlide.mask[i]) continue;
            const o = i * 4;
            tinted.data[o] = tinted.data[o] * 0.38 + 149 * 0.62;
            tinted.data[o + 1] = tinted.data[o + 1] * 0.38 + 92 * 0.62;
            tinted.data[o + 2] = tinted.data[o + 2] * 0.38 + 246 * 0.62;
          }
          ctx.putImageData(tinted, 0, 0);
        }
        // 감지 영역 박스 + 리사이즈 핸들
        const rx = canvas.width * (1 - settings.rightMargin - settings.regionWidth);
        const ry = canvas.height * (1 - settings.bottomMargin - settings.regionHeight);
        const rw = canvas.width * settings.regionWidth;
        const rh = canvas.height * settings.regionHeight;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = Math.max(1.5, canvas.width / 700);
        ctx.setLineDash([canvas.width / 180, canvas.width / 260]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        const handleSize = Math.max(8, canvas.width / 90);
        ctx.fillStyle = '#6f55d9';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, canvas.width / 900);
        ctx.fillRect(rx - handleSize / 2, ry - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(rx - handleSize / 2, ry - handleSize / 2, handleSize, handleSize);
        ctx.restore();
      }

      // [P1] 루페 — 우하단 영역 확대 (원본/복원 비교)
      if (showLoupe) {
        const region = regionRect(currentSlide.width, currentSlide.height, settings);
        const padX = Math.round((region.x1 - region.x0) * 0.3);
        const padY = Math.round((region.y1 - region.y0) * 0.8);
        const cropX = Math.max(0, region.x0 - padX);
        const cropY = Math.max(0, region.y0 - padY);
        const cropW = Math.min(currentSlide.width, region.x1 + padX + 1) - cropX;
        const cropH = Math.min(currentSlide.height, region.y1 + padY + 1) - cropY;
        const drawLoupe = async (target, sourceUrl, sourceBlob) => {
          if (!target) return;
          const source = await getCachedImage(sourceUrl, sourceBlob);
          if (cancelled) return;
          const zoomWidth = 480;
          target.width = zoomWidth;
          target.height = Math.max(1, Math.round((zoomWidth * cropH) / cropW));
          const tctx = target.getContext('2d');
          tctx.imageSmoothingEnabled = false;
          tctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, target.width, target.height);
        };
        await drawLoupe(loupeOrigRef.current, currentSlide.originalUrl, currentSlide.originalBlob);
        if (currentSlide.cleanedBlob) {
          await drawLoupe(loupeCleanRef.current, currentSlide.cleanedUrl, currentSlide.cleanedBlob);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSlide, view, showMask, showLoupe, settings]);

  // ── 렌더 ──────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={21} />
          </div>
          <div>
            <h1>클린슬라이드</h1>
            <p>워터마크 모양만 읽어 주변 질감으로 복원</p>
          </div>
        </div>
        <div className="privacy-pill">
          <ShieldCheck size={16} /> 파일은 이 브라우저 안에서만 처리돼요
        </div>
      </header>

      <main className="layout">
        <aside className="control-panel">
          <section className="panel-section upload-section">
            <div className="section-heading">
              <span className="step-badge">1</span>
              <div>
                <h2>슬라이드 불러오기</h2>
                <p>PPTX · PDF · PNG · JPG</p>
              </div>
            </div>
            <button
              className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <UploadCloud size={27} />
              <strong>파일을 놓거나 선택하세요</strong>
              <span>NotebookLM PPTX는 슬라이드 이미지를 직접 읽습니다</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".pptx,.pdf,.png,.jpg,.jpeg,.webp,image/*"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            {!slides.length && (
              <button className="text-button" onClick={() => void handleDemo()}>
                <Eye size={15} /> 데모 슬라이드로 먼저 보기
              </button>
            )}
            {slides.length > 0 && (
              <div className="file-card">
                <div className="file-icon">{kind === 'pptx' ? <FileText /> : <ImageIcon />}</div>
                <div className="file-info">
                  <strong>{sourceName}</strong>
                  <span>
                    {kindLabel(kind)} · {slides.length}장 · {formatBytes(totalBytes)}
                  </span>
                </div>
                <CheckCircle2 className="file-check" size={17} />
              </div>
            )}
          </section>

          <section className={`panel-section ${slides.length ? '' : 'is-disabled'}`}>
            <div className="section-heading">
              <span className="step-badge">2</span>
              <div>
                <h2>모양 감지 조절</h2>
                <p>샘플 PPTX에 맞춘 기본값</p>
              </div>
              <button
                className="text-button compact"
                onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
                title="감지 설정을 기본값으로 되돌립니다"
              >
                <RotateCcw size={12} /> 기본값
              </button>
            </div>
            <label className="field-label">워터마크 밝기</label>
            <div className="segmented three">
              {['bright', 'dark', 'both'].map((polarity) => (
                <button
                  key={polarity}
                  className={settings.polarity === polarity ? 'active' : ''}
                  onClick={() => setSettings((prev) => ({ ...prev, polarity }))}
                >
                  {polarity === 'bright' ? '밝음' : polarity === 'dark' ? '어두움' : '둘 다'}
                </button>
              ))}
            </div>
            <label className="range-label">
              <span>감지 민감도</span>
              <output>{settings.sensitivity}</output>
            </label>
            <input
              className="range"
              type="range"
              min="8"
              max="34"
              value={settings.sensitivity}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, sensitivity: Number(e.target.value) }))
              }
            />
            <div className="range-hint">
              <span>더 많이 감지</span>
              <span>더 선별</span>
            </div>
            <label className="range-label">
              <span>마스크 여유</span>
              <output>{settings.expansion}px</output>
            </label>
            <input
              className="range"
              type="range"
              min="0"
              max="4"
              value={settings.expansion}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, expansion: Number(e.target.value) }))
              }
            />
            <details className="advanced">
              <summary>감지 영역 세밀 조절</summary>
              <p className="hint-line">화면의 점선 박스를 드래그해 옮기고, 좌상단 핸들로 크기를 바꿀 수도 있어요.</p>
              <label className="range-label">
                <span>가로 영역</span>
                <output>{Math.round(settings.regionWidth * 100)}%</output>
              </label>
              <input
                className="range"
                type="range"
                min="7"
                max="22"
                value={Math.round(settings.regionWidth * 100)}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, regionWidth: Number(e.target.value) / 100 }))
                }
              />
              <label className="range-label">
                <span>세로 영역</span>
                <output>{Math.round(settings.regionHeight * 100)}%</output>
              </label>
              <input
                className="range"
                type="range"
                min="3"
                max="14"
                value={Math.round(settings.regionHeight * 100)}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, regionHeight: Number(e.target.value) / 100 }))
                }
              />
            </details>
            <div className="action-grid">
              <button
                className="secondary-action"
                onClick={() => void detectCurrent()}
                disabled={!slides.length || !!busy}
              >
                <Eye size={17} /> 현재 장 감지
              </button>
              <button
                className="primary-action"
                onClick={() => void restoreCurrent()}
                disabled={!slides.length || !!busy}
              >
                <Wand2 size={17} /> 현재 장 복원
              </button>
            </div>
            <button
              className="primary-action full"
              onClick={() => void restoreAll()}
              disabled={!slides.length || !!busy}
            >
              <Sparkles size={17} /> 전체 {slides.length || 0}장 자동 정리
            </button>
          </section>

          <section className={`panel-section ${slides.length ? '' : 'is-disabled'}`}>
            <div className="section-heading compact">
              <span className="step-badge">3</span>
              <div>
                <h2>결과 저장</h2>
                <p>
                  {cleanedCount}/{slides.length}장 복원 완료
                  {failedCount > 0 && (
                    <span className="warn-inline"> · ⚠ {failedCount}장 감지 없음</span>
                  )}
                </p>
              </div>
            </div>
            <div className="export-grid">
              {kind === 'pptx' && (
                <button onClick={() => void exportAs('pptx')} disabled={!cleanedCount || !!busy}>
                  <FileText size={17} />
                  <span>PPTX</span>
                </button>
              )}
              <button onClick={() => void exportAs('pdf')} disabled={!cleanedCount || !!busy}>
                <FileDown size={17} />
                <span>PDF</span>
              </button>
              <button onClick={() => void exportAs('images')} disabled={!cleanedCount || !!busy}>
                <Images size={17} />
                <span>PNG 묶음</span>
              </button>
            </div>
          </section>
        </aside>

        <section className="workspace">
          {busy && (
            <div className="busy-banner">
              <Loader2 className="spin" size={18} />
              <span>{busy}</span>
              {progress > 0 && (
                <div className="progress-track">
                  <i style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}
          {(error || notice) && (
            <div className={`message ${error ? 'error' : 'success'}`}>{error || notice}</div>
          )}
          {slides.length ? (
            <>
              <div className="workspace-toolbar">
                <div className="page-nav">
                  <button
                    onClick={() => setCurrent((i) => Math.max(0, i - 1))}
                    disabled={current === 0}
                  >
                    <ChevronLeft />
                  </button>
                  <strong>{current + 1}</strong>
                  <span>/ {slides.length}</span>
                  <button
                    onClick={() => setCurrent((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={current === slides.length - 1}
                  >
                    <ChevronRight />
                  </button>
                </div>
                <div className="view-controls">
                  <div className="segmented">
                    <button
                      className={view === 'original' ? 'active' : ''}
                      onClick={() => setView('original')}
                    >
                      원본
                    </button>
                    <button
                      className={view === 'cleaned' ? 'active' : ''}
                      onClick={() => setView('cleaned')}
                      disabled={!currentSlide?.cleanedBlob}
                    >
                      복원 결과
                    </button>
                  </div>
                  <button
                    className={`icon-text-button ${showMask ? 'active' : ''}`}
                    onClick={() => setShowMask((v) => !v)}
                    disabled={view === 'cleaned'}
                  >
                    {showMask ? <Eye size={16} /> : <EyeOff size={16} />} 마스크
                  </button>
                  <button
                    className={`icon-text-button ${showLoupe ? 'active' : ''}`}
                    onClick={() => setShowLoupe((v) => !v)}
                  >
                    <ZoomIn size={16} /> 돋보기
                  </button>
                </div>
              </div>
              <div className="canvas-wrap">
                <div className="canvas-stage" ref={stageRef}>
                  <canvas
                    ref={canvasRef}
                    className={brushMode !== 'none' ? 'brush-active' : ''}
                    onPointerDown={onCanvasPointerDown}
                    onPointerMove={onCanvasPointerMove}
                    onPointerUp={onCanvasPointerUp}
                    onPointerCancel={onCanvasPointerUp}
                  />
                  {brushMode !== 'none' && (
                    <div
                      ref={cursorRef}
                      className="brush-cursor"
                      style={{ width: brushSize * 2, height: brushSize * 2 }}
                    />
                  )}
                  {showLoupe && currentSlide && (
                    <div className="loupe">
                      <div className="loupe-title">우하단 확대</div>
                      <div className="loupe-row">
                        <span>원본</span>
                        <canvas ref={loupeOrigRef} />
                      </div>
                      {currentSlide.cleanedBlob && (
                        <div className="loupe-row">
                          <span>복원</span>
                          <canvas ref={loupeCleanRef} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="brush-toolbar">
                  <span>마스크 직접 보정</span>
                  <button
                    className={brushMode === 'add' ? 'active' : ''}
                    onClick={() => setBrushMode((m) => (m === 'add' ? 'none' : 'add'))}
                  >
                    <Brush size={16} /> 더 칠하기
                  </button>
                  <button
                    className={brushMode === 'erase' ? 'active' : ''}
                    onClick={() => setBrushMode((m) => (m === 'erase' ? 'none' : 'erase'))}
                  >
                    <Eraser size={16} /> 지우기
                  </button>
                  <label>
                    크기{' '}
                    <input
                      type="range"
                      min="5"
                      max="34"
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                    />
                  </label>
                  <button onClick={undoMask} disabled={!canUndo} title="Ctrl/Cmd+Z">
                    <Undo2 size={16} /> 실행취소
                  </button>
                  <button onClick={resetCurrent}>
                    <RotateCcw size={16} /> 초기화
                  </button>
                </div>
              </div>
              <div className="thumbnail-strip">
                {slides.map((slide, i) => (
                  <button
                    key={slide.id}
                    className={current === i ? 'selected' : ''}
                    onClick={() => setCurrent(i)}
                  >
                    <div className="thumb-image">
                      <img src={slide.cleanedUrl ?? slide.originalUrl} alt={`${i + 1}번 슬라이드`} />
                      {slide.cleanedBlob && (
                        <i>
                          <CheckCircle2 size={11} />
                        </i>
                      )}
                      {slide.cleanFailed && (
                        <i className="warn">
                          <AlertTriangle size={10} />
                        </i>
                      )}
                    </div>
                    <span>{i + 1}</span>
                  </button>
                ))}
              </div>
              <div className="status-line">
                <span>
                  <i className="status-dot detected" /> 감지 {detectedCount}장
                </span>
                <span>
                  <i className="status-dot cleaned" /> 복원 {cleanedCount}장
                </span>
                {failedCount > 0 && (
                  <span>
                    <i className="status-dot warn" /> 감지 없음 {failedCount}장
                  </span>
                )}
                {currentSlide?.maskPixelCount !== undefined && (
                  <span>현재 장 마스크 {currentSlide.maskPixelCount.toLocaleString()}px</span>
                )}
              </div>
            </>
          ) : (
            <div className="empty-workspace">
              <div className="empty-visual">
                <div className="fake-slide">
                  <span>SLIDE</span>
                  <i>◉ NotebookLM</i>
                </div>
                <div className="wand-dot dot-one" />
                <div className="wand-dot dot-two" />
                <div className="wand-dot dot-three" />
              </div>
              <h2>슬라이드를 올리면 바로 시작합니다</h2>
              <p>
                우측 하단의 작은 워터마크 픽셀을 찾고,
                <br />그 주변의 색·결·명암을 참고해 빈자리를 채웁니다.
              </p>
              <div className="feature-row">
                <span>
                  <CloudOff size={15} /> 업로드 없음
                </span>
                <span>
                  <Eye size={15} /> 마스크 미리보기
                </span>
                <span>
                  <Brush size={15} /> 수동 보정
                </span>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>로컬 처리 · 원본은 변경되지 않음</span>
        <span>생성물의 이용 권한과 표시 의무는 사용자가 확인해 주세요.</span>
      </footer>
    </div>
  );
}
