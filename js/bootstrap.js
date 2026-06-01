/**
 * 크게 크게 - 접근성 중심 메뉴 도우미
 */

function vib(pattern = [30]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const DEFAULT_SETTINGS = {
  voiceEnabled: true,
  fontSize: 'medium',
  displayMode: 'normal',
  reducedMotion: false
};

function safeParseJSON(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function loadStringArray(key) {
  const parsed = safeParseJSON(localStorage.getItem(key), []);
  return Array.isArray(parsed) ? parsed : [];
}

function loadSettings() {
  const parsed = safeParseJSON(localStorage.getItem('settings'), DEFAULT_SETTINGS);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...parsed };
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════
//   CORE MODULE: STATE & SETTINGS
// ═══════════════════════════════════════════
const AppState = {
  screenHistory: ['home'],
  favorites: loadStringArray('fav'),
  recentMenus: loadStringArray('recentMenus'),
  recentSearches: loadStringArray('recentSearches'),
  settings: loadSettings(),
  brands: null,
  brandsLoading: false,
  brandsLoadFailed: false,
  brandsLoadErrors: [],
  brandsSource: null,

  save() {
    safeSetItem('fav', JSON.stringify(this.favorites));
    safeSetItem('recentMenus', JSON.stringify(this.recentMenus));
    safeSetItem('recentSearches', JSON.stringify(this.recentSearches));
    safeSetItem('settings', JSON.stringify(this.settings));
  }
};

const SettingsManager = {
  init() {
    this.applySettings();
  },
  
  update(key, value) {
    AppState.settings[key] = value;
    AppState.save();
    this.applySettings();
    
    let msg = '';
    if (key === 'fontSize') msg = `글자 크기가 ${value === 'small' ? '작게' : value === 'large' ? '크게' : '보통'}로 변경되었습니다.`;
    if (key === 'displayMode') msg = `화면 모드가 변경되었습니다.`;
    if (key === 'reducedMotion') msg = value ? '애니메이션이 제한됩니다.' : '애니메이션을 사용합니다.';
    
    if (msg) {
      showToast(msg);
      NavigationManager.announce(msg);
    }
    
    if (AppState.screenHistory[AppState.screenHistory.length - 1] === 'settings') {
      UI.renderSettingsScreen();
    }
  },
  
  applySettings() {
    const body = document.body;
    const s = AppState.settings;
    
    // Font Size
    body.classList.remove('fs-small', 'fs-large');
    if (s.fontSize === 'small') body.classList.add('fs-small');
    if (s.fontSize === 'large') body.classList.add('fs-large');
    
    // Display Mode
    body.classList.remove('high-contrast', 'grayscale', 'invert');
    if (s.displayMode !== 'normal') body.classList.add(s.displayMode);
    
    // Reduced Motion
    if (s.reducedMotion) {
      body.setAttribute('data-reduced-motion', 'true');
    } else {
      body.removeAttribute('data-reduced-motion');
    }
  }
};

// ═══════════════════════════════════════════
//   NAVIGATION MODULE
// ═══════════════════════════════════════════
const NavigationManager = {
  _setActiveNavTab(name) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.remove('active');
      t.removeAttribute('aria-current');
    });
    const tab = document.getElementById('nav-' + name);
    if (tab) {
      tab.classList.add('active');
      tab.setAttribute('aria-current', 'page');
    }
  },


  navTo(name) {
    vib();
    this._setActiveNavTab(name);

    AppState.screenHistory = [name === 'home' ? 'home' : name];
    this.switchScreen(name);
  },

  gotoScreen(name) {
    vib();
    this.switchScreen(name);
    AppState.screenHistory.push(name);
  },

  switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('screen-' + name);
    if (target) {
      target.classList.add('active');
      
      // Screen specific logic
      if (name === 'home') {
        if (!document.querySelector('#screen-home .home-cat-btn')) UI.renderHomeScreen();
      } else if (name === 'search') {
        UI.renderSearchScreen();
      } else if (name === 'fav') {
        UI.renderFavScreen();
      } else if (name === 'settings') {
        UI.renderSettingsScreen();
      }
      
      this.announceScreen(name);
    }
    
    if (name === 'camera') CameraManager.start();
    else CameraManager.stop();
  },

  goBack() {
    vib();
    if (AppState.screenHistory.length <= 1) {
      const root = AppState.screenHistory[0] || 'home';
      this.navTo(root === 'camera' ? 'camera' : root === 'fav' ? 'fav' : root === 'settings' ? 'settings' : 'home');
      return;
    }
    AppState.screenHistory.pop();
    const prev = AppState.screenHistory[AppState.screenHistory.length - 1];
    this.switchScreen(prev);
    
    // Update bottom nav active state
    const rootTabs = ['home', 'camera', 'fav', 'settings'];
    if (rootTabs.includes(prev)) {
      this._setActiveNavTab(prev);
    }
  },

  announce(msg, forceTTS = false) {
    const announcer = document.getElementById('sr-announcer');
    if (announcer) {
      announcer.textContent = '';
      setTimeout(() => { announcer.textContent = msg; }, 100);
    }
    if (AppState.settings.voiceEnabled || forceTTS) {
      SpeechManager.speak(msg, true);
    }
  },

  announceScreen(name) {
    const titles = {
      'home': '홈 화면입니다.',
      'search': '검색 화면입니다. 브랜드나 메뉴를 입력해 주세요.',
      'results': '검색 결과 화면입니다.',
      'detail': '상세 메뉴 화면입니다.',
      'camera': '돋보기 카메라 화면입니다. 화면을 눌러 사진을 찍을 수 있습니다.',
      'fav': '즐겨찾기 화면입니다.',
      'settings': '설정 화면입니다.'
    };
    this.announce(titles[name] || '화면이 전환되었습니다.');
  }
};

