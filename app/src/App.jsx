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
import { savePdf, savePptx, saveZip, outputName } from './lib/savers.js';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    ctx.putImageData(inpaintMask(imageData, mask, settings.searchRadius), 0, 0);
    const mime = slide.sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, 0.96);
    return { blob, url: URL.createObjectURL(blob) };
  };

  const modeLabel = (mode) =>
    mode === 'template' ? ' (로고 모양 매칭)' : mode === 'lenient' ? ' (완화 기준)' : '';

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
      setBusy(
        next.length > 1
          ? `파일 ${fi + 1}/${next.length} · 워터마크를 찾아 정리하는 중…`
          : '워터마크를 찾아 정리하는 중…',
      );
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
      setNotice(
        skipped
          ? `${cleaned}장 정리 완료 · ${skipped}장은 워터마크를 찾지 못했어요(⚠ 표시). 세부 조절이나 브러시로 보완해 주세요.`
          : `${cleaned}장 모두 정리했어요. 분할선을 움직여 비교해 보고 저장하세요.`,
      );
      if (skipped) setSettingsOpen(true);
    } else {
      setError(
        '워터마크를 찾지 못했습니다. 세부 조절에서 민감도를 낮추거나(더 많이 감지) 브러시로 직접 칠해 주세요.',
      );
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
    setBusy('파일을 브라우저 안에서 읽는 중…');
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
      if (!entries.length) throw new Error('PPTX, PDF, PNG, JPG 파일을 선택해 주세요.');
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
      setError(err instanceof Error ? err.message : '파일을 여는 중 오류가 발생했습니다.');
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
    setBusy('데모를 만드는 중…');
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
    setBusy('워터마크 모양을 읽는 중…');
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
        setNotice(
          `${result.pixelCount.toLocaleString()}개 픽셀을 워터마크 후보로 찾았습니다.${modeLabel(result.mode)}`,
        );
      } else {
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
        maskSource: currentSlide.maskSource === 'manual' ? 'manual' : 'auto',
        cleanedBlob: cleaned.blob,
        cleanedUrl: cleaned.url,
        cleanFailed: false,
      });
      setView('compare');
      setNotice('현재 슬라이드를 복원했습니다. 분할선을 움직여 비교해 보세요.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '슬라이드 복원에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const restoreAll = async () => {
    if (!activeFile || busy) return;
    setBusy('전체 슬라이드를 다시 정리하는 중…');
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
        setNotice(`${done}장 전체를 정리했습니다. 결과를 내려받을 수 있습니다.`);
      } else if (done && skipped) {
        setView('compare');
        setNotice(
          `${done}장 복원 완료 · ${skipped}장은 워터마크를 찾지 못했어요(⚠ 표시). 브러시로 칠한 뒤 다시 복원해 주세요.`,
        );
      } else {
        setError('워터마크를 찾지 못했습니다. 민감도를 낮추거나(더 많이 감지) 밝기 유형을 바꿔 보세요.');
        setSettingsOpen(true);
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
      maskSource: undefined,
      cleanedBlob: undefined,
      cleanedUrl: undefined,
      cleanFailed: false,
    });
    setView('original');
    setNotice('현재 장의 감지 결과를 초기화했습니다.');
  };

  // ── 저장 ─────────────────────────────────────────────────────

  const saveFile = async (file, target) => {
    if (target === 'pptx') {
      if (!file.pptxContext) throw new Error('PPTX 원본을 불러온 경우에만 PPTX로 저장할 수 있습니다.');
      await savePptx(file.pptxContext, file.slides);
    } else if (target === 'pdf') {
      await savePdf(file.sourceName, file.slides);
    } else {
      await saveZip(file.sourceName, file.slides);
    }
  };

  const exportAs = async (target) => {
    if (!activeFile || busy) return;
    setBusy('결과 파일을 만드는 중…');
    setError('');
    try {
      await saveFile(activeFile, target);
      setNotice('정리된 결과 파일을 저장했습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과 파일 생성에 실패했습니다.');
    } finally {
      setBusy('');
    }
  };

  const saveAllFiles = async () => {
    if (!files.length || busy) return;
    setBusy('모든 파일을 저장하는 중…');
    setError('');
    try {
      let saved = 0;
      for (const file of files) {
        if (!file.slides.some((s) => s.cleanedBlob)) continue;
        await saveFile(file, naturalExt(file.kind) === 'zip' ? 'images' : naturalExt(file.kind));
        saved += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      setNotice(
        saved
          ? `${saved}개 파일을 원본 형식으로 저장했습니다.`
          : '저장할 복원 결과가 없습니다. 먼저 정리를 실행해 주세요.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과 파일 생성에 실패했습니다.');
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
    setNotice('마스크를 한 단계 되돌렸습니다.');
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
        label('원본', fs, 'left');
        label('복원', canvas.width - fs, 'right');
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
  }, [currentSlide, view, divider, showMask, showLoupe, settings]);

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
            <h1>클린슬라이드</h1>
            <p>워터마크 모양만 읽어 주변 질감으로 복원</p>
          </div>
        </div>
        <div className="privacy-pill" title="파일은 서버로 전송되지 않고 브라우저 안에서만 처리됩니다">
          <ShieldCheck size={16} /> <span>파일은 이 브라우저 안에서만 처리돼요</span>
        </div>
      </header>

      <main className="layout">
        <aside className="control-panel">
          <section className="panel-section upload-section">
            <div className="section-heading">
              <span className="step-badge">1</span>
              <div>
                <h2>슬라이드 불러오기</h2>
                <p>PPTX · PDF · PNG · JPG — 여러 파일 한꺼번에 가능</p>
              </div>
            </div>
            <button
              className={`drop-zone ${dropActive ? 'is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={34} />
              <strong>파일을 놓거나 선택하세요</strong>
              <span>화면 어디에 끌어다 놓아도 바로 자동으로 정리돼요</span>
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
                <Eye size={15} /> 데모 슬라이드로 먼저 보기
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
                    aria-label={`${file.sourceName} 열기`}
                  >
                    <div className="file-icon">
                      {file.kind === 'pptx' ? <FileText /> : <ImageIcon />}
                    </div>
                    <div className="file-info">
                      <strong>{file.sourceName}</strong>
                      <span>
                        {kindLabel(file.kind)} · {file.slides.length}장 ·{' '}
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
                <h2>워터마크 정리</h2>
                <p>올리면 자동으로 정리돼요 · 필요할 때만 조절</p>
              </div>
            </div>
            <button
              className="primary-action full"
              onClick={() => void restoreAll()}
              disabled={!slides.length || !!busy}
            >
              <Sparkles size={17} /> 전체 {slides.length || 0}장 다시 정리
            </button>
            <details
              className="advanced settings-fold"
              open={settingsOpen}
              onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
            >
              <summary>
                세부 조절 <em>감지가 잘 안 될 때 열어 보세요</em>
              </summary>
              <div className="fold-head">
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
                aria-label="감지 민감도"
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, sensitivity: Number(e.target.value) }))
                }
              />
              <div className="range-hint">
                <span>더 많이 감지</span>
                <span>더 선별</span>
              </div>
              <label className="range-label">
                <span>지울 부분 여유</span>
                <output>{settings.expansion}px</output>
              </label>
              <input
                className="range"
                type="range"
                min="0"
                max="4"
                value={settings.expansion}
                aria-label="지울 부분 여유"
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, expansion: Number(e.target.value) }))
                }
              />
              <p className="hint-line">
                감지 영역(점선 박스)은 화면에서 드래그해 옮기고, 좌상단 핸들로 크기를 바꿀 수 있어요.
              </p>
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
                aria-label="감지 가로 영역"
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
                aria-label="감지 세로 영역"
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
                  <Eye size={17} /> 미리 확인
                </button>
                <button
                  className="primary-action"
                  onClick={() => void restoreCurrent()}
                  disabled={!slides.length || !!busy}
                >
                  <Wand2 size={17} /> 현재 장 복원
                </button>
              </div>
            </details>
          </section>

          <section className={`panel-section ${files.length ? '' : 'is-disabled'}`}>
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
                <span>PNG 묶음</span>
              </button>
            </div>
            {activeFile && <p className="export-note">저장 파일명: {savePreviewName}</p>}
            {failedCount > 0 && (
              <p className="export-warn">⚠ {failedCount}장은 원본 그대로 포함돼요</p>
            )}
            {files.length > 1 && (
              <button
                className="primary-action full"
                onClick={() => void saveAllFiles()}
                disabled={!!busy || !files.some((f) => f.slides.some((s) => s.cleanedBlob))}
              >
                <FileDown size={17} /> 모든 파일 저장 ({files.length}개)
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
                    aria-label="이전 슬라이드"
                  >
                    <ChevronLeft />
                  </button>
                  <strong>{current + 1}</strong>
                  <span>/ {slides.length}</span>
                  <button
                    onClick={() => setCurrent((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={current === slides.length - 1}
                    aria-label="다음 슬라이드"
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
                      className={view === 'compare' ? 'active' : ''}
                      onClick={() => setView('compare')}
                      disabled={!currentSlide?.cleanedBlob}
                    >
                      비교
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
                    disabled={view !== 'original'}
                    aria-label="마스크 표시 전환"
                  >
                    {showMask ? <Eye size={16} /> : <EyeOff size={16} />} 마스크
                  </button>
                  <button
                    className={`icon-text-button ${showLoupe ? 'active' : ''}`}
                    onClick={() => setShowLoupe((v) => !v)}
                    aria-label="우하단 돋보기 전환"
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
                    aria-label="슬라이드 미리보기"
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
                      aria-label="브러시 크기"
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                    />
                  </label>
                  <button onClick={undoMask} disabled={!canUndo} title="Ctrl/Cmd+Z">
                    <Undo2 size={16} /> 실행취소
                  </button>
                  <button onClick={resetCurrent}>
                    <RotateCcw size={16} /> 초기화
                  </button>
                  <button
                    className="apply"
                    onClick={() => void restoreCurrent()}
                    disabled={!currentSlide?.maskPixelCount || !!busy}
                    title="칠한 마스크로 이 장을 복원합니다"
                  >
                    <Wand2 size={15} /> 복원 적용
                  </button>
                </div>
              </div>
              <div className="thumbnail-strip">
                {slides.map((slide, i) => (
                  <button
                    key={slide.id}
                    className={current === i ? 'selected' : ''}
                    onClick={() => setCurrent(i)}
                    aria-label={`슬라이드 ${i + 1} 보기`}
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
            <div
              className="empty-workspace clickable"
              role="button"
              tabIndex={0}
              aria-label="파일 선택 열기"
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
              <h2>슬라이드를 올리면 자동으로 정리돼요</h2>
              <p>
                여기를 클릭해 파일을 고르거나,
                <br />화면 어디에나 파일을 끌어다 놓으세요.
              </p>
              <div className="feature-row">
                <span>
                  <CloudOff size={15} /> 업로드 없음
                </span>
                <span>
                  <Eye size={15} /> 전/후 비교
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

      {dropActive && (
        <div className="drop-overlay" role="presentation">
          <div className="drop-overlay-card">
            <UploadCloud size={44} />
            <strong>여기에 놓으면 바로 정리돼요</strong>
            <span>PPTX · PDF · PNG · JPG — 여러 파일도 가능</span>
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
            <button aria-label="알림 닫기" onClick={() => setError('')}>
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
