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

1. Android Studio Koala 이상 또는 Android SDK 34 설치
2. `android/` 디렉터리를 Android Studio에서 Open
3. Gradle Sync 후 `copyWebAssets` 태스크가 웹 파일을 `app/src/main/assets/www/` 로 복사
4. Run ▶ 실기기 또는 에뮬레이터

```bash
cd android
./gradlew assembleDebug
```

## WebView ↔ Native Bridge

| JS | Android |
|----|---------|
| `window.Android.speakText(text)` | TextToSpeech |
| `window.Android.stopSpeak()` | TTS stop |
| `window.Android.startVoiceSearch(requestId)` | Android 음성 인식 |
| `window.Android.stopVoiceSearch()` | Android 음성 인식 중단 |
| `window.Android.selectMenuImage(requestId)` | image/* 선택 + ML Kit OCR |
| `window.KeugeOcr._complete(payload)` | OCR 결과 콜백 |

## 메뉴 사진 읽기 화면 동작

- **Android 앱**: 웹 카메라 사용 안 함 → 버튼 탭 시 갤러리/최근 사진 선택기 실행
- **PC 브라우저**: 파일 선택 + 브라우저 OCR fallback

## 권한

- 카메라 권한 없음
- 마이크 권한 있음: Android WebView는 Web Speech API가 안정적으로 동작하지 않아 네이티브 음성 인식 fallback에 사용

## 패키지

`com.keuge.app`