// ═══════════════════════════════════════════
//   SPEECH MODULE
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
//   OCR BRIDGE & RESULT UI
// ═══════════════════════════════════════════
const KeugeOcr = {
  _pending: {},
  // 시스템 카메라는 사용자의 촬영 시간을 포함하므로 타임아웃을 충분히 길게 둔다.
  _timeoutMs: 300000,

  init() {
    window.KeugeOcr = this;
  },

  isNativeAvailable() {
    return this.isNativeCameraAvailable() ||
      !!(window.Android && typeof window.Android.recognizeTextFromBase64 === 'function');
  },

  isNativeCameraAvailable() {
    return !!(window.Android && typeof window.Android.captureAndRecognize === 'function');
  },

  _complete(payload) {
    try { console.log('[KeugeOcr] _complete', payload); } catch (_) {}
    if (!payload || !payload.requestId) {
      try { console.warn('[KeugeOcr] _complete: missing requestId'); } catch (_) {}
      return;
    }
    const pending = this._pending[payload.requestId];
    if (!pending) {
      try { console.warn('[KeugeOcr] _complete: no pending for', payload.requestId); } catch (_) {}
      // pending 이 사라진 경우(=타임아웃 등) — text 가 있으면 결과 모달, 오류는 표시 보류.
      if (payload.success && payload.text) {
        try { OcrResultUI.showResult(String(payload.text).trim()); } catch (_) {}
      }
      return;
    }

    clearTimeout(pending.timer);
    delete this._pending[payload.requestId];

    if (payload.success) {
      // mode === 'capture' : 촬영만 한 경우 -> {path, previewDataUrl} 반환
      if (pending.mode === 'capture') {
        pending.resolve({
          path: payload.photoPath || '',
          previewDataUrl: payload.previewDataUrl || ''
        });
        return;
      }
      // mode === 'text' : OCR 결과
      if (payload.text) {
        pending.resolve(String(payload.text).trim());
        return;
      }
    }
    pending.reject(new Error(payload.error || 'ocr_failed'));
  },

  _prepareImage(canvas) {
    const maxWidth = 1280;
    const quality = 0.75;
    let targetW = canvas.width;
    let targetH = canvas.height;

    if (targetW > maxWidth) {
      targetH = Math.round((targetH * maxWidth) / targetW);
      targetW = maxWidth;
    }

    const output = document.createElement('canvas');
    output.width = targetW;
    output.height = targetH;
    const ctx = output.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(canvas, 0, 0, targetW, targetH);
    const dataUrl = output.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1] || null;
  },

  recognizeCanvas(canvas) {
    return new Promise((resolve, reject) => {
      if (!canvas || !canvas.width || !canvas.height) {
        reject(new Error('empty_image'));
        return;
      }
      if (!this.isNativeAvailable()) {
        reject(new Error('no_bridge'));
        return;
      }

      const base64 = this._prepareImage(canvas);
      if (!base64) {
        reject(new Error('empty_image'));
        return;
      }

      const requestId = 'ocr_' + Date.now();
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        reject(new Error('timeout'));
      }, this._timeoutMs);

      this._pending[requestId] = { resolve, reject, timer };

      try {
        window.Android.recognizeTextFromBase64(requestId, base64);
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[requestId];
        reject(e);
      }
    });
  },

  startNativeCapture(runOcr) {
    return new Promise((resolve, reject) => {
      if (!this.isNativeCameraAvailable()) {
        reject(new Error('no_native_camera'));
        return;
      }

      const requestId = 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        try { console.warn('[KeugeOcr] timeout', requestId); } catch (_) {}
        reject(new Error('timeout'));
      }, this._timeoutMs);

      // mode: 'capture' = 촬영만(파일 경로 반환), 'text' = OCR 텍스트 반환
      this._pending[requestId] = {
        resolve, reject, timer,
        mode: runOcr ? 'text' : 'capture'
      };
      try { console.log('[KeugeOcr] startNativeCapture', { requestId, runOcr }); } catch (_) {}

      try {
        window.Android.captureAndRecognize(requestId, runOcr ? 'true' : 'false');
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[requestId];
        reject(e);
      }
    });
  },

  /**
   * 디스크에 저장된 사진 파일을 OCR. "글자 읽기" 가 카메라를 새로 열지 않고
   * 마지막 촬영본을 인식하기 위한 경로.
   * @param {string} path NativeCameraActivity 가 반환한 절대 경로
   * @returns {Promise<string>} OCR 결과 텍스트
   */
  recognizeStoredImage(path) {
    return new Promise((resolve, reject) => {
      if (!path) { reject(new Error('empty_image')); return; }
      const bridge = window.Android;
      if (!bridge || typeof bridge.recognizeStoredImage !== 'function') {
        reject(new Error('no_bridge'));
        return;
      }
      const requestId = 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        try { console.warn('[KeugeOcr] timeout', requestId); } catch (_) {}
        reject(new Error('timeout'));
      }, 60000);
      this._pending[requestId] = { resolve, reject, timer, mode: 'text' };
      try { console.log('[KeugeOcr] recognizeStoredImage', { requestId, path }); } catch (_) {}
      try {
        bridge.recognizeStoredImage(requestId, path);
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[requestId];
        reject(e);
      }
    });
  }
};

