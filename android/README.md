# 크게 크게 Android 앱

WebView + **CameraX** + **ML Kit Korean OCR** 네이티브 카메라/OCR 앱입니다.

## 구조

```
CameraX (NativeCameraActivity)
  → 사진 촬영
  → ML Kit Korean Text Recognition
  → window.KeugeOcr._complete({ requestId, success, text })
WebView
  → OCR 결과 UI (OcrResultUI)
  → TTS (window.Android.speakText)
  → 기존 navigation / 검색 / TTS 유지
```

## 빌드

1. Android Studio Koala 이상 또는 Android SDK 34 설치
2. `android/` 디렉터리를 Android Studio에서 Open
3. Gradle Sync 후 `copyWebAssets` 태스크가 웹 파일을 `app/src/main/assets/www/` 로 복사
4. Run ▶ 실기기 또는 에뮬레이터 (카메라 권장: **실기기**)

```bash
cd android
./gradlew assembleDebug
```

## WebView ↔ Native Bridge

| JS | Android |
|----|---------|
| `window.Android.speakText(text)` | TextToSpeech |
| `window.Android.stopSpeak()` | TTS stop |
| `window.Android.captureAndRecognize(requestId, 'true'/'false')` | CameraX + OCR |
| `window.KeugeOcr._complete(payload)` | OCR 결과 콜백 |

## 돋보기(카메라) 화면 동작

- **Android 앱**: 웹 `getUserMedia` 사용 안 함 → 버튼 탭 시 네이티브 CameraX Activity
- **PC 브라우저**: 기존 웹 카메라 + (OCR은 앱 bridge 없으면 안내)

## 권한

- `CAMERA` — CameraX 촬영

## 패키지

`com.keuge.app`
