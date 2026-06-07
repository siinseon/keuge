# 크크봄

**메뉴가 잘 안 보이세요? 크게 보여드릴게요!**

크크봄은 시력이 약하거나 메뉴판 글씨를 읽기 어려운 분을 위한 **한국어 접근성 메뉴 도우미**입니다. 카페·식당 브랜드와 대표 메뉴를 크고 선명하게 보여 주고, 메뉴 사진의 글자를 OCR로 읽어 주며, 음성 안내까지 제공합니다.

백엔드 서버 없이 동작하는 **정적 웹 앱**이 핵심이며, Android 앱은 동일한 웹 UI를 WebView로 감싼 형태입니다.

---

## 주요 기능

### 메뉴 탐색
- **카페 / 식당** 카테고리별 브랜드 목록 (`data/brands.json`)
- 브랜드별 **대표 메뉴**를 큰 카드 UI로 표시
- **검색**: 브랜드명·메뉴명·**초성** 검색 지원
- **음성 검색**: Web Speech API로 검색어 입력 (Chromium 권장)
- **즐겨찾기** 및 **최근 검색어** 저장 (localStorage)

### 메뉴 사진 읽기 (OCR)
- 갤러리에서 메뉴 사진 선택 → 미리보기 → **읽어주기**로 글자 인식
- **Android**: ML Kit Korean OCR + 네이티브 TTS
- **웹 브라우저**: Tesseract.js OCR + Web Speech API TTS
- 인식 결과를 크게 표시하고 음성으로 읽어 줌
- 사진 **전체 화면 확대** 및 핀치 줌 지원

### 접근성 설정
- **글자 크기** (작게 / 보통 / 크게)
- **화면 모드** (기본, 고대비, 흑백, 색상 반전)
- **음성 안내** on/off
- **애니메이션 줄이기**
- 스크린 리더용 `aria-live` 안내, 큰 터치 영역, 하단 탭 내비게이션

---

## 현재 개발 상태

| 영역 | 상태 | 비고 |
|------|------|------|
| 웹 앱 (핵심) | ✅ 사용 가능 | HTTP 서버로 제공 시 정상 동작 |
| Android 앱 | ✅ 사용 가능 | WebView + ML Kit OCR + TTS |
| 메뉴 데이터 | ✅ 정적 JSON | 카페 30개 · 식당 70여 개 브랜드 |
| 백엔드 / 로그인 | ❌ 없음 | 서버·계정 기능 미구현 |
| 자동화 테스트 | ❌ 없음 | `node --check` 및 수동 검증 위주 |
| CI / 린터 | ❌ 없음 | 별도 ESLint·단위 테스트 미설정 |

**최근 완료**
- Android WebView `file://` 환경에서 `brands.json` 로드 실패 수정 (`Android.loadBrandsJson()` 브리지)
- 메뉴 표시 시 JSON에 등록된 **전체 메뉴** 노출

**알려진 제한**
- 웹 OCR은 최초 사용 시 Tesseract.js CDN 다운로드 필요 (인터넷 연결)
- 메뉴 데이터는 정적 파일이라 실시간 가격·신메뉴 반영 불가
- iOS 네이티브 앱 미지원 (모바일 Safari에서 웹으로 이용 가능)

---

## 기술 스택

### 웹
| 구분 | 기술 |
|------|------|
| 마크업 / 스타일 | HTML5, CSS3 (반응형·접근성 중심) |
| 로직 | Vanilla JavaScript (프레임워크 없음) |
| 데이터 | `data/brands.json` (정적 JSON) |
| OCR (웹) | [Tesseract.js](https://github.com/naptha/tesseract.js) (jsDelivr CDN) |
| TTS / STT (웹) | Web Speech API |
| 배포 | 정적 호스팅 (예: Vercel — `vercel.json` 포함) |

### Android
| 구분 | 기술 |
|------|------|
| 언어 | Kotlin |
| UI | WebView (루트 웹 앱을 `assets/www/`에 번들) |
| OCR | Google ML Kit Text Recognition (Korean) |
| TTS | Android TextToSpeech |
| 빌드 | Gradle 8.x, compileSdk 35, minSdk 24 |
| 패키지 | `com.siinseon.keuge` |

### 프로젝트 구조

```
keuge/
├── index.html          # 앱 진입점
├── css/styles.css      # 스타일
├── js/
│   ├── bootstrap.js    # 상태·네비·OCR·데이터 로더
│   ├── main.js         # 초기화·전역 핸들러
│   ├── ui.js           # 화면 렌더링
│   └── speech.js       # 음성 검색·TTS
├── data/brands.json    # 브랜드·메뉴 데이터
├── assets/             # 로고 등 정적 리소스
└── android/            # Android WebView 셸
```

---

## 빠른 시작

### 웹 (로컬)

```bash
# 저장소 루트에서
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/` 접속 후 **시작하기 → 카페 → 스타벅스**로 메뉴가 로드되는지 확인합니다.

> `file://`로 직접 열면 `fetch`가 실패할 수 있습니다. 반드시 HTTP 서버를 사용하세요.

### Android

1. Android Studio에서 `android/` 폴더 열기
2. Gradle Sync — `preBuild` 시 `copyWebAssets`가 웹 파일을 `app/src/main/assets/www/`로 복사
3. Run ▶ (실기기 또는 에뮬레이터)

```bash
cd android
gradle assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

웹 파일을 수정한 뒤에는 Android를 **다시 빌드**해야 assets에 반영됩니다.

### JS 문법 검사

```bash
node --check js/bootstrap.js
node --check js/main.js
node --check js/ui.js
node --check js/speech.js
```

---

## 향후 개발 계획

### 단기
- [ ] `gradlew` 래퍼 바이너리 저장소 포함으로 빌드 환경 통일
- [ ] 메뉴·브랜드 데이터 검증 스크립트 및 기본 스모크 테스트 추가
- [ ] OCR 인식 품질 개선 (전처리, 오류 메시지·재시도 UX)

### 중기
- [ ] 카테고리 확장 (편의점, 베이커리 등) 및 메뉴 데이터 업데이트 프로세스 정립
- [ ] 즐겨찾기·최근 메뉴 UX 강화 (홈 화면 바로가기 등)
- [ ] PWA 지원 (오프라인 캐시, 홈 화면 설치)

### 장기
- [ ] 사용자 맞춤 메뉴·글자 크기 프로필 동기화 (선택적 계정/클라우드)
- [ ] 실제 매장 메뉴판과 연동하는 데이터 수집·검수 체계
- [ ] iOS 네이티브 또는 크로스플랫폼 앱 검토

---

## 라이선스

본 저장소의 라이선스는 별도 명시가 없습니다. 기여·배포 전 저장소 관리자에게 문의하세요.

## 관련 문서

- [android/README.md](android/README.md) — Android WebView·네이티브 브리지 상세
- [AGENTS.md](AGENTS.md) — 개발 환경·빌드·검증 가이드 (에이전트/개발자용)