// ═══════════════════════════════════════════
//   BROWSER OCR (Tesseract.js — 웹 브라우저 전용)
// ═══════════════════════════════════════════
const BrowserOcr = {
  _worker: null,

  available() {
    return typeof Tesseract !== 'undefined';
  },

  async _ensureWorker() {
    if (this._worker) return this._worker;
    this._worker = await Tesseract.createWorker('kor');
    return this._worker;
  },

  async recognize(canvas) {
    if (!this.available()) throw new Error('tesseract_not_loaded');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const worker = await this._ensureWorker();
    const { data } = await worker.recognize(dataUrl);
    const text = (data.text || '').trim();
    if (!text) throw new Error('empty_text');
    return text;
  }
};

const OcrResultUI = {
  _currentText: '',

  bindEvents(bindFn) {
    if (!bindFn) return;
    bindFn(document.getElementById('ocrSpeakBtn'), 'click', () => this.speakCurrent());
    bindFn(document.getElementById('ocrCloseBtn'), 'click', () => this.hide());
  },

  /**
   * 원본 모달 또는, 어떤 이유로든 사용 불가하면 동적으로 생성한 fallback 모달의
   * 엘리먼트 묶음을 반환한다. 결과를 못 보여주는 상황이 절대 없도록 보장.
   */
  _els() {
    let modal = document.getElementById('ocrResultModal');
    if (!modal) modal = this._buildFallbackModal();
    return {
      modal,
      loading: modal.querySelector('#ocrLoading'),
      text: modal.querySelector('#ocrResultText'),
      error: modal.querySelector('#ocrErrorMsg'),
      speakBtn: modal.querySelector('#ocrSpeakBtn'),
      closeBtn: modal.querySelector('#ocrCloseBtn')
    };
  },

  _buildFallbackModal() {
    try { console.warn('[OcrResultUI] building fallback modal'); } catch (_) {}
    const modal = document.createElement('div');
    modal.id = 'ocrResultModal';
    modal.className = 'ocr-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'background:rgba(0,0,0,0.92)', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:16px'
    ].join(';');
    modal.innerHTML = ''
      + '<div style="background:#fff;color:#111;border-radius:16px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;gap:12px;padding:20px;">'
      + '  <h2 style="font-size:22px;font-weight:800;margin:0;text-align:center;">사진 속 글자</h2>'
      + '  <div id="ocrLoading" hidden style="text-align:center;font-weight:700;color:#2563EB;padding:16px;">글자를 읽는 중입니다...</div>'
      + '  <div id="ocrResultText" style="font-size:24px;font-weight:700;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow-y:auto;padding:12px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:12px;"></div>'
      + '  <p id="ocrErrorMsg" style="color:#b91c1c;font-weight:700;text-align:center;margin:0;"></p>'
      + '  <button id="ocrSpeakBtn" type="button" hidden style="background:#2563EB;color:#fff;border:none;border-radius:12px;min-height:56px;font-size:18px;font-weight:800;">읽기</button>'
      + '  <button id="ocrCloseBtn" type="button" style="background:#fff;color:#111;border:1px solid #d1d5db;border-radius:12px;min-height:56px;font-size:18px;font-weight:700;">닫기</button>'
      + '</div>';
    document.body.appendChild(modal);
    const speak = modal.querySelector('#ocrSpeakBtn');
    if (speak) speak.addEventListener('click', () => this.speakCurrent());
    const close = modal.querySelector('#ocrCloseBtn');
    if (close) close.addEventListener('click', () => this.hide());
    return modal;
  },

  _forceShow(modal) {
    if (!modal) return;
    modal.hidden = false;
    modal.removeAttribute('hidden');
    if (!modal.style.display || modal.style.display === 'none') {
      modal.style.display = 'flex';
    }
    modal.style.zIndex = '2147483000';
    modal.classList.add('show');
  },

  showLoading() {
    try { console.log('[OcrResultUI] showLoading'); } catch (_) {}
    const { modal, loading, text, error, speakBtn } = this._els();
    if (!modal) return;
    this._currentText = '';
    if (text) text.textContent = '';
    if (error) error.textContent = '';
    if (loading) loading.hidden = false;
    if (speakBtn) speakBtn.hidden = true;
    this._forceShow(modal);
  },

  showResult(text) {
    try { console.log('[OcrResultUI] showResult length=', (text || '').length); } catch (_) {}
    const { modal, loading, text: textEl, error, speakBtn } = this._els();
    this._currentText = text;
    if (loading) loading.hidden = true;
    if (error) error.textContent = '';
    if (textEl) textEl.textContent = text;
    if (speakBtn) speakBtn.hidden = false;
    this._forceShow(modal);
    try { NavigationManager.announce('글자를 찾았습니다. 읽기 버튼을 눌러 들을 수 있습니다.'); } catch (_) {}
  },

  showError(message) {
    try { console.warn('[OcrResultUI] showError', message); } catch (_) {}
    const { modal, loading, text, error, speakBtn } = this._els();
    this._currentText = '';
    if (loading) loading.hidden = true;
    if (text) text.textContent = '';
    if (error) error.textContent = message;
    if (speakBtn) speakBtn.hidden = true;
    this._forceShow(modal);
    try { NavigationManager.announce(message); } catch (_) {}
    try { showToast(message); } catch (_) {}
  },

  speakCurrent() {
    if (!this._currentText) return;
    try { vib(); } catch (_) {}
    try { SpeechManager.speakFromUserAction(this._currentText); } catch (_) {}
  },

  hide() {
    const modal = document.getElementById('ocrResultModal');
    if (modal) {
      modal.hidden = true;
      modal.classList.remove('show');
      modal.style.display = 'none';
    }
    this._currentText = '';
    try { CameraManager.restartIfNeeded(); } catch (_) {}
  },

  isOpen() {
    const modal = document.getElementById('ocrResultModal');
    return !!(modal && !modal.hidden);
  }
};

