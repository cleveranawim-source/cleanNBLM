# 클린 슬라이드 · Clean Slide (cleanNBLM)

Gemini Notebook(NotebookLM)이 슬라이드 우측 하단에 남기는 워터마크("Gemini Notebook"·"NotebookLM" 두 디자인 모두)를 **브라우저 안에서만** 감지·복원(인페인팅)해 지워주는 도구.
파일은 서버로 전송되지 않습니다.

**배포**: https://cleveranawim-source.github.io/cleanNBLM/

## 기능

- 입력: Gemini Notebook·NotebookLM PPTX(슬라이드 이미지 직접 추출) · PDF · PNG/JPG/WebP
- 우하단 영역에서 워터마크 픽셀 자동 감지 (밝기/민감도/영역 조절, 감지 영역은 화면에서 직접 드래그 가능)
- 주변 색·질감 기반 인페인팅 (양파껍질 방식 — 두꺼운 마스크·모서리도 빈 픽셀 없이 복원)
- 마스크 수동 브러시 보정 (실행취소 Ctrl/Cmd+Z)
- 우하단 확대(돋보기)로 원본/복원 비교
- 저장: PPTX(원본 구조 보존, 이미지만 교체) · PDF(원본 페이지 크기 유지) · PNG 묶음 ZIP

## 저장소 구조

```
├── index.html, assets/   ← 빌드 결과물 (GitHub Pages가 main 루트에서 서빙)
└── app/                  ← 소스 (Vite + React)
    ├── src/App.jsx           UI 전체
    └── src/lib/
        ├── detect.js         워터마크 감지 (템플릿 매칭 + 캐스케이드 필터)
        ├── inpaint.js        양파껍질 인페인팅 + 질감 복원
        ├── pipeline.js       감지→복원→잔여물 스윕
        ├── loaders.js        PPTX/PDF/이미지/데모 로더
        └── savers.js         PPTX/PDF/ZIP 저장
```

## 개발 · 배포

```bash
cd app
npm install
npm run dev      # 개발 서버
npm run deploy   # 빌드 후 레포 루트(index.html, assets/)에 배치
```

배치 후 커밋·푸시하면 GitHub Pages(main 루트)로 자동 배포됩니다.

### 회귀 테스트

개발 서버를 띄운 뒤 브라우저 콘솔에서:

```js
const H = await import('/test/harness.js');
H.runMatrix();                               // 배경 × 워터마크 + 오탐 케이스
H.runMatrix(1376, 768, H.GEMINI_MATRIX);     // Gemini Notebook 워터마크
H.runMatrix(1376, 768, H.SIZE_MATRIX);       // 글자 크기 8~24px 강건성
```

각 결과의 `residue`(남은 워터마크 px)는 0, 오탐 케이스의 `maskPx`는 0이어야 합니다.
(모래 질감 배경은 입자 차이로 residue가 수십~수백으로 잡히므로 크롭으로 육안 확인.)

## v2.0 (2026-07) 주요 변경

- **감지 실패 시 거짓 성공 차단**: 마스크 0px면 "복원 완료" 대신 경고 표시, 썸네일 ⚠ 배지
- **감지 필터 캐스케이드**: 글자 크기 필터(엄격)가 0px면 완화 기준으로 자동 재시도
  — 글자가 붙어 한 덩어리가 된 워터마크도 감지
- **탐색 창 확장**: 워터마크가 감지 영역 경계에 걸쳐 있어도 성분 전체를 마스킹
- **양파껍질 인페인팅**: 탐색 반경보다 두꺼운 마스크, 이미지 모서리 마스크도 완전 복원
- **앵커 오프셋 샘플링**: 안티앨리어싱 헤일로 오염 제거 (복원 오차 평균 11.9 → 3.3 luma)
- 돋보기(전/후 비교) · 감지 영역 드래그 · 브러시 커서 미리보기 · 실행취소 · 설정 기억(localStorage) · PDF 원본 페이지 크기 유지

## 안내

생성물의 이용 권한과 표시 의무는 사용자가 확인해 주세요.
