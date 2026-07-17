// 다국어 문자열 사전.
// React 밖(loaders 등)에서는 t() 싱글턴을, App 렌더링에서는 STRINGS[lang]을 쓴다.
// 언어 추가 = 이 파일에 사전 하나 추가.

export const LANG_KEY = 'cleanslide.lang';

export const STRINGS = {
  ko: {
    appName: '클린 슬라이드',
    docTitle: '클린 슬라이드 — 슬라이드 워터마크 클리너',
    tagline: '워터마크 모양만 읽어 주변 질감으로 복원',
    privacyPill: '파일은 이 브라우저 안에서만 처리돼요',
    privacyTitle: '파일은 서버로 전송되지 않고 브라우저 안에서만 처리됩니다',

    step1Title: '슬라이드 불러오기',
    step1Sub: 'PPTX · PDF · PNG · JPG — 여러 파일 한꺼번에 가능',
    dropTitle: '파일을 놓거나 선택하세요',
    dropSub: '화면 어디에 끌어다 놓아도 바로 자동으로 정리돼요',
    demoButton: '데모 슬라이드로 먼저 보기',
    ariaOpenFile: (name) => `${name} 열기`,

    step2Title: '워터마크 정리',
    step2Sub: '올리면 자동으로 정리돼요 · 필요할 때만 조절',
    reCleanAll: (n) => `전체 ${n}장 다시 정리`,
    foldSummary: '세부 조절',
    foldHint: '감지가 잘 안 될 때 열어 보세요',
    defaultsButton: '기본값',
    defaultsTitle: '감지 설정을 기본값으로 되돌립니다',
    polarityLabel: '워터마크 밝기',
    polarityBright: '밝음',
    polarityDark: '어두움',
    polarityBoth: '둘 다',
    sensitivityLabel: '감지 민감도',
    sensitivityMore: '더 많이 감지',
    sensitivityLess: '더 선별',
    expansionLabel: '지울 부분 여유',
    regionHint: '감지 영역(점선 박스)은 화면에서 드래그해 옮기고, 좌상단 핸들로 크기를 바꿀 수 있어요.',
    regionWidthLabel: '가로 영역',
    regionHeightLabel: '세로 영역',
    detectButton: '미리 확인',
    restoreButton: '현재 장 복원',

    step3Title: '결과 저장',
    restoredCount: (done, total) => `${done}/${total}장 복원 완료`,
    warnNoneInline: (n) => ` · ⚠ ${n}장 감지 없음`,
    pngZip: 'PNG 묶음',
    saveNameNote: (name) => `저장 파일명: ${name}`,
    warnIncluded: (n) => `⚠ ${n}장은 원본 그대로 포함돼요`,
    saveAllButton: (n) => `모든 파일 저장 (${n}개)`,

    ariaPrevSlide: '이전 슬라이드',
    ariaNextSlide: '다음 슬라이드',
    viewOriginal: '원본',
    viewCompare: '비교',
    viewCleaned: '복원 결과',
    maskToggle: '마스크',
    ariaMaskToggle: '마스크 표시 전환',
    loupeToggle: '돋보기',
    ariaLoupeToggle: '우하단 돋보기 전환',
    ariaCanvas: '슬라이드 미리보기',
    loupeTitle: '우하단 확대',
    loupeBefore: '원본',
    loupeAfter: '복원',
    labelOriginal: '원본',
    labelCleaned: '복원',

    brushTitle: '마스크 직접 보정',
    brushPaint: '더 칠하기',
    brushErase: '지우기',
    brushSize: '크기',
    ariaBrushSize: '브러시 크기',
    undoButton: '실행취소',
    resetButton: '초기화',
    applyButton: '복원 적용',
    applyTitle: '칠한 마스크로 이 장을 복원합니다',

    ariaViewSlide: (n) => `슬라이드 ${n} 보기`,
    altSlide: (n) => `${n}번 슬라이드`,
    statusDetected: (n) => `감지 ${n}장`,
    statusCleaned: (n) => `복원 ${n}장`,
    statusFailed: (n) => `감지 없음 ${n}장`,
    statusMaskPx: (px) => `현재 장 마스크 ${px}px`,

    ariaOpenPicker: '파일 선택 열기',
    emptyTitle: '슬라이드를 올리면 자동으로 정리돼요',
    emptyLine1: '여기를 클릭해 파일을 고르거나,',
    emptyLine2: '화면 어디에나 파일을 끌어다 놓으세요.',
    featureNoUpload: '업로드 없음',
    featureCompare: '전/후 비교',
    featureBrush: '수동 보정',

    footerLocal: '로컬 처리 · 원본은 변경되지 않음',
    footerNotice: '생성물의 이용 권한과 표시 의무는 사용자가 확인해 주세요.',

    overlayTitle: '여기에 놓으면 바로 정리돼요',
    overlaySub: 'PPTX · PDF · PNG · JPG — 여러 파일도 가능',
    ariaCloseToast: '알림 닫기',

    busyReading: '파일을 브라우저 안에서 읽는 중…',
    busyDemo: '데모를 만드는 중…',
    busyCleaning: '워터마크를 찾아 정리하는 중…',
    busyFileN: (i, n) => `파일 ${i}/${n} · 워터마크를 찾아 정리하는 중…`,
    busyDetect: '워터마크 모양을 읽는 중…',
    busyRestore: '주변 질감으로 복원하는 중…',
    busyRestoreAll: '전체 슬라이드를 다시 정리하는 중…',
    busyExport: '결과 파일을 만드는 중…',
    busySaveAll: '모든 파일을 저장하는 중…',

    doneAll: (n) => `${n}장 모두 정리했어요. 분할선을 움직여 비교해 보고 저장하세요.`,
    doneWithSkips: (done, skipped) =>
      `${done}장 정리 완료 · ${skipped}장은 워터마크를 찾지 못했어요(⚠ 표시). 세부 조절이나 브러시로 보완해 주세요.`,
    restoredAllN: (n) => `${n}장 전체를 정리했습니다. 결과를 내려받을 수 있습니다.`,
    restoredPartial: (done, skipped) =>
      `${done}장 복원 완료 · ${skipped}장은 워터마크를 찾지 못했어요(⚠ 표시). 브러시로 칠한 뒤 다시 복원해 주세요.`,
    restoredOne: '현재 슬라이드를 복원했습니다. 분할선을 움직여 비교해 보세요.',
    detectFound: (n) => `${n}개 픽셀을 워터마크 후보로 찾았습니다.`,
    modeTemplate: ' (로고 모양 매칭)',
    modeLenient: ' (완화 기준)',
    resetDone: '현재 장의 감지 결과를 초기화했습니다.',
    undoDone: '마스크를 한 단계 되돌렸습니다.',
    savedOne: '정리된 결과 파일을 저장했습니다.',
    savedAll: (n) => `${n}개 파일을 원본 형식으로 저장했습니다.`,

    errPickFiles: 'PPTX, PDF, PNG, JPG 파일을 선택해 주세요.',
    errOpen: '파일을 여는 중 오류가 발생했습니다.',
    errNoneFoundAll:
      '워터마크를 찾지 못했습니다. 세부 조절에서 민감도를 낮추거나(더 많이 감지) 브러시로 직접 칠해 주세요.',
    errNoneFoundRetry:
      '워터마크를 찾지 못했습니다. 민감도를 낮추거나(더 많이 감지) 밝기 유형을 바꿔 보세요.',
    errDetectNone: '감지된 픽셀이 없습니다. 민감도를 낮추거나 밝기 유형을 바꿔 보세요.',
    errDetectFail: '워터마크 감지에 실패했습니다.',
    errNothingToRestore:
      '감지된 픽셀이 없어 복원할 내용이 없습니다. 민감도를 낮추거나(더 많이 감지), 브러시로 직접 칠한 뒤 다시 복원해 주세요.',
    errRestoreFail: '슬라이드 복원에 실패했습니다.',
    errBatch: '전체 처리 중 오류가 발생했습니다.',
    errExport: '결과 파일 생성에 실패했습니다.',
    errPptxOnly: 'PPTX 원본을 불러온 경우에만 PPTX로 저장할 수 있습니다.',
    errNothingSaved: '저장할 복원 결과가 없습니다. 먼저 정리를 실행해 주세요.',

    kindPptx: 'NotebookLM PPTX',
    kindPdf: 'PDF',
    kindImages: '이미지',
    kindDemo: '데모',
    slideName: (n) => `슬라이드 ${n}`,
    pageName: (n) => `페이지 ${n}`,
    imageName: (n) => `이미지 ${n}`,
    imagesName: (n) => `이미지 ${n}장`,
    demoName: '데모 슬라이드',
    demoHeadline: '여름 수업 자료',
    demoSubline: '우측 하단의 작은 글자 모양만 찾아 복원합니다.',
    unitCount: (n) => `${n}장`,
    loadedSlides: (n) => `${n}장의 슬라이드를 불러왔습니다.`,

    errNoSlidesInPptx: 'PPTX 안에서 슬라이드를 찾지 못했습니다.',
    errNoRels: (n) => `${n}번 슬라이드의 이미지 연결 정보를 찾지 못했습니다.`,
    errNotImagePptx: (n) =>
      `${n}번 슬라이드는 전체 슬라이드 이미지 형식이 아닙니다. NotebookLM에서 내보낸 원본 PPTX인지 확인해 주세요.`,
    errPdfRender: 'PDF 렌더링 화면을 만들지 못했습니다.',
    errImageLoad: '이미지를 읽지 못했습니다.',
    errImageConvert: '이미지 변환에 실패했습니다.',
  },

  en: {
    appName: 'Clean Slide',
    docTitle: 'Clean Slide — Slide Watermark Cleaner',
    tagline: 'Reads only the watermark shape, restores it with nearby texture',
    privacyPill: 'Files never leave your browser',
    privacyTitle: 'Files are processed entirely in your browser — nothing is uploaded',

    step1Title: 'Load slides',
    step1Sub: 'PPTX · PDF · PNG · JPG — multiple files at once',
    dropTitle: 'Drop or choose files',
    dropSub: 'Drop anywhere on the screen — cleaning starts automatically',
    demoButton: 'Try the demo slide first',
    ariaOpenFile: (name) => `Open ${name}`,

    step2Title: 'Clean watermark',
    step2Sub: 'Runs automatically on upload · tweak only if needed',
    reCleanAll: (n) => `Re-clean all ${n} slide${n === 1 ? '' : 's'}`,
    foldSummary: 'Fine-tune',
    foldHint: 'open if detection misses',
    defaultsButton: 'Defaults',
    defaultsTitle: 'Reset detection settings to defaults',
    polarityLabel: 'Watermark brightness',
    polarityBright: 'Bright',
    polarityDark: 'Dark',
    polarityBoth: 'Both',
    sensitivityLabel: 'Detection sensitivity',
    sensitivityMore: 'Detect more',
    sensitivityLess: 'More selective',
    expansionLabel: 'Mask padding',
    regionHint: 'Drag the dashed box on the slide to move it; resize with the top-left handle.',
    regionWidthLabel: 'Region width',
    regionHeightLabel: 'Region height',
    detectButton: 'Preview detect',
    restoreButton: 'Restore this slide',

    step3Title: 'Save results',
    restoredCount: (done, total) => `${done}/${total} slide${total === 1 ? '' : 's'} restored`,
    warnNoneInline: (n) => ` · ⚠ ${n} not detected`,
    pngZip: 'PNG ZIP',
    saveNameNote: (name) => `Saves as: ${name}`,
    warnIncluded: (n) => `⚠ ${n} slide${n === 1 ? '' : 's'} will be included unchanged`,
    saveAllButton: (n) => `Save all files (${n})`,

    ariaPrevSlide: 'Previous slide',
    ariaNextSlide: 'Next slide',
    viewOriginal: 'Original',
    viewCompare: 'Compare',
    viewCleaned: 'Cleaned',
    maskToggle: 'Mask',
    ariaMaskToggle: 'Toggle mask overlay',
    loupeToggle: 'Loupe',
    ariaLoupeToggle: 'Toggle corner loupe',
    ariaCanvas: 'Slide preview',
    loupeTitle: 'Corner zoom',
    loupeBefore: 'Before',
    loupeAfter: 'After',
    labelOriginal: 'Original',
    labelCleaned: 'Cleaned',

    brushTitle: 'Manual mask',
    brushPaint: 'Paint',
    brushErase: 'Erase',
    brushSize: 'Size',
    ariaBrushSize: 'Brush size',
    undoButton: 'Undo',
    resetButton: 'Reset',
    applyButton: 'Apply restore',
    applyTitle: 'Restore this slide using the painted mask',

    ariaViewSlide: (n) => `View slide ${n}`,
    altSlide: (n) => `Slide ${n}`,
    statusDetected: (n) => `Detected ${n}`,
    statusCleaned: (n) => `Restored ${n}`,
    statusFailed: (n) => `Not found ${n}`,
    statusMaskPx: (px) => `Current mask ${px}px`,

    ariaOpenPicker: 'Open file picker',
    emptyTitle: 'Drop a slide — it cleans automatically',
    emptyLine1: 'Click here to choose files,',
    emptyLine2: 'or drop them anywhere on the screen.',
    featureNoUpload: 'No upload',
    featureCompare: 'Before & after',
    featureBrush: 'Manual touch-up',

    footerLocal: 'Local processing · originals are never modified',
    footerNotice: 'You are responsible for usage rights and AI-content disclosure.',

    overlayTitle: 'Drop to clean instantly',
    overlaySub: 'PPTX · PDF · PNG · JPG — multiple files welcome',
    ariaCloseToast: 'Dismiss notification',

    busyReading: 'Reading files in your browser…',
    busyDemo: 'Building the demo…',
    busyCleaning: 'Finding and cleaning the watermark…',
    busyFileN: (i, n) => `File ${i}/${n} · finding and cleaning the watermark…`,
    busyDetect: 'Reading the watermark shape…',
    busyRestore: 'Restoring with nearby texture…',
    busyRestoreAll: 'Re-cleaning all slides…',
    busyExport: 'Preparing your file…',
    busySaveAll: 'Saving all files…',

    doneAll: (n) =>
      `Cleaned ${n} slide${n === 1 ? '' : 's'}. Drag the divider to compare, then save.`,
    doneWithSkips: (done, skipped) =>
      `Cleaned ${done} · no watermark found on ${skipped} (marked ⚠). Fine-tune or paint with the brush.`,
    restoredAllN: (n) => `Re-cleaned all ${n} slide${n === 1 ? '' : 's'}. Ready to download.`,
    restoredPartial: (done, skipped) =>
      `Restored ${done} · no watermark found on ${skipped} (marked ⚠). Paint with the brush, then restore again.`,
    restoredOne: 'Slide restored. Drag the divider to compare.',
    detectFound: (n) => `Found ${n} candidate watermark pixels.`,
    modeTemplate: ' (logo shape match)',
    modeLenient: ' (relaxed filter)',
    resetDone: 'Detection for this slide was reset.',
    undoDone: 'Mask reverted one step.',
    savedOne: 'Cleaned file saved.',
    savedAll: (n) => `Saved ${n} file${n === 1 ? '' : 's'} in their original formats.`,

    errPickFiles: 'Please choose PPTX, PDF, PNG, or JPG files.',
    errOpen: 'Something went wrong while opening the file.',
    errNoneFoundAll:
      'No watermark found. Lower the sensitivity under Fine-tune (detect more), or paint the area with the brush.',
    errNoneFoundRetry:
      'No watermark found. Lower the sensitivity (detect more) or change the brightness type.',
    errDetectNone: 'No pixels detected. Lower the sensitivity or change the brightness type.',
    errDetectFail: 'Watermark detection failed.',
    errNothingToRestore:
      'No pixels detected, so there is nothing to restore. Lower the sensitivity (detect more) or paint the area with the brush, then restore again.',
    errRestoreFail: 'Restoring the slide failed.',
    errBatch: 'Something went wrong during batch processing.',
    errExport: 'Creating the output file failed.',
    errPptxOnly: 'Saving as PPTX is only available when a PPTX file was loaded.',
    errNothingSaved: 'Nothing to save yet. Run cleaning first.',

    kindPptx: 'NotebookLM PPTX',
    kindPdf: 'PDF',
    kindImages: 'Images',
    kindDemo: 'Demo',
    slideName: (n) => `Slide ${n}`,
    pageName: (n) => `Page ${n}`,
    imageName: (n) => `Image ${n}`,
    imagesName: (n) => `${n} images`,
    demoName: 'Demo slide',
    demoHeadline: 'Summer Class Materials',
    demoSubline: 'Finds and restores only the small text in the corner.',
    unitCount: (n) => `${n} slide${n === 1 ? '' : 's'}`,
    loadedSlides: (n) => `Loaded ${n} slide${n === 1 ? '' : 's'}.`,

    errNoSlidesInPptx: 'No slides found inside the PPTX.',
    errNoRels: (n) => `Could not find image relationships for slide ${n}.`,
    errNotImagePptx: (n) =>
      `Slide ${n} is not a full-slide image. Make sure this is an original PPTX exported from NotebookLM.`,
    errPdfRender: 'Could not create the PDF rendering surface.',
    errImageLoad: 'Could not read the image.',
    errImageConvert: 'Image conversion failed.',
  },
};

export function detectLang() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && STRINGS[stored]) return stored;
  } catch {
    /* 무시 */
  }
  return (navigator.language ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

let activeLang = detectLang();

export function setActiveLang(lang) {
  if (!STRINGS[lang]) return;
  activeLang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 무시 */
  }
}

// React 밖(loaders, image 헬퍼)에서 현재 언어 사전을 읽을 때 사용
export function t() {
  return STRINGS[activeLang];
}