// 안전망: Android 가 직접 호출하여 결과 모달을 강제로 표시한다.
// _complete / Promise 체인이 어떤 이유로든 모달을 띄우지 못해도 이 경로로 결과가 보장된다.
// 단, "촬영만" 한 경우(payload.photoPath 만 있고 text 없음)에는 모달을 띄우지 않는다.
window.__keugeForceShowResult = function (payload) {
  try { console.log('[KeugeOcr] __keugeForceShowResult', payload); } catch (_) {}
  if (!payload) return;
  try {
    if (payload.success && payload.text) {
      OcrResultUI.showResult(String(payload.text).trim());
      return;
    }
    // 촬영만 한 경우(text 없음 + photoPath 있음)는 OCR 결과가 아니므로 모달을 띄우지 않음.
    if (payload.success && payload.photoPath && !payload.text) return;

    if (!payload.success && window.__keugeExpectingOcrResult) {
      const code = payload.error || 'ocr_failed';
      const msg = (typeof CameraManager !== 'undefined' && CameraManager.mapOcrError)
        ? CameraManager.mapOcrError({ message: code })
        : '글자를 인식하지 못했습니다.';
      OcrResultUI.showError(msg);
    }
  } catch (e) {
    try { console.error('[KeugeOcr] __keugeForceShowResult error', e); } catch (_) {}
  }
};

