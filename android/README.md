# 크크봄 Android 앱

WebView + **Android 이미지 선택기** + **ML Kit Korean OCR** 기반 메뉴 사진 읽기 앱입니다.

## 구조

```
Android image picker (ActivityResultContracts.GetContent)
  → image/* 사진 선택
  → ML Kit Korean Text Recognition
  → window.KeugeOcr._complete({ requestId, success, text })
WebView
  → OCR 결과 UI (OcrResultUI)
  → TTS (window.Android.speakText)
  → 기존 navigation / 검색 / TTS 유지
```

## 빌드

1. Android Studio Meerkat 이상 또는 Android SDK **36** 설치
2. `android/` 디렉터리를 Android Studio에서 Open
3. Gradle Sync 후 `copyWebAssets` 태스크가 웹 파일을 `app/src/main/assets/www/` 로 복사
4. Run ▶ 실기기 또는 에뮬레이터

```bash
cd android
./gradlew assembleDebug
```

Play Console 업로드용 릴리스 번들:

```bash
./gradlew bundleRelease
```

출력: `app/build/outputs/bundle/release/app-release.aab`

## WebView ↔ Native Bridge

| JS | Android |
|----|---------|
| `window.Android.speakText(text)` | TextToSpeech |
| `window.Android.stopSpeak()` | TTS stop |
| `window.Android.selectMenuImage(requestId)` | image/* 선택 + ML Kit OCR |
| `window.KeugeOcr._complete(payload)` | OCR 결과 콜백 |

## 메뉴 사진 읽기 화면 동작

- **Android 앱**: 웹 카메라 사용 안 함 → 버튼 탭 시 갤러리/최근 사진 선택기 실행
- **PC 브라우저**: 파일 선택 + 브라우저 OCR fallback

## 권한

- 카메라 권한 없음

## 패키지

`com.siinseon.keuge`
