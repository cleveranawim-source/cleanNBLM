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
  HelpCircle,
  Image as ImageIcon,
  Images,
  Languages,
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
import { cleanImage } from './lib/pipeline.js';
import { loadImage, canvasToBlob, slideToImageData } from './lib/image.js';
import { loadDemo, loadImages, loadPdf, loadPptx, kindLabel, formatBytes } from './lib/loaders.js';
import { savePdf, savePptx, saveZip, outputName } from './lib/savers.js';
import { STRINGS, detectLang, setActiveLang } from './lib/i18n.js';

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

function naturalExt(kind) {
  return kind === 'pptx' ? 'pptx' : kind === 'pdf' ? 'pdf' : 'zip';
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [current, setCurrent] = useState(0);
  const [settings, setSettings] = useState(loadStoredSettings);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [view, setView] = useState('original'); // original | compare | cleaned
  const [divider, setDivider] = useState(0.5);
  const [showMask, setShowMask] = useState(true);
  const [showLoupe, setShowLoupe] = useState(true);
  const [brushMode, setBrushMode] = useState('none');
  const [brushSize, setBrushSize] = useState(14);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [lang, setLang] = useState(detectLang);
  const [helpOpen, setHelpOpen] = useState(false);
  const T = STRINGS[lang];

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const workspaceRef = useRef(null);
  const cursorRef = useRef(null);
  const loupeOrigRef = useRef(null);
  const loupeCleanRef = useRef(null);
  const paintingRef = useRef(false);
  const dividerDragRef = useRef(false);
  const regionDragRef = useRef(null);
  const imageCacheRef = useRef(new Map());
  const historyRef = useRef(new Map());
  const dragDepthRef = useRef(0);
  const handleFilesRef = useRef(null);

  const activeFile = files[activeFileIdx];
  const slides = activeFile?.slides ?? [];
  const currentSlide = slides[current];
  const cleanedCount = slides.filter((s) => s.cleanedBlob).length;
  const detectedCount = slides.filter((s) => s.mask).length;
  const failedCount = slides.filter((s) => s.cleanFailed).length;
  const totalBytes = useMemo(
    () => slides.reduce((sum, s) => sum + s.originalBlob.size, 0),
    [slides],
  );

  // 설정 localStorage 저장 (디바운스)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, 250);
    return () => clearTimeout(timer);
  }, [settings]);

  // 성공 알림 자동 소멸
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // 도움말 ESC 닫기
  useEffect(() => {
    if (!helpOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen]);

  // 언어 적용: 싱글턴 동기화 + 문서 제목/lang 속성
  useEffect(() => {
    setActiveLang(lang);
    document.title = STRINGS[lang].docTitle;
    document.documentElement.lang = lang;
  }, [lang]);

  const getCachedImage = (url, blob) => {
    const cache = imageCacheRef.current;
    if (!cache.has(url)) {
      cache.set(url, loadImage(blob));
      if (cache.size > 60) cache.delete(cache.keys().next().value);
    }
    return cache.get(url);
  };

  const updateSlide = (slideIdx, patch) => {
    setFiles((prev) =>
      prev.map((f, fi) =>
        fi === activeFileIdx
          ? { ...f, slides: f.slides.map((s, si) => (si === slideIdx ? { ...s, ...patch } : s)) }
          : f,
      ),
    );
  };

  const slideImageData = async (slide) => {
    const img = await getCachedImage(slide.originalUrl, slide.originalBlob);
    return slideToImageData(slide, img).imageData;
  };

  const detectForSlide = async (slide) => detectWatermark(await slideImageData(slide), settings);

  const cleanSlide = async (slide, mask) => {
    const img = await getCachedImage(slide.originalUrl, slide.originalBlob);
    const { canvas, ctx, imageData } = slideToImageData(slide, img);
    ctx.putImageData(cleanImage(imageData, mask, settings).imageData, 0, 0);
    const mime = slide.sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, 0.96);
    return { blob, url: URL.createObjectURL(blob) };
  };

  const modeLabel = (mode) =>
    mode === 'template' ? T.modeTemplate : mode === 'lenient' ? T.modeLenient : '';

  // ── 파일 로드 + 자동 처리 ─────────────────────────────────────

  const autoProcess = async (entries) => {
    const totalSlides = entries.reduce((sum, f) => sum + f.slides.length, 0);
    const next = entries.map((f) => ({ ...f, slides: [...f.slides] }));
    let cleaned = 0;
    let skipped = 0;
    let processed = 0;
    for (let fi = 0; fi < next.length; fi += 1) {
      next[fi] = { ...next[fi], status: 'processing' };
      setFiles([...next]);
      setBusy(next.length > 1 ? T.busyFileN(fi + 1, next.length) : T.busyCleaning);
      let fileFailed = 0;
      for (let si = 0; si < next[fi].slides.length; si += 1) {
        const slide = next[fi].slides[si];
        const detection = await detectForSlide(slide);
        if (!detection.pixelCount) {
          fileFailed += 1;
          skipped += 1;
          next[fi].slides[si] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: 0,
            detectMode: detection.mode,
            maskSource: 'auto',
            cleanedBlob: undefined,
            cleanedUrl: undefined,
            cleanFailed: true,
          };
        } else {
          const result = await cleanSlide(slide, detection.mask);
          cleaned += 1;
          next[fi].slides[si] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: detection.pixelCount,
            detectMode: detection.mode,
            maskSource: 'auto',
            cleanedBlob: result.blob,
            cleanedUrl: result.url,
            cleanFailed: false,
          };
        }
        processed += 1;
        next[fi] = { ...next[fi], slides: [...next[fi].slides] };
        setFiles([...next]);
        setProgress((processed / totalSlides) * 100);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      next[fi] = {
        ...next[fi],
        status:
          fileFailed === next[fi].slides.length ? 'failed' : fileFailed ? 'partial' : 'done',
      };
      setFiles([...next]);
    }
    if (cleaned) {
      setView('compare');
      setNotice(skipped ? T.doneWithSkips(cleaned, skipped) : T.doneAll(cleaned));
      if (skipped) setSettingsOpen(true);
    } else {
      setError(T.errNoneFoundAll);
      setSettingsOpen(true);
    }
    if (window.innerWidth < 940) {
      requestAnimationFrame(() =>
        stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    }
  };

  const handleFiles = async (fileList) => {
    if (!fileList.length || busy) return;
    setError('');
    setNotice('');
    setBusy(T.busyReading);
    try {
      const entries = [];
      const imageFiles = [];
      for (const file of fileList) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'pptx') {
          entries.push({ ...(await loadPptx(file)), id: crypto.randomUUID(), status: 'ready' });
        } else if (ext === 'pdf') {
          entries.push({ ...(await loadPdf(file)), id: crypto.randomUUID(), status: 'ready' });
        } else if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }
      if (imageFiles.length) {
        entries.push({ ...(await loadImages(imageFiles)), id: crypto.randomUUID(), status: 'ready' });
      }
      if (!entries.length) throw new Error(T.errPickFiles);
      setFiles(entries);
      setActiveFileIdx(0);
      setCurrent(0);
      setView('original');
      setShowMask(true);
      imageCacheRef.current.clear();
      historyRef.current.clear();
      requestAnimationFrame(() =>
        workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
      await autoProcess(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errOpen);
    } finally {
      setBusy('');
      setProgress(0);
    }
  };
  handleFilesRef.current = handleFiles;

  // 화면 어디에 놓아도 업로드되는 전역 드래그&드롭
  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    };
    const onDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (!dragDepthRef.current) setDropActive(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDropActive(false);
      handleFilesRef.current?.(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleDemo = async () => {
    setBusy(T.busyDemo);
    setError('');
    try {
      const demo = { ...(await loadDemo()), id: crypto.randomUUID(), status: 'ready' };
      setFiles([demo]);
      setActiveFileIdx(0);
      setCurrent(0);
      setView('original');
      setShowMask(true);
      imageCacheRef.current.clear();
      historyRef.current.clear();
      requestAnimationFrame(() =>
        workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
      await autoProcess([demo]);
    } finally {
      setBusy('');
      setProgress(0);
    }
  };

  // ── 감지/복원 ────────────────────────────────────────────────

  const detectCurrent = async () => {
    if (!currentSlide || busy) return;
    setBusy(T.busyDetect);
    setError('');
    try {
      const result = await detectForSlide(currentSlide);
      updateSlide(current, {
        mask: result.mask,
        maskPixelCount: result.pixelCount,
        detectMode: result.mode,
        maskSource: 'auto',
        cleanedBlob: undefined,
        cleanedUrl: undefined,
        cleanFailed: !result.pixelCount,
      });
      setView('original');
      setShowMask(true);
      if (result.pixelCount) {
        setNotice(`${T.detectFound(result.pixelCount.toLocaleString())}${modeLabel(result.mode)}`);
      } else {
        setError(T.errDetectNone);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errDetectFail);
    } finally {
      setBusy('');
    }
  };

  const restoreCurrent = async () => {
    if (!currentSlide || busy) return;
    setBusy(T.busyRestore);
    setError('');
    try {
      // 손으로 칠한 마스크는 그대로 사용, 자동 마스크는 현재 설정으로 재감지
      const detection =
        currentSlide.maskSource === 'manual' && (currentSlide.maskPixelCount ?? 0) > 0
          ? {
              mask: currentSlide.mask,
              pixelCount: currentSlide.maskPixelCount ?? 0,
              mode: currentSlide.detectMode,
            }
          : await detectForSlide(currentSlide);

      if (!detection.pixelCount) {
        updateSlide(current, {
          mask: detection.mask,
          maskPixelCount: 0,
          detectMode: detection.mode,
          maskSource: 'auto',
          cleanedBlob: undefined,
          cleanedUrl: undefined,
          cleanFailed: true,
        });
        setView('original');
        setShowMask(true);
        setError(T.errNothingToRestore);
        return;
      }

      const cleaned = await cleanSlide(currentSlide, detection.mask);
      updateSlide(current, {
        mask: detection.mask,
        maskPixelCount: detection.pixelCount,
        detectMode: detection.mode,
        maskSource: currentSlide.maskSource === 'manual' ? 'manual' : 'auto',
        cleanedBlob: cleaned.blob,
        cleanedUrl: cleaned.url,
        cleanFailed: false,
      });
      setView('compare');
      setNotice(T.restoredOne);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errRestoreFail);
    } finally {
      setBusy('');
    }
  };

  const restoreAll = async () => {
    if (!activeFile || busy) return;
    setBusy(T.busyRestoreAll);
    setError('');
    setProgress(0);
    try {
      const entry = { ...activeFile, slides: [...activeFile.slides] };
      let done = 0;
      let skipped = 0;
      for (let i = 0; i < entry.slides.length; i += 1) {
        const slide = entry.slides[i];
        const detection =
          slide.maskSource === 'manual' && (slide.maskPixelCount ?? 0) > 0
            ? { mask: slide.mask, pixelCount: slide.maskPixelCount ?? 0, mode: slide.detectMode }
            : await detectForSlide(slide);
        if (!detection.pixelCount) {
          skipped += 1;
          entry.slides[i] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: 0,
            detectMode: detection.mode,
            maskSource: 'auto',
            cleanedBlob: undefined,
            cleanedUrl: undefined,
            cleanFailed: true,
          };
        } else {
          const cleaned = await cleanSlide(slide, detection.mask);
          done += 1;
          entry.slides[i] = {
            ...slide,
            mask: detection.mask,
            maskPixelCount: detection.pixelCount,
            detectMode: detection.mode,
            maskSource: slide.maskSource === 'manual' ? 'manual' : 'auto',
            cleanedBlob: cleaned.blob,
            cleanedUrl: cleaned.url,
            cleanFailed: false,
          };
        }
        entry.status = skipped === entry.slides.length ? 'failed' : skipped ? 'partial' : 'done';
        setFiles((prev) => prev.map((f, fi) => (fi === activeFileIdx ? { ...entry } : f)));
        setProgress(((i + 1) / entry.slides.length) * 100);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (done && !skipped) {
        setView('compare');
        setNotice(T.restoredAllN(done));
      } else if (done && skipped) {
        setView('compare');
        setNotice(T.restoredPartial(done, skipped));
      } else {
        setError(T.errNoneFoundRetry);
        setSettingsOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errBatch);
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
      maskSource: undefined,
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setNotice(T.resetDone);
  };

  // ── 저장 ─────────────────────────────────────────────────────

  const saveFile = async (file, target) => {
    if (target === 'pptx') {
      if (!file.pptxContext) throw new Error(T.errPptxOnly);
      await savePptx(file.pptxContext, file.slides);
    } else if (target === 'pdf') {
      await savePdf(file.sourceName, file.slides);
    } else {
      await saveZip(file.sourceName, file.slides);
    }
  };

  const exportAs = async (target) => {
    if (!activeFile || busy) return;
    setBusy(T.busyExport);
    setError('');
    try {
      await saveFile(activeFile, target);
      setNotice(T.savedOne);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errExport);
    } finally {
      setBusy('');
    }
  };

  const saveAllFiles = async () => {
    if (!files.length || busy) return;
    setBusy(T.busySaveAll);
    setError('');
    try {
      let saved = 0;
      for (const file of files) {
        if (!file.slides.some((s) => s.cleanedBlob)) continue;
        await saveFile(file, naturalExt(file.kind) === 'zip' ? 'images' : naturalExt(file.kind));
        saved += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      setNotice(saved ? T.savedAll(saved) : T.errNothingSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.errExport);
    } finally {
      setBusy('');
    }
  };

  // ── 마스크 브러시 ─────────────────────────────────────────────

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
    setNotice(T.undoDone);
  };

  const canUndo = !!historyRef.current.get(currentSlide?.id)?.length;

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
      maskSource: 'manual',
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setShowMask(true);
  };

  // ── 감지 영역 드래그/리사이즈 + 비교 분할선 ───────────────────

  const canvasFraction = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null; // 레이아웃 미확정 시 NaN 방지
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
        /* 무시 */
      }
      paintAt(event);
      return;
    }
    if (view === 'compare' && currentSlide.cleanedBlob) {
      dividerDragRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* 무시 */
      }
      const frac = canvasFraction(event);
      if (frac) setDivider(Math.min(0.98, Math.max(0.02, frac.fx)));
      return;
    }
    if (view === 'original' && showMask) {
      const frac = canvasFraction(event);
      if (!frac) return;
      const { fx, fy, rect } = frac;
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
    if (dividerDragRef.current) {
      const frac = canvasFraction(event);
      if (frac) setDivider(Math.min(0.98, Math.max(0.02, frac.fx)));
      return;
    }
    if (regionDragRef.current) {
      const frac = canvasFraction(event);
      if (frac) applyRegionDrag(frac.fx, frac.fy);
      return;
    }
    if (!canvasRef.current) return;
    if (view === 'compare') {
      canvasRef.current.style.cursor = 'ew-resize';
      return;
    }
    if (brushMode === 'none' && view === 'original' && showMask) {
      const frac = canvasFraction(event);
      if (!frac) return;
      const { fx, fy, rect } = frac;
      const hit = hitTestRegion(fx, fy, rect);
      canvasRef.current.style.cursor =
        hit === 'resize' ? 'nwse-resize' : hit === 'move' ? 'move' : '';
    }
  };

  const onCanvasPointerUp = () => {
    paintingRef.current = false;
    dividerDragRef.current = false;
    regionDragRef.current = null;
  };

  // ── 캔버스 + 루페 렌더링 ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas || !currentSlide) return;
      const hasCleaned = !!currentSlide.cleanedBlob;
      const showCompare = view === 'compare' && hasCleaned;
      const useCleaned = view === 'cleaned' && hasCleaned;

      const origImg = await getCachedImage(currentSlide.originalUrl, currentSlide.originalBlob);
      const cleanImg =
        (showCompare || useCleaned) && hasCleaned
          ? await getCachedImage(currentSlide.cleanedUrl, currentSlide.cleanedBlob)
          : null;
      if (cancelled) return;

      canvas.width = currentSlide.width;
      canvas.height = currentSlide.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (showCompare && cleanImg) {
        // [UX-2] 전/후 분할 비교
        const divX = Math.round(canvas.width * divider);
        ctx.drawImage(origImg, 0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(divX, 0, canvas.width - divX, canvas.height);
        ctx.clip();
        ctx.drawImage(cleanImg, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        // 분할선 + 핸들
        const lw = Math.max(2, canvas.width / 500);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = lw;
        ctx.shadowColor = 'rgba(0,0,0,.4)';
        ctx.shadowBlur = lw * 2;
        ctx.beginPath();
        ctx.moveTo(divX, 0);
        ctx.lineTo(divX, canvas.height);
        ctx.stroke();
        const hr = Math.max(13, canvas.width / 70);
        const hy = canvas.height / 2;
        ctx.fillStyle = 'rgba(255,255,255,.96)';
        ctx.beginPath();
        ctx.arc(divX, hy, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#6f55d9';
        const ar = hr * 0.42;
        ctx.beginPath();
        ctx.moveTo(divX - ar * 1.5, hy);
        ctx.lineTo(divX - ar * 0.4, hy - ar);
        ctx.lineTo(divX - ar * 0.4, hy + ar);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(divX + ar * 1.5, hy);
        ctx.lineTo(divX + ar * 0.4, hy - ar);
        ctx.lineTo(divX + ar * 0.4, hy + ar);
        ctx.closePath();
        ctx.fill();
        // 라벨
        const fs = Math.max(12, Math.round(canvas.width / 70));
        ctx.font = `600 ${fs}px system-ui, sans-serif`;
        const label = (text, x, align) => {
          ctx.textAlign = align;
          const pad = fs * 0.55;
          const tw = ctx.measureText(text).width;
          const bx = align === 'left' ? x - pad : x - tw - pad;
          ctx.fillStyle = 'rgba(28,24,20,.55)';
          ctx.beginPath();
          ctx.roundRect(bx, fs * 0.6, tw + pad * 2, fs * 1.9, fs);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(text, x, fs * 1.95);
        };
        label(T.labelOriginal, fs, 'left');
        label(T.labelCleaned, canvas.width - fs, 'right');
        ctx.restore();
      } else {
        ctx.drawImage(useCleaned ? cleanImg : origImg, 0, 0, canvas.width, canvas.height);
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
      }

      // 루페 — 우하단 영역 확대 (원본/복원 비교)
      if (showLoupe) {
        const region = regionRect(currentSlide.width, currentSlide.height, settings);
        const padX = Math.round((region.x1 - region.x0) * 0.3);
        const padY = Math.round((region.y1 - region.y0) * 0.8);
        const cropX = Math.max(0, region.x0 - padX);
        const cropY = Math.max(0, region.y0 - padY);
        const cropW = Math.min(currentSlide.width, region.x1 + padX + 1) - cropX;
        const cropH = Math.min(currentSlide.height, region.y1 + padY + 1) - cropY;
        const drawLoupe = (target, source) => {
          if (!target || !source) return;
          const zoomWidth = 480;
          target.width = zoomWidth;
          target.height = Math.max(1, Math.round((zoomWidth * cropH) / cropW));
          const tctx = target.getContext('2d');
          tctx.imageSmoothingEnabled = false;
          tctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, target.width, target.height);
        };
        drawLoupe(loupeOrigRef.current, origImg);
        if (hasCleaned) {
          const img =
            cleanImg ?? (await getCachedImage(currentSlide.cleanedUrl, currentSlide.cleanedBlob));
          if (!cancelled) drawLoupe(loupeCleanRef.current, img);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSlide, view, divider, showMask, showLoupe, settings, lang]);

  // ── 렌더 ──────────────────────────────────────────────────────

  const fileStatusIcon = (file) => {
    if (file.status === 'processing') return <Loader2 className="spin" size={16} />;
    if (file.status === 'done') return <CheckCircle2 className="ok" size={16} />;
    if (file.status === 'partial' || file.status === 'failed') {
      return <AlertTriangle className="warn" size={15} />;
    }
    return null;
  };

  const savePreviewName = activeFile
    ? outputName(activeFile.sourceName, naturalExt(activeFile.kind))
    : '';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={21} />
          </div>
          <div>
            <h1>{T.appName}</h1>
            <p>{T.tagline}</p>
          </div>
        </div>
        <div className="topbar-right">
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <HelpCircle size={15} /> <span>{T.helpButton}</span>
          </button>
          <div className="lang-toggle" role="group" aria-label="Language">
            <Languages size={14} aria-hidden="true" />
            <button className={lang === 'ko' ? 'active' : ''} onClick={() => setLang('ko')}>
              한국어
            </button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              English
            </button>
          </div>
          <div className="privacy-pill" title={T.privacyTitle}>
            <ShieldCheck size={16} /> <span>{T.privacyPill}</span>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="control-panel">
          <section className="panel-section upload-section">
            <div className="section-heading">
              <span className="step-badge">1</span>
              <div>
                <h2>{T.step1Title}</h2>
                <p>{T.step1Sub}</p>
              </div>
            </div>
            <button
              className={`drop-zone ${dropActive ? 'is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={34} />
              <strong>{T.dropTitle}</strong>
              <span>{T.dropSub}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".pptx,.pdf,.png,.jpg,.jpeg,.webp,image/*"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            {!files.length && (
              <button className="text-button" onClick={() => void handleDemo()}>
                <Eye size={15} /> {T.demoButton}
              </button>
            )}
            {files.length > 0 && (
              <div className="file-list">
                {files.map((file, i) => (
                  <button
                    key={file.id}
                    className={`file-card ${i === activeFileIdx ? 'selected' : ''}`}
                    onClick={() => {
                      setActiveFileIdx(i);
                      setCurrent(0);
                      setView(file.slides.some((s) => s.cleanedBlob) ? 'compare' : 'original');
                    }}
                    aria-label={T.ariaOpenFile(file.sourceName)}
                  >
                    <div className="file-icon">
                      {file.kind === 'pptx' ? <FileText /> : <ImageIcon />}
                    </div>
                    <div className="file-info">
                      <strong>{file.sourceName}</strong>
                      <span>
                        {kindLabel(file.kind)} · {T.unitCount(file.slides.length)} ·{' '}
                        {formatBytes(file.slides.reduce((s, x) => s + x.originalBlob.size, 0))}
                      </span>
                    </div>
                    <span className="file-status">{fileStatusIcon(file)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={`panel-section ${files.length ? '' : 'is-disabled'}`}>
            <div className="section-heading">
              <span className="step-badge">2</span>
              <div>
                <h2>{T.step2Title}</h2>
                <p>{T.step2Sub}</p>
              </div>
            </div>
            <button
              className="primary-action full"
              onClick={() => void restoreAll()}
              disabled={!slides.length || !!busy}
            >
              <Sparkles size={17} /> {T.reCleanAll(slides.length || 0)}
            </button>
            <details
              className="advanced settings-fold"
              open={settingsOpen}
              onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
            >
              <summary>
                {T.foldSummary} <em>{T.foldHint}</em>
              </summary>
              <div className="fold-head">
                <button
                  className="text-button compact"
                  onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
                  title={T.defaultsTitle}
                >
                  <RotateCcw size={12} /> {T.defaultsButton}
                </button>
              </div>
              <label className="field-label">{T.polarityLabel}</label>
              <div className="segmented three">
                {['bright', 'dark', 'both'].map((polarity) => (
                  <button
                    key={polarity}
                    className={settings.polarity === polarity ? 'active' : ''}
                    onClick={() => setSettings((prev) => ({ ...prev, polarity }))}
                  >
                    {polarity === 'bright'
                      ? T.polarityBright
                      : polarity === 'dark'
                        ? T.polarityDark
                        : T.polarityBoth}
                  </button>
                ))}
              </div>
              <label className="range-label">
                <span>{T.sensitivityLabel}</span>
                <output>{settings.sensitivity}</output>
              </label>
              <input
                className="range"
                type="range"
                min="8"
                max="34"
                value={settings.sensitivity}
                aria-label={T.sensitivityLabel}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, sensitivity: Number(e.target.value) }))
                }
              />
              <div className="range-hint">
                <span>{T.sensitivityMore}</span>
                <span>{T.sensitivityLess}</span>
              </div>
              <label className="range-label">
                <span>{T.expansionLabel}</span>
                <output>{settings.expansion}px</output>
              </label>
              <input
                className="range"
                type="range"
                min="0"
                max="4"
                value={settings.expansion}
                aria-label={T.expansionLabel}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, expansion: Number(e.target.value) }))
                }
              />
              <p className="hint-line">{T.regionHint}</p>
              <label className="range-label">
                <span>{T.regionWidthLabel}</span>
                <output>{Math.round(settings.regionWidth * 100)}%</output>
              </label>
              <input
                className="range"
                type="range"
                min="7"
                max="22"
                value={Math.round(settings.regionWidth * 100)}
                aria-label={T.regionWidthLabel}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, regionWidth: Number(e.target.value) / 100 }))
                }
              />
              <label className="range-label">
                <span>{T.regionHeightLabel}</span>
                <output>{Math.round(settings.regionHeight * 100)}%</output>
              </label>
              <input
                className="range"
                type="range"
                min="3"
                max="14"
                value={Math.round(settings.regionHeight * 100)}
                aria-label={T.regionHeightLabel}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, regionHeight: Number(e.target.value) / 100 }))
                }
              />
              <div className="action-grid">
                <button
                  className="secondary-action"
                  onClick={() => void detectCurrent()}
                  disabled={!slides.length || !!busy}
                >
                  <Eye size={17} /> {T.detectButton}
                </button>
                <button
                  className="primary-action"
                  onClick={() => void restoreCurrent()}
                  disabled={!slides.length || !!busy}
                >
                  <Wand2 size={17} /> {T.restoreButton}
                </button>
              </div>
            </details>
          </section>

          <section className={`panel-section ${files.length ? '' : 'is-disabled'}`}>
            <div className="section-heading compact">
              <span className="step-badge">3</span>
              <div>
                <h2>{T.step3Title}</h2>
                <p>
                  {T.restoredCount(cleanedCount, slides.length)}
                  {failedCount > 0 && (
                    <span className="warn-inline">{T.warnNoneInline(failedCount)}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="export-grid">
              {activeFile?.kind === 'pptx' && (
                <button
                  className="primary"
                  onClick={() => void exportAs('pptx')}
                  disabled={!cleanedCount || !!busy}
                >
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
                <span>{T.pngZip}</span>
              </button>
            </div>
            {activeFile && <p className="export-note">{T.saveNameNote(savePreviewName)}</p>}
            {failedCount > 0 && (
              <p className="export-warn">{T.warnIncluded(failedCount)}</p>
            )}
            {files.length > 1 && (
              <button
                className="primary-action full"
                onClick={() => void saveAllFiles()}
                disabled={!!busy || !files.some((f) => f.slides.some((s) => s.cleanedBlob))}
              >
                <FileDown size={17} /> {T.saveAllButton(files.length)}
              </button>
            )}
          </section>
        </aside>

        <section className="workspace" ref={workspaceRef}>
          {slides.length ? (
            <>
              <div className="workspace-toolbar">
                <div className="page-nav">
                  <button
                    onClick={() => setCurrent((i) => Math.max(0, i - 1))}
                    disabled={current === 0}
                    aria-label={T.ariaPrevSlide}
                  >
                    <ChevronLeft />
                  </button>
                  <strong>{current + 1}</strong>
                  <span>/ {slides.length}</span>
                  <button
                    onClick={() => setCurrent((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={current === slides.length - 1}
                    aria-label={T.ariaNextSlide}
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
                      {T.viewOriginal}
                    </button>
                    <button
                      className={view === 'compare' ? 'active' : ''}
                      onClick={() => setView('compare')}
                      disabled={!currentSlide?.cleanedBlob}
                    >
                      {T.viewCompare}
                    </button>
                    <button
                      className={view === 'cleaned' ? 'active' : ''}
                      onClick={() => setView('cleaned')}
                      disabled={!currentSlide?.cleanedBlob}
                    >
                      {T.viewCleaned}
                    </button>
                  </div>
                  <button
                    className={`icon-text-button ${showMask ? 'active' : ''}`}
                    onClick={() => setShowMask((v) => !v)}
                    disabled={view !== 'original'}
                    aria-label={T.ariaMaskToggle}
                  >
                    {showMask ? <Eye size={16} /> : <EyeOff size={16} />} {T.maskToggle}
                  </button>
                  <button
                    className={`icon-text-button ${showLoupe ? 'active' : ''}`}
                    onClick={() => setShowLoupe((v) => !v)}
                    aria-label={T.ariaLoupeToggle}
                  >
                    <ZoomIn size={16} /> {T.loupeToggle}
                  </button>
                </div>
              </div>
              <div className="canvas-wrap">
                <div className="canvas-stage" ref={stageRef}>
                  <canvas
                    ref={canvasRef}
                    className={brushMode !== 'none' ? 'brush-active' : ''}
                    aria-label={T.ariaCanvas}
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
                      <div className="loupe-title">{T.loupeTitle}</div>
                      <div className="loupe-row">
                        <span>{T.loupeBefore}</span>
                        <canvas ref={loupeOrigRef} />
                      </div>
                      {currentSlide.cleanedBlob && (
                        <div className="loupe-row">
                          <span>{T.loupeAfter}</span>
                          <canvas ref={loupeCleanRef} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="brush-toolbar">
                  <span>{T.brushTitle}</span>
                  <button
                    className={brushMode === 'add' ? 'active' : ''}
                    onClick={() => setBrushMode((m) => (m === 'add' ? 'none' : 'add'))}
                  >
                    <Brush size={16} /> {T.brushPaint}
                  </button>
                  <button
                    className={brushMode === 'erase' ? 'active' : ''}
                    onClick={() => setBrushMode((m) => (m === 'erase' ? 'none' : 'erase'))}
                  >
                    <Eraser size={16} /> {T.brushErase}
                  </button>
                  <label>
                    {T.brushSize}{' '}
                    <input
                      type="range"
                      min="5"
                      max="34"
                      value={brushSize}
                      aria-label={T.ariaBrushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                    />
                  </label>
                  <button onClick={undoMask} disabled={!canUndo} title="Ctrl/Cmd+Z">
                    <Undo2 size={16} /> {T.undoButton}
                  </button>
                  <button onClick={resetCurrent}>
                    <RotateCcw size={16} /> {T.resetButton}
                  </button>
                  <button
                    className="apply"
                    onClick={() => void restoreCurrent()}
                    disabled={!currentSlide?.maskPixelCount || !!busy}
                    title={T.applyTitle}
                  >
                    <Wand2 size={15} /> {T.applyButton}
                  </button>
                </div>
              </div>
              <div className="thumbnail-strip">
                {slides.map((slide, i) => (
                  <button
                    key={slide.id}
                    className={current === i ? 'selected' : ''}
                    onClick={() => setCurrent(i)}
                    aria-label={T.ariaViewSlide(i + 1)}
                  >
                    <div className="thumb-image">
                      <img src={slide.cleanedUrl ?? slide.originalUrl} alt={T.altSlide(i + 1)} />
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
                  <i className="status-dot detected" /> {T.statusDetected(detectedCount)}
                </span>
                <span>
                  <i className="status-dot cleaned" /> {T.statusCleaned(cleanedCount)}
                </span>
                {failedCount > 0 && (
                  <span>
                    <i className="status-dot warn" /> {T.statusFailed(failedCount)}
                  </span>
                )}
                {currentSlide?.maskPixelCount !== undefined && (
                  <span>{T.statusMaskPx(currentSlide.maskPixelCount.toLocaleString())}</span>
                )}
              </div>
            </>
          ) : (
            <div
              className="empty-workspace clickable"
              role="button"
              tabIndex={0}
              aria-label={T.ariaOpenPicker}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <div className="empty-visual">
                <div className="fake-slide">
                  <span>SLIDE</span>
                  <i>◉ NotebookLM</i>
                </div>
                <div className="wand-dot dot-one" />
                <div className="wand-dot dot-two" />
                <div className="wand-dot dot-three" />
              </div>
              <h2>{T.emptyTitle}</h2>
              <p>
                {T.emptyLine1}
                <br />
                {T.emptyLine2}
              </p>
              <div className="feature-row">
                <span>
                  <CloudOff size={15} /> {T.featureNoUpload}
                </span>
                <span>
                  <Eye size={15} /> {T.featureCompare}
                </span>
                <span>
                  <Brush size={15} /> {T.featureBrush}
                </span>
              </div>
              <button
                className="text-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setHelpOpen(true);
                }}
              >
                <HelpCircle size={14} /> {T.helpButton}
              </button>
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>{T.footerLocal}</span>
        <span>{T.footerNotice}</span>
      </footer>

      {helpOpen && (
        <div
          className="help-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={T.helpTitle}
          onClick={() => setHelpOpen(false)}
        >
          <div className="help-card" onClick={(e) => e.stopPropagation()}>
            <div className="help-head">
              <h2>
                <HelpCircle size={19} /> {T.helpTitle}
              </h2>
              <button
                className="help-close"
                aria-label={T.helpClose}
                onClick={() => setHelpOpen(false)}
              >
                ✕
              </button>
            </div>
            <p className="help-intro">{T.helpIntro}</p>
            <ol className="help-steps">
              {T.helpSteps.map((step, i) => (
                <li key={i}>
                  <span className="step-badge">{i + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <h3>{T.helpTroubleTitle}</h3>
            <ul className="help-trouble">
              {T.helpTrouble.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="help-note">💡 {T.helpTip}</p>
            <p className="help-note">🔒 {T.helpPrivacy}</p>
          </div>
        </div>
      )}

      {dropActive && (
        <div className="drop-overlay" role="presentation">
          <div className="drop-overlay-card">
            <UploadCloud size={44} />
            <strong>{T.overlayTitle}</strong>
            <span>{T.overlaySub}</span>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {busy && (
          <div className="toast busy" role="status">
            <Loader2 className="spin" size={16} />
            <div className="toast-body">
              <span>{busy}</span>
              {progress > 0 && (
                <div className="progress-track">
                  <i style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="toast error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button aria-label={T.ariaCloseToast} onClick={() => setError('')}>
              ✕
            </button>
          </div>
        )}
        {notice && !error && (
          <div className="toast success" role="status">
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        )}
      </div>
    </div>
  );
}