// ═══════════════════════════════════════════
//   CAMERA & OCR MODULE
//   사용자 흐름:
//     [사진 찍기] 시스템 카메라 실행 → 촬영 → 사진 저장 + 미리보기 표시
//     [글자 읽기] 카메라를 다시 열지 않고 마지막 촬영 사진을 OCR → 결과 모달
//   _lastPhoto:
//     { previewDataUrl: string, runOcr: () => Promise<string> } | null
//   Android: 파일 경로 + base64 썸네일을 받아 보관
//   브라우저 fallback: <input type="file" capture> + 클라이언트 Canvas 보관
// ═══════════════════════════════════════════
const CameraManager = {
  // 호환용 필드 (기존 코드 참조 대비; 동작은 없음)
  stream: null,
  zoomScale: 1,
  contrastOn: false,
  captureStateValid: false,

  _lastPhoto: null,

  /** 카메라 화면 진입 시 호출. */
  start() {
    // 미리보기/저장된 사진은 화면 진입 시 초기화한다.
    this._clearLastPhoto();
    showToast('사진 찍기 버튼을 눌러 주세요');
  },

  /** 카메라 화면 이탈 시 호출. */
  stop() {
    this._clearLastPhoto();
  },

  /** 사진 찍기: 시스템 카메라 호출 → 파일 보존 + 미리보기 표시 (OCR 없음) */
  async capture() {
    vib([50, 30, 50]);
    try { console.log('[CameraManager] capture: native=', KeugeOcr.isNativeCameraAvailable()); } catch (_) {}
    if (KeugeOcr.isNativeCameraAvailable()) {
      try {
        const result = await KeugeOcr.startNativeCapture(false);
        try { console.log('[CameraManager] capture result', result); } catch (_) {}
        if (!result || !result.path) {
          showToast('촬영에 실패했습니다.');
          return;
        }
        this._setLastPhoto({
          previewDataUrl: result.previewDataUrl || '',
          runOcr: () => KeugeOcr.recognizeStoredImage(result.path)
        });
        showToast('촬영 완료! "글자 읽기"를 눌러 주세요');
        NavigationManager.announce('사진을 찍었습니다. 글자 읽기 버튼을 누르면 글자를 읽어 드립니다.');
      } catch (e) {
        if (e && e.message === 'cancelled') return;
        showToast(this.mapOcrError(e));
      }
      return;
    }
    // 브라우저 fallback
    this._launchFileInputForCapture();
  },

  /** 글자 읽기: 카메라를 열지 않고 마지막 촬영 사진에 OCR 수행. */
  async runOCR() {
    vib();
    try { console.log('[CameraManager] runOCR: hasLastPhoto=', !!this._lastPhoto); } catch (_) {}

    if (!this._lastPhoto) {
      showToast('먼저 사진을 찍어 주세요');
      NavigationManager.announce('먼저 사진을 찍어 주세요');
      return;
    }

    window.__keugeExpectingOcrResult = true;
    OcrResultUI.showLoading();
    NavigationManager.announce('글자를 읽는 중입니다. 잠시만 기다려 주세요.');

    try {
      const text = await this._lastPhoto.runOcr();
      try { console.log('[CameraManager] runOCR text length=', (text || '').length); } catch (_) {}
      if (!text) {
        OcrResultUI.showError('글자를 찾지 못했습니다. 더 밝은 곳에서 선명하게 다시 찍어 주세요.');
        return;
      }
      OcrResultUI.showResult(text);
      showToast('글자를 찾았습니다');
    } catch (e) {
      try { console.warn('[CameraManager] runOCR error', e); } catch (_) {}
      if (e && e.message === 'cancelled') { OcrResultUI.hide(); return; }
      OcrResultUI.showError(this.mapOcrError(e));
    } finally {
      window.__keugeExpectingOcrResult = false;
    }
  },

  /** 브라우저 fallback: 파일 입력으로 사진 받아 _lastPhoto 에 저장. */
  _launchFileInputForCapture() {
    const input = document.getElementById('nativeCameraInput');
    if (!input) {
      showToast('카메라를 사용할 수 없습니다.');
      return;
    }
    const handler = async () => {
      input.removeEventListener('change', handler);
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await this._storeBrowserPhoto(file);
    };
    input.addEventListener('change', handler);
    input.click();
  },

  async _storeBrowserPhoto(file) {
    const canvas = await this._fileToCanvas(file);
    if (!canvas || !canvas.width || !canvas.height) {
      showToast('사진을 불러오는 데 실패했습니다.');
      return;
    }
    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.7);
    this._setLastPhoto({
      previewDataUrl,
      runOcr: async () => {
        if (BrowserOcr.available()) {
          showToast('글자를 읽는 중...');
          return await BrowserOcr.recognize(canvas);
        }
        if (KeugeOcr.isNativeAvailable()) {
          return await KeugeOcr.recognizeCanvas(canvas);
        }
        throw new Error('no_bridge');
      }
    });
    vib([50, 30, 50]);
    showToast('촬영 완료! "글자 읽기"를 눌러 주세요');
  },

  _fileToCanvas(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  },

  _setLastPhoto(photo) {
    this._lastPhoto = photo;
    this._showPreview(photo.previewDataUrl);
  },

  _clearLastPhoto() {
    this._lastPhoto = null;
    this._hidePreview();
  },

  _showPreview(dataUrl) {
    const img = document.getElementById('capturedPreview');
    if (img && dataUrl) {
      img.src = dataUrl;
      img.hidden = false;
      img.style.display = 'block';
    }
    const hint = document.getElementById('nativeCameraHint');
    if (hint) hint.hidden = true;
  },

  _hidePreview() {
    const img = document.getElementById('capturedPreview');
    if (img) {
      img.removeAttribute('src');
      img.src = '';
      img.hidden = true;
      img.style.display = 'none';
    }
    const hint = document.getElementById('nativeCameraHint');
    if (hint) hint.hidden = false;
  },

  mapOcrError(error) {
    const code = error && error.message ? error.message : 'ocr_failed';
    if (code === 'no_bridge') return '앱에서만 글자 읽기를 사용할 수 있습니다.';
    if (code === 'no_native_camera') return '카메라를 사용할 수 없습니다.';
    if (code === 'no_camera_app') return '사진 촬영이 가능한 카메라 앱이 없습니다.';
    if (code === 'camera_launch_failed') return '카메라 앱을 여는 데 실패했습니다.';
    if (code === 'capture_failed') return '촬영에 실패했습니다. 다시 시도해 주세요.';
    if (code === 'tesseract_not_loaded') return '글자 읽기 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    if (code === 'cancelled') return '촬영을 취소했습니다.';
    if (code === 'timeout') return '글자 읽기 시간이 초과되었습니다. 다시 시도해 주세요.';
    if (code === 'empty_image' || code === 'invalid_image') return '사진을 다시 찍어 주세요.';
    if (code === 'empty_text') return '글자를 찾지 못했습니다. 더 선명하게 다시 찍어 주세요.';
    return '글자를 인식하지 못했습니다. 사진을 더 선명하게 찍어 주세요.';
  },

  // ── 기존 UI 핸들러 호환용 no-op들 ───────────────────────
  applyZoom() {},
  updateUI() {},
  updateCaptureButtonState() {},
  invalidateCaptureBuffer() {},
  pauseStream() {},
  restartIfNeeded() {},
  toggleContrast() {},
  showPermissionModal() {}
};

