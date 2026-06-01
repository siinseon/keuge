# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**크게 크게 (Keuge)** is a static Korean accessibility menu helper (web + optional Android WebView shell). There is **no backend**, **no root `package.json`**, and **no automated test or ESLint suite** in this repository.

### Web app (primary dev surface)

| Action | Command |
|--------|---------|
| Serve locally | From repo root: `python3 -m http.server 8080` then open `http://localhost:8080/` |
| JS syntax check | `for f in js/*.js; do node --check "$f"; done` |

Use an HTTP server (not `file://`) so `fetch('/data/brands.json')` works.

Long-running dev server: use a **tmux** session (e.g. `keuge-web-server`) so the process survives backgrounding.

### Android app (optional)

| Action | Command |
|--------|---------|
| Build debug APK | `cd android && gradle assembleDebug` (requires Gradle **8.7** and `ANDROID_HOME` with SDK **34**) |
| APK output | `android/app/build/outputs/apk/debug/app-debug.apk` |

The repo ships `gradle-wrapper.properties` but **no `gradlew` binary**. Either install Gradle 8.7 globally, download the distribution to `/tmp/gradle-8.7`, or generate the wrapper locally with `gradle wrapper` (do not assume `gradlew` exists until added to the repo).

`preBuild` runs **`copyWebAssets`**, which copies root `index.html`, `js/`, `css/`, `data/`, and `assets/` into `android/app/src/main/assets/www/`. Edit web files at the repo root, then rebuild Android to pick them up.

**Cloud VM note:** Android SDK 34 and platform-tools are expected under `$HOME/Android/Sdk` with `ANDROID_HOME` set (see `~/.bashrc` on provisioned VMs). Accept licenses once with `yes | sdkmanager --licenses` if builds fail on license prompts.

### Lint / tests

There are no configured linters or unit tests. Practical checks:

- Web: `node --check` on `js/*.js`
- Android: `gradle assembleDebug` in `android/`

### Hello-world verification

1. Start the static server on port **8080**.
2. Open the app → **시작하기** → **카페** → **스타벅스** → confirm menu items load from `data/brands.json`.
3. (Optional) **검색하기** and search for a term such as `커피`.

### External dependencies at runtime

- Browser OCR uses **Tesseract.js** from jsDelivr CDN (needs outbound HTTPS on first OCR use).
- Web TTS/voice search uses the browser **Web Speech API** (Chromium recommended).
