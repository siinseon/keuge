/**
 * 크크봄 - 접근성 중심 메뉴 사진 읽기 도우미
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
    const fs = document.getElementById('previewFullscreen');
    if (fs && fs.classList.contains('is-open') && typeof MenuPreviewZoom !== 'undefined') {
      MenuPreviewZoom.close();
      return;
    }
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
      'camera': '메뉴 사진 읽기 화면입니다. 메뉴 사진 선택 버튼을 눌러 주세요.',
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
window.__keugeShowMenuPreview = function (dataUrl) {
  try {
    console.log('[OCR] native preview callback');
    if (typeof CameraManager !== 'undefined' && typeof CameraManager._showPreview === 'function') {
      CameraManager._showPreview(dataUrl);
    }
  } catch (e) {
    try { console.warn('[KeugeOcr] __keugeShowMenuPreview failed', e); } catch (_) {}
  }
};

const KeugeOcr = {
  _pending: {},
  _pickPending: {},
  _timeoutMs: 120000,

  init() {
    window.KeugeOcr = this;
  },

  isNativeAvailable() {
    return this.isNativeImagePickerAvailable() ||
      !!(window.Android && typeof window.Android.recognizeTextFromBase64 === 'function');
  },

  isNativeImagePickerAvailable() {
    return !!(window.Android && typeof window.Android.selectMenuImage === 'function');
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

  /** 갤러리 선택만 (미리보기·버튼 활성화, OCR 없음) */
  pickMenuImage() {
    return new Promise((resolve, reject) => {
      if (!this.isNativeImagePickerAvailable()) {
        reject(new Error('no_image_picker'));
        return;
      }

      const requestId = 'pick_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (!this._pickPending[requestId]) return;
        delete this._pickPending[requestId];
        try { console.warn('[KeugeOcr] pick timeout', requestId); } catch (_) {}
        reject(new Error('timeout'));
      }, this._timeoutMs);

      this._pickPending[requestId] = { resolve, reject, timer };
      try { console.log('[OCR] pickMenuImage start', { requestId }); } catch (_) {}

      try {
        window.Android.selectMenuImage(requestId);
      } catch (e) {
        clearTimeout(timer);
        delete this._pickPending[requestId];
        reject(e);
      }
    });
  },

  _imagePicked(payload) {
    try { console.log('[OCR] image picked payload', payload); } catch (_) {}
    if (!payload || !payload.requestId) return;
    const pending = this._pickPending[payload.requestId];
    if (!pending) {
      try { console.warn('[OCR] image picked: no pending', payload.requestId); } catch (_) {}
      return;
    }
    clearTimeout(pending.timer);
    delete this._pickPending[payload.requestId];
    if (payload.success) {
      pending.resolve(payload.requestId);
      return;
    }
    pending.reject(new Error(payload.error || 'cancelled'));
  },

  /** 미리보기 data URL(base64)로 ML Kit OCR — URI 권한 문제 회피 */
  recognizeFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        reject(new Error('empty_image'));
        return;
      }
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      if (!base64) {
        reject(new Error('empty_image'));
        return;
      }
      if (!(window.Android && typeof window.Android.recognizeTextFromBase64 === 'function')) {
        reject(new Error('no_bridge'));
        return;
      }

      const requestId = 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        reject(new Error('timeout'));
      }, this._timeoutMs);

      this._pending[requestId] = { resolve, reject, timer };
      try { console.log('[OCR] recognizeFromDataUrl start', { requestId, base64Len: base64.length }); } catch (_) {}

      try {
        window.Android.recognizeTextFromBase64(requestId, base64);
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[requestId];
        reject(e);
      }
    });
  },

  /** 선택된 사진 URI로 ML Kit OCR (fallback) */
  recognizePickedImage() {
    return new Promise((resolve, reject) => {
      const hasRecognize = !!(window.Android && typeof window.Android.recognizeMenuImage === 'function');
      if (!hasRecognize) {
        reject(new Error('no_image_picker'));
        return;
      }

      const requestId = 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        reject(new Error('timeout'));
      }, this._timeoutMs);

      this._pending[requestId] = { resolve, reject, timer };
      try { console.log('[OCR] recognizePickedImage start', { requestId }); } catch (_) {}

      try {
        window.Android.recognizeMenuImage(requestId);
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[requestId];
        reject(e);
      }
    });
  },

  /** @deprecated pickMenuImage + recognizePickedImage 사용 */
  selectMenuImage() {
    return this.pickMenuImage().then(() => this.recognizePickedImage());
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
      + '  <button id="ocrSpeakBtn" type="button" hidden style="background:#2563EB;color:#fff;border:none;border-radius:12px;min-height:56px;font-size:18px;font-weight:800;">읽어주기</button>'
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
// 단, text 없는 성공 payload 에는 모달을 띄우지 않는다.
window.__keugeForceShowResult = function (payload) {
  try { console.log('[KeugeOcr] __keugeForceShowResult', payload); } catch (_) {}
  if (!payload) return;
  try {
    if (window.KeugeOcr && typeof window.KeugeOcr._complete === 'function') {
      window.KeugeOcr._complete(payload);
    }
  } catch (e) {
    try { console.error('[KeugeOcr] forceShow _complete error', e); } catch (_) {}
  }
  if (!window.__keugeExpectingOcrResult) return;
  try {
    if (payload.success && payload.text) {
      OcrResultUI.showResult(String(payload.text).trim());
      return;
    }
    if (payload.success && !payload.text) return;

    if (!payload.success) {
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
//   MENU PHOTO PREVIEW (large + fullscreen pinch)
// ═══════════════════════════════════════════
const MenuPreviewZoom = {
  _boundMain: false,
  _boundFullscreen: false,
  _scale: 1,
  _translateX: 0,
  _translateY: 0,
  _pinchStartDist: 0,
  _pinchStartScale: 1,
  _lastTouchX: 0,
  _lastTouchY: 0,
  _panning: false,

  init() {
    const closeBtn = document.getElementById('previewFullscreenClose');
    const overlay = document.getElementById('previewFullscreen');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });
    }
    this.bindMainImage();
  },

  bindMainImage() {
    if (this._boundMain) return;
    const img = document.getElementById('capturedPreview');
    if (!img) return;
    this._boundMain = true;
    const open = () => {
      if (!img.src) return;
      this.open(img.src);
    };
    img.addEventListener('click', open);
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  },

  _applyTransform(img) {
    if (!img) return;
    img.style.transform =
      'translate(' + this._translateX + 'px,' + this._translateY + 'px) scale(' + this._scale + ')';
  },

  _resetTransform() {
    this._scale = 1;
    this._translateX = 0;
    this._translateY = 0;
    const img = document.getElementById('previewFullscreenImg');
    this._applyTransform(img);
  },

  _touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  },

  _bindFullscreenGestures() {
    if (this._boundFullscreen) return;
    const stage = document.getElementById('previewFullscreenStage');
    const img = document.getElementById('previewFullscreenImg');
    if (!stage || !img) return;
    this._boundFullscreen = true;

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this._pinchStartDist = this._touchDistance(e.touches);
        this._pinchStartScale = this._scale;
      } else if (e.touches.length === 1 && this._scale > 1) {
        this._panning = true;
        this._lastTouchX = e.touches[0].clientX;
        this._lastTouchY = e.touches[0].clientY;
      }
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this._pinchStartDist > 0) {
        e.preventDefault();
        const dist = this._touchDistance(e.touches);
        const next = (this._pinchStartScale * dist) / this._pinchStartDist;
        this._scale = Math.min(4, Math.max(1, next));
        this._applyTransform(img);
      } else if (e.touches.length === 1 && this._panning) {
        e.preventDefault();
        const dx = e.touches[0].clientX - this._lastTouchX;
        const dy = e.touches[0].clientY - this._lastTouchY;
        this._lastTouchX = e.touches[0].clientX;
        this._lastTouchY = e.touches[0].clientY;
        this._translateX += dx;
        this._translateY += dy;
        this._applyTransform(img);
      }
    }, { passive: false });

    const end = () => {
      this._pinchStartDist = 0;
      this._panning = false;
      if (this._scale < 1) {
        this._resetTransform();
      }
    };
    stage.addEventListener('touchend', end, { passive: true });
    stage.addEventListener('touchcancel', end, { passive: true });

    img.addEventListener('dblclick', () => {
      if (this._scale > 1) this._resetTransform();
      else {
        this._scale = 2;
        this._applyTransform(img);
      }
    });
  },

  open(src) {
    const overlay = document.getElementById('previewFullscreen');
    const img = document.getElementById('previewFullscreenImg');
    if (!overlay || !img || !src) return;
    this._bindFullscreenGestures();
    this._resetTransform();
    img.src = src;
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    vib([20]);
    NavigationManager.announce('메뉴 사진을 크게 보여 드립니다. 두 손가락으로 확대할 수 있습니다.');
  },

  close() {
    const overlay = document.getElementById('previewFullscreen');
    const img = document.getElementById('previewFullscreenImg');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    if (img) {
      img.removeAttribute('src');
      img.src = '';
    }
    document.body.style.overflow = '';
    this._resetTransform();
  }
};