// ═══════════════════════════════════════════
//   DATA LOADER
// ═══════════════════════════════════════════
const MAX_MENU_RESULTS = 5;
const CATEGORIES = ['카페', '식당'];

const DataLoader = {
  getCandidateUrls() {
    const origin = window.location.origin;
    const baseHref = document.querySelector('base')?.getAttribute('href') || '/';
    const baseOrigin = new URL(baseHref, origin).origin;
    const pageDir = window.location.pathname.replace(/[^/]*$/, '');

    return [...new Set([
      '/data/brands.json',
      'data/brands.json',
      './data/brands.json',
      `${baseOrigin}/data/brands.json`,
      `${origin}${pageDir}data/brands.json`,
      new URL('data/brands.json', window.location.href).href
    ])];
  },

  validateBrands(data) {
    if (!data || typeof data !== 'object') return false;
    return CATEGORIES.every(cat => Array.isArray(data[cat]));
  },

  normalizeBrands(data) {
    const normalized = {};
    CATEGORIES.forEach(cat => {
      normalized[cat] = (data[cat] || [])
        .filter(brand => brand && brand.name)
        .map(brand => ({
          ...brand,
          name: String(brand.name),
          chosung: brand.chosung ? String(brand.chosung) : '',
          menus: Array.isArray(brand.menus) ? brand.menus.map(String) : []
        }));
    });
    return normalized;
  },

  getFallbackBrands() {
    return {
      "카페": [
        { "name": "스타벅스", "chosung": "ㅅㅌㅂㅅ", "menus": ["아메리카노", "카페라떼", "돌체라떼", "콜드브루", "자바칩프라푸치노"] },
        { "name": "투썸플레이스", "chosung": "ㅌㅆㅍㄹㅇㅅ", "menus": ["아메리카노", "카페라떼"] },
        { "name": "메가MGC커피", "chosung": "ㅁㄱMGCㅋㅍ", "menus": ["아메리카노", "큐브라떼"] },
        { "name": "이디야커피", "chosung": "ㅇㄷㅇㅋㅍ", "menus": ["아메리카노", "바닐라라떼"] },
        { "name": "빽다방", "chosung": "ㅂㄷㅂ", "menus": ["앗!메리카노", "원조커피"] }
      ],
      "식당": [
        { "name": "맥도날드", "chosung": "ㅁㄷㄴㄷ", "menus": ["빅맥", "맥너겟"] },
        { "name": "롯데리아", "chosung": "ㄹㄷㄹㅇ", "menus": ["불고기버거", "새우버거"] },
        { "name": "버거킹", "chosung": "ㅂㄱㅋ", "menus": ["와퍼", "치즈버거"] },
        { "name": "교촌치킨", "chosung": "ㄱㅊㅊㅋ", "menus": ["교촌오리지날", "허니콤보"] },
        { "name": "BBQ치킨", "chosung": "BBQㅊㅋ", "menus": ["황금올리브치킨", "양념치킨"] }
      ]
    };
  },

  logLoadFailure(errors, context) {
    console.error('[DataLoader] 데이터를 가져올 수 없습니다.', {
      context,
      pageUrl: window.location.href,
      triedUrls: errors
    });
  },

  async loadBrands() {
    AppState.brandsLoading = true;
    AppState.brandsLoadFailed = false;
    AppState.brandsLoadErrors = [];
    AppState.brandsSource = null;

    const errors = [];
    for (const url of this.getCandidateUrls()) {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
          errors.push(`${url} (HTTP ${response.status})`);
          continue;
        }

        const data = await response.json();
        if (!this.validateBrands(data)) {
          errors.push(`${url} (invalid JSON structure)`);
          continue;
        }

        AppState.brands = this.normalizeBrands(data);
        AppState.brandsSource = url;
        AppState.brandsLoading = false;
        return true;
      } catch (e) {
        errors.push(`${url} (${e.message || e})`);
      }
    }

    AppState.brandsLoadErrors = errors;
    AppState.brandsLoadFailed = true;
    AppState.brands = this.normalizeBrands(this.getFallbackBrands());
    AppState.brandsSource = 'fallback';
    AppState.brandsLoading = false;
    this.logLoadFailure(errors, 'all fetch attempts failed');
    return false;
  }
};

// ═══════════════════════════════════════════
//   DATA HELPERS
// ═══════════════════════════════════════════
const DataHelper = {
  getCategoryBrands(cat) {
    if (!AppState.brands || !AppState.brands[cat]) return [];
    return AppState.brands[cat].map(b => ({ ...b, cat }));
  },

  getAllBrands() {
    if (!AppState.brands) return [];
    return CATEGORIES.flatMap(cat =>
      (AppState.brands[cat] || []).map(b => ({ ...b, cat }))
    );
  },

  getBrandMenus(brand, limit = MAX_MENU_RESULTS) {
    return (brand.menus || []).slice(0, limit);
  },

  groupByCategory(items) {
    const grouped = Object.fromEntries(CATEGORIES.map(cat => [cat, []]));
    items.forEach(item => {
      if (grouped[item.cat]) grouped[item.cat].push(item);
    });
    return grouped;
  }
};

// ═══════════════════════════════════════════
//   SEARCH MODULE
// ═══════════════════════════════════════════
const SearchManager = {
  doSearch(query) {
    const q = query.trim();
    if (!q) {
      NavigationManager.announce('검색어를 입력해 주세요');
      return;
    }
    vib();

    AppState.recentSearches = AppState.recentSearches.filter(s => s !== q);
    AppState.recentSearches.unshift(q);
    AppState.recentSearches = AppState.recentSearches.slice(0, 5);
    AppState.save();

    NavigationManager.announce('검색 중입니다.');

    const results = [];
    const allBrands = DataHelper.getAllBrands();

    const qChosung = this.getChosung(q);
    const isChosungQuery = [...q].every(ch => 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.includes(ch));

    allBrands.forEach(brand => {
      const nameMatch = brand.name.includes(q);
      const brandChosung = this.getChosung(brand.name);
      const chosungMatch = (brand.chosung && brand.chosung.includes(q)) || brandChosung.includes(q) || (isChosungQuery && brandChosung.startsWith(qChosung));
      const menuMatch = brand.menus.some(m => m.includes(q) || this.getChosung(m).includes(q));
      if (nameMatch || chosungMatch || menuMatch) results.push(brand);
    });

    const grouped = DataHelper.groupByCategory(results);
    UI.renderBrandList(grouped, `"${q}" 검색 결과`, { grouped: true });
    
    const bc = document.getElementById('resultsBreadcrumb');
    if (bc) bc.innerHTML = `<span>홈</span><span>검색</span><span aria-current="location">결과</span>`;

    NavigationManager.gotoScreen('results');
  },

  getChosung(str) {
    const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    return [...str].map(c => {
      const code = c.charCodeAt(0) - 0xAC00;
      if (code < 0 || code > 11171) return c;
      return CHO[Math.floor(code / 28 / 21)];
    }).join('');
  }
};

// ═══════════════════════════════════════════
//   UI RENDER MODULE
// ═══════════════════════════════════════════