// ═══════════════════════════════════════════
//   PHOTO PICKER & OCR MODULE
//   사용자 흐름:
//     [메뉴 사진 선택] → 미리보기 → [읽어주기] → OCR → 결과 모달
//     [읽어주기] (OCR 완료 후) 마지막 결과 TTS 재생
// ═══════════════════════════════════════════
const CameraManager = {
  // 호환용 필드 (기존 코드 참조 대비; 동작은 없음)
  stream: null,
  zoomScale: 1,
  contrastOn: false,
  captureStateValid: false,

  imageLoaded: false,
  ocrImageReady: false,
  _previewDataUrl: null,
  _ocrCanvas: null,
  _nativePickRequestId: null,
  _lastText: '',

  /** 메뉴 사진 읽기 화면 진입 시 호출. */
  start() {
    this._clearSelection();
    showToast('메뉴 사진을 선택해 주세요');
  },

  /** 화면 이탈 시 호출. */
  stop() {
    this._clearSelection();
  },

  _logOcrState(step) {
    const btn = document.getElementById('ocrBtn');
    try {
      console.log('[OCR]', step, {
        imageLoaded: this.imageLoaded,
        ocrImageReady: this.ocrImageReady,
        hasPreviewDataUrl: !!this._previewDataUrl,
        hasOcrCanvas: !!(this._ocrCanvas && this._ocrCanvas.width),
        nativePickRequestId: this._nativePickRequestId,
        lastTextLen: (this._lastText || '').length,
        readButtonDisabled: btn ? btn.disabled : null
      });
      if (btn) console.log('[OCR] read button enabled', !btn.disabled);
    } catch (_) {}
  },

  /** 메뉴 사진 선택: 미리보기만 (OCR은 [읽어주기]에서 실행). */
  async capture() {
    vib([50, 30, 50]);
    this._clearSelection();
    try { console.log('[OCR] capture start, native=', KeugeOcr.isNativeImagePickerAvailable()); } catch (_) {}
    if (KeugeOcr.isNativeImagePickerAvailable()) {
      try {
        const pickId = await KeugeOcr.pickMenuImage();
        this._nativePickRequestId = pickId;
        console.log('[OCR] image selected (native)', pickId);
        this._logOcrState('after-native-pick');
      } catch (e) {
        try { console.warn('[OCR] pick failed', e); } catch (_) {}
        if (e && e.message !== 'cancelled') {
          showToast('사진 선택에 실패했습니다.');
        }
      }
      return;
    }
    this._launchFileInput();
  },

  /** 읽어주기: OCR 실행 또는 완료된 결과 TTS 재생. */
  async runOCR() {
    const btn = document.getElementById('ocrBtn');
    try {
      console.log('[OCR] runOCR clicked', {
        readButtonDisabled: btn ? btn.disabled : null,
        imageLoaded: this.imageLoaded,
        ocrImageReady: this.ocrImageReady,
        hasLastText: !!this._lastText
      });
    } catch (_) {}

    if (this._lastText) {
      this.speakLastResult();
      return;
    }

    if (!this.ocrImageReady) {
      try { console.warn('[OCR] runOCR blocked: ocrImageReady=false (image state not set)'); } catch (_) {}
      showToast('먼저 메뉴 사진을 선택해 주세요');
      NavigationManager.announce('먼저 메뉴 사진을 선택해 주세요');
      return;
    }

    vib([50, 30, 50]);

    if (window.Android && typeof window.Android.recognizeMenuImage === 'function') {
      try { console.log('[OCR] runOCR via recognizeMenuImage (cached file)'); } catch (_) {}
      await this._runOcr(() => KeugeOcr.recognizePickedImage());
      return;
    }

    if (this._ocrCanvas) {
      await this._runOcr(async () => {
        if (BrowserOcr.available()) {
          return await BrowserOcr.recognize(this._ocrCanvas);
        }
        if (KeugeOcr.isNativeAvailable()) {
          return await KeugeOcr.recognizeCanvas(this._ocrCanvas);
        }
        throw new Error('no_bridge');
      });
      return;
    }

    if (this._previewDataUrl && window.Android && typeof window.Android.recognizeTextFromBase64 === 'function') {
      try {
        console.log('[OCR] runOCR via compressed base64 fallback');
        const compressed = await this._compressDataUrlForOcr(this._previewDataUrl);
        await this._runOcr(() => KeugeOcr.recognizeFromDataUrl(compressed));
      } catch (e) {
        try { console.warn('[OCR] compress/base64 OCR failed', e); } catch (_) {}
        showToast('글자 읽기에 실패했습니다.');
      }
      return;
    }

    try { console.warn('[OCR] runOCR blocked: no OCR path available'); } catch (_) {}
    showToast('사진을 다시 선택해 주세요');
  },

  speakLastResult() {
    vib();
    if (!this._lastText) {
      showToast('먼저 메뉴 사진을 선택해 주세요');
      NavigationManager.announce('먼저 메뉴 사진을 선택해 주세요');
      return;
    }
    SpeechManager.speakFromUserAction(this._lastText);
  },

  async _runOcr(getText) {
    window.__keugeExpectingOcrResult = true;
    window.__keugeLastOcrPayload = null;
    OcrResultUI.showLoading();
    NavigationManager.announce('사진 속 글자를 읽는 중입니다. 잠시만 기다려 주세요.');

    const pollInterval = setInterval(() => {
      const p = window.__keugeLastOcrPayload;
      if (!p || !p.requestId || !window.__keugeExpectingOcrResult) return;
      if (KeugeOcr._pending[p.requestId]) {
        try { console.log('[OCR] poll delivering payload for', p.requestId); } catch (_) {}
        KeugeOcr._complete(p);
      }
    }, 500);

    const ocrTimeoutMs = 95000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ocrTimeoutMs);
    });

    try {
      const text = await Promise.race([getText(), timeoutPromise]);
      try { console.log('[CameraManager] OCR text length=', (text || '').length); } catch (_) {}
      if (!text) {
        OcrResultUI.showError('사진에서 글자를 찾지 못했습니다. 글자가 더 잘 보이는 사진을 선택해 주세요.');
        return;
      }
      this._setLastText(text);
      OcrResultUI.showResult(text);
      showToast('글자를 찾았습니다');
    } catch (e) {
      try { console.warn('[CameraManager] OCR error', e); } catch (_) {}
      const late = window.__keugeLastOcrPayload;
      if (late && late.requestId && KeugeOcr._pending[late.requestId]) {
        try { console.log('[OCR] applying late payload after error', late.requestId); } catch (_) {}
        KeugeOcr._complete(late);
        const text = late.success && late.text ? String(late.text).trim() : '';
        if (text) {
          this._setLastText(text);
          OcrResultUI.showResult(text);
          showToast('글자를 찾았습니다');
          return;
        }
      }
      if (e && e.message === 'cancelled') { OcrResultUI.hide(); return; }
      OcrResultUI.showError(this.mapOcrError(e));
    } finally {
      clearInterval(pollInterval);
      window.__keugeExpectingOcrResult = false;
    }
  },

  /** 브라우저 fallback: 파일 입력으로 사진을 받은 뒤 즉시 OCR. */
  _launchFileInput() {
    const input = document.getElementById('menuPhotoInput');
    if (!input) {
      showToast('사진 선택을 사용할 수 없습니다.');
      return;
    }
    const handler = async () => {
      input.removeEventListener('change', handler);
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await this._handleBrowserFile(file);
    };
    input.addEventListener('change', handler);
    input.click();
  },

  _compressDataUrlForOcr(dataUrl) {
    const maxWidth = 1280;
    const quality = 0.75;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error('empty_image'));
          return;
        }
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('empty_image'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('invalid_image'));
      img.src = dataUrl;
    });
  },

  async _handleBrowserFile(file) {
    const canvas = await this._fileToCanvas(file);
    if (!canvas || !canvas.width || !canvas.height) {
      showToast('사진을 불러오는 데 실패했습니다.');
      return;
    }
    this._ocrCanvas = canvas;
    console.log('[OCR] image selected (browser)', { w: canvas.width, h: canvas.height });
    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    this._showPreview(previewDataUrl);
    this._logOcrState('after-browser-pick');
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

  _setLastText(text) {
    this._lastText = text;
    this._setSpeakButtonEnabled(true);
    this._logOcrState('ocr-text-set');
  },

  _clearSelection() {
    this._lastText = '';
    this._previewDataUrl = null;
    this._ocrCanvas = null;
    this._nativePickRequestId = null;
    this.imageLoaded = false;
    this.ocrImageReady = false;
    this._hidePreview();
    this._setSpeakButtonEnabled(false);
    this._logOcrState('selection-cleared');
  },

  _setImageReady(ready, reason) {
    this.imageLoaded = ready;
    this.ocrImageReady = ready;
    this._setSpeakButtonEnabled(ready || !!this._lastText);
    try { console.log('[OCR] image ready=', ready, 'reason=', reason); } catch (_) {}
    this._logOcrState('set-image-ready:' + reason);
  },

  _showPreview(dataUrl) {
    if (!dataUrl) return;
    this._previewDataUrl = dataUrl;
    const img = document.getElementById('capturedPreview');
    const container = document.getElementById('previewContainer');
    const screen = document.getElementById('screen-camera');
    if (img) {
      img.src = dataUrl;
      img.hidden = false;
    }
    if (container) {
      container.hidden = false;
      container.classList.add('is-visible');
    }
    if (screen) screen.classList.add('has-menu-preview');
    MenuPreviewZoom.bindMainImage();
    try { console.log('[OCR] preview rendered'); } catch (_) {}
    this._setImageReady(true, 'preview-rendered');
  },

  _hidePreview() {
    MenuPreviewZoom.close();
    const img = document.getElementById('capturedPreview');
    const container = document.getElementById('previewContainer');
    const screen = document.getElementById('screen-camera');
    if (img) {
      img.removeAttribute('src');
      img.src = '';
      img.hidden = true;
    }
    if (container) {
      container.hidden = true;
      container.classList.remove('is-visible');
    }
    if (screen) screen.classList.remove('has-menu-preview');
  },

  _setSpeakButtonEnabled(enabled) {
    const btn = document.getElementById('ocrBtn');
    if (!btn) {
      try { console.warn('[OCR] ocrBtn not found'); } catch (_) {}
      return;
    }
    const wasDisabled = btn.disabled;
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (wasDisabled !== btn.disabled) {
      try {
        console.log('[OCR] read button enabled', !btn.disabled, {
          reason: enabled ? 'enabled' : 'disabled',
          imageLoaded: this.imageLoaded,
          ocrImageReady: this.ocrImageReady
        });
      } catch (_) {}
    }
  },

  mapOcrError(error) {
    const code = error && error.message ? error.message : 'ocr_failed';
    if (code === 'no_bridge') return '앱에서만 글자 읽기를 사용할 수 있습니다.';
    if (code === 'no_image_picker') return '사진 선택을 사용할 수 없습니다.';
    if (code === 'tesseract_not_loaded') return '글자 읽기 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    if (code === 'cancelled') return '사진 선택을 취소했습니다.';
    if (code === 'timeout') return '글자 읽기 시간이 초과되었습니다. 다시 시도해 주세요.';
    if (code === 'empty_image' || code === 'invalid_image') return '사진을 다시 선택해 주세요.';
    if (code === 'empty_text') return '사진에서 글자를 찾지 못했습니다. 글자가 선명한 사진을 선택해 주세요.';
    return '글자를 인식하지 못했습니다. 메뉴 글자가 잘 보이는 사진을 선택해 주세요.';
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
