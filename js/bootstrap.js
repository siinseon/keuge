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
  _timeoutMs: 30000,

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
    if (!payload || !payload.requestId) return;
    const pending = this._pending[payload.requestId];
    if (!pending) return;

    clearTimeout(pending.timer);
    delete this._pending[payload.requestId];

    if (payload.success) {
      if (pending.captureOnly) {
        pending.resolve('');
        return;
      }
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

      const requestId = 'ocr_' + Date.now();
      const timer = setTimeout(() => {
        if (!this._pending[requestId]) return;
        delete this._pending[requestId];
        reject(new Error('timeout'));
      }, this._timeoutMs);

      this._pending[requestId] = { resolve, reject, timer, captureOnly: !runOcr };

      try {
        window.Android.captureAndRecognize(requestId, runOcr ? 'true' : 'false');
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

  _els() {
    return {
      modal: document.getElementById('ocrResultModal'),
      loading: document.getElementById('ocrLoading'),
      text: document.getElementById('ocrResultText'),
      error: document.getElementById('ocrErrorMsg'),
      speakBtn: document.getElementById('ocrSpeakBtn')
    };
  },

  showLoading() {
    const { modal, loading, text, error, speakBtn } = this._els();
    if (!modal) return;
    this._currentText = '';
    if (text) text.textContent = '';
    if (error) error.textContent = '';
    if (loading) loading.hidden = false;
    if (speakBtn) speakBtn.hidden = true;
    modal.hidden = false;
    modal.classList.add('show');
  },

  showResult(text) {
    const { loading, text: textEl, error, speakBtn } = this._els();
    this._currentText = text;
    if (loading) loading.hidden = true;
    if (error) error.textContent = '';
    if (textEl) textEl.textContent = text;
    if (speakBtn) speakBtn.hidden = false;
    NavigationManager.announce('글자를 찾았습니다. 읽기 버튼을 눌러 들을 수 있습니다.');
  },

  showError(message) {
    const { loading, text, error, speakBtn } = this._els();
    this._currentText = '';
    if (loading) loading.hidden = true;
    if (text) text.textContent = '';
    if (error) error.textContent = message;
    if (speakBtn) speakBtn.hidden = true;
    NavigationManager.announce(message);
    showToast(message);
  },

  speakCurrent() {
    if (!this._currentText) return;
    vib();
    SpeechManager.speakFromUserAction(this._currentText);
  },

  hide() {
    const { modal } = this._els();
    if (modal) {
      modal.hidden = true;
      modal.classList.remove('show');
    }
    this._currentText = '';
    CameraManager.restartIfNeeded();
  },

  isOpen() {
    const modal = document.getElementById('ocrResultModal');
    return !!(modal && !modal.hidden);
  }
};

// ═══════════════════════════════════════════
//   CAMERA & OCR MODULE
// ═══════════════════════════════════════════
const CameraManager = {
  stream: null,
  zoomScale: 1,
  contrastOn: false,
  zoomTimer: null,
  contrastTimer: null,
  captureStateValid: false,
  _boundVideoReady: null,

  _frameReadyForCapture(video) {
    // NOTE: 모바일 Chrome/WebView에서 영상이 정상 표시되는데도 currentTime이
    // 0으로 남는 경우가 있어 캡처 진입이 차단되므로 currentTime 조건을 제거함.
    return !!(
      video &&
      this.stream &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    );
  },

  updateCaptureButtonState() {
    const video = document.getElementById('cameraVideo');
    const btn = document.getElementById('captureBtn');
    if (!btn) return;
    const ok = this._frameReadyForCapture(video);
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  },

  _bindVideoReadyListeners(video) {
    if (!video) return;
    const evs = ['loadedmetadata', 'loadeddata', 'playing', 'canplay', 'timeupdate'];
    if (this._boundVideoReady) {
      evs.forEach(ev => {
        video.removeEventListener(ev, this._boundVideoReady);
      });
    }
    this._boundVideoReady = () => this.updateCaptureButtonState();
    evs.forEach(ev => {
      video.addEventListener(ev, this._boundVideoReady, { passive: true });
    });
  },

  _unbindVideoReadyListeners() {
    const video = document.getElementById('cameraVideo');
    if (!video || !this._boundVideoReady) return;
    ['loadedmetadata', 'loadeddata', 'playing', 'canplay', 'timeupdate'].forEach(ev => {
      video.removeEventListener(ev, this._boundVideoReady);
    });
    this._boundVideoReady = null;
  },

  invalidateCaptureBuffer() {
    this.captureStateValid = false;
    const canvas = document.getElementById('capturedCanvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  },

  /** 모바일: 다음 디코드된 프레임 시점까지 대기(지원 시) */
  _waitVideoFrame(video) {
    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      try {
        video.requestVideoFrameCallback(() => resolve());
      } catch (e) {
        resolve();
      }
    });
  },

  _showCameraFallback(video, noSupport) {
    if (video) video.style.display = 'none';
    if (noSupport) noSupport.style.display = 'flex';
  },

  _enterNativeCameraMode() {
    document.documentElement.classList.add('native-camera-mode');
    const video = document.getElementById('cameraVideo');
    if (video) video.style.display = 'none';
    const hint = document.getElementById('nativeCameraHint');
    if (hint) hint.hidden = false;
    const noSupport = document.getElementById('cameraNoSupport');
    if (noSupport) noSupport.style.display = 'none';
    const overlay = document.getElementById('capturedOverlay');
    if (overlay) overlay.classList.remove('show');
    const btn = document.getElementById('captureBtn');
    if (btn) {
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
    }
    showToast('사진 찍기·글자 읽기를 눌러 주세요');
  },

  _exitNativeCameraMode() {
    document.documentElement.classList.remove('native-camera-mode');
    const hint = document.getElementById('nativeCameraHint');
    if (hint) hint.hidden = true;
  },

  async start() {
    if (KeugeOcr.isNativeCameraAvailable()) {
      this._enterNativeCameraMode();
      return;
    }

    const video = document.getElementById('cameraVideo');
    const noSupport = document.getElementById('cameraNoSupport');

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showToast('카메라를 사용할 수 없습니다.');
      this._showCameraFallback(video, noSupport);
      this.updateCaptureButtonState();
      return;
    }

    showToast('카메라 준비 중입니다...');
    const requestCameraStream = async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (firstErr) {
        const fallback =
          firstErr &&
          (firstErr.name === 'OverconstrainedError' ||
            firstErr.name === 'ConstraintNotSatisfiedError' ||
            firstErr.name === 'NotFoundError');
        if (!fallback) throw firstErr;
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    };

    try {
      this.stream = await requestCameraStream();
    } catch (err) {
      this._showCameraFallback(video, noSupport);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        this.showPermissionModal();
      }
      showToast('카메라 준비 중 오류입니다.');
      this.updateCaptureButtonState();
      return;
    }

    if (!video) {
      this.stop();
      return;
    }

    video.srcObject = this.stream;
    video.style.display = 'block';
    if (noSupport) noSupport.style.display = 'none';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    this._bindVideoReadyListeners(video);

    try {
      await video.play();
    } catch (e) {
      this._showCameraFallback(video, noSupport);
      showToast('카메라 준비 중입니다. 잠시 후 다시 열어 주세요.');
      this.updateCaptureButtonState();
      return;
    }

    await this._waitVideoFrame(video);
    this.updateCaptureButtonState();
    await this.applyZoom();
  },

  showPermissionModal() {
    let modal = document.getElementById('cameraPermModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cameraPermModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-title">카메라 권한 필요</div>
          <div class="modal-desc">카메라 권한을 허용해야 돋보기를 사용할 수 있습니다.</div>
          <button class="modal-btn" onclick="document.getElementById('cameraPermModal').remove()">확인</button>
        </div>`;
      document.body.appendChild(modal);
    }
  },

  stop() {
    this._exitNativeCameraMode();
    this._unbindVideoReadyListeners();
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (e) {}
        });
      } catch (e) {}
      this.stream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) {
      video.srcObject = null;
      video.style.transform = '';
      video.style.filter = '';
    }
    const overlay = document.getElementById('capturedOverlay');
    if (overlay) overlay.classList.remove('show');
    this.invalidateCaptureBuffer();
    this.zoomScale = 1;
    this.contrastOn = false;
    this.updateUI();
    this.updateCaptureButtonState();
  },

  async applyZoom() {
    const video = document.getElementById('cameraVideo');
    if (!video) return;

    if (this.stream) {
      const tracks = this.stream.getVideoTracks();
      const track = tracks && tracks[0];
      if (track && typeof track.getCapabilities === 'function') {
        try {
          const caps = track.getCapabilities();
          if (caps && caps.zoom) {
            const nativeZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, this.zoomScale));
            await track.applyConstraints({ advanced: [{ zoom: nativeZoom }] });
            video.style.transform = '';
            return;
          }
        } catch (e) {}
      }
    }
    video.style.transform = `scale(${this.zoomScale})`;
  },

  updateUI() {
    requestAnimationFrame(() => {
      const val = this.zoomScale.toFixed(1).replace('.0', '') + '×';
      const zoomValue = document.getElementById('zoomValue');
      const ind = document.getElementById('zoomIndicator');
      if (zoomValue) zoomValue.textContent = val;
      if (!ind) return;
      ind.textContent = '확대 ' + val;
      ind.classList.add('show');
      clearTimeout(this.zoomTimer);
      this.zoomTimer = setTimeout(() => ind.classList.remove('show'), 1800);
    });
  },

  toggleContrast() {
    vib([30, 20, 30]);
    this.contrastOn = !this.contrastOn;
    const video = document.getElementById('cameraVideo');
    if (video) {
      video.style.filter = this.contrastOn ? 'contrast(2.5) brightness(1.1)' : '';
    }
    const btn = document.getElementById('contrastBtn');
    if (btn) {
      btn.classList.toggle('active-contrast', this.contrastOn);
      btn.setAttribute('aria-pressed', String(this.contrastOn));
    }

    const ind = document.getElementById('contrastIndicator');
    if (ind) {
      ind.textContent = this.contrastOn ? '대비 강화 ON' : '대비 강화 OFF';
      ind.classList.add('show');
      clearTimeout(this.contrastTimer);
      this.contrastTimer = setTimeout(() => ind.classList.remove('show'), 1800);
    }
    showToast(this.contrastOn ? '대비 강화 켜짐' : '대비 강화 꺼짐');
  },

  async capture() {
    // DEBUG: 모바일 캡처 진입 확인용 임시 alert (확인 후 제거 예정)
    alert('capture entered');
    vib([50, 30, 50]);

    if (KeugeOcr.isNativeCameraAvailable()) {
      try {
        await KeugeOcr.startNativeCapture(false);
        showToast('촬영 완료!');
      } catch (e) {
        if (e && e.message !== 'cancelled') {
          showToast('촬영에 실패했습니다.');
        }
      }
      return;
    }

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('capturedCanvas');
    const overlay = document.getElementById('capturedOverlay');
    const flash = document.getElementById('flashOverlay');

    // DEBUG: 모바일 캡처 차단 원인 진단용 로그 (확인 후 제거 예정)
    console.log('[capture] video state', {
      readyState: video ? video.readyState : null,
      videoWidth: video ? video.videoWidth : null,
      videoHeight: video ? video.videoHeight : null,
      currentTime: video ? video.currentTime : null,
      hasStream: !!this.stream
    });

    if (!this.stream || !video || !this._frameReadyForCapture(video)) {
      const input = document.getElementById('nativeCameraInput');
      if (input) {
        const onFileChange = async () => {
          input.removeEventListener('change', onFileChange);
          const file = input.files && input.files[0];
          if (!file) return;
          input.value = '';
          await this._processPhotoFile(file);
        };
        input.addEventListener('change', onFileChange);
        input.click();
        return;
      }
      showToast('카메라 준비 중입니다. 잠시 후 다시 눌러 주세요.');
      return;
    }

    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    await this._waitVideoFrame(video);

    const v = document.getElementById('cameraVideo');
    if (!this.stream || !v || !this._frameReadyForCapture(v)) {
      showToast('프레임이 없습니다.');
      return;
    }

    if (!canvas) {
      showToast('캡처에 실패했습니다.');
      return;
    }

    const vw = v.videoWidth;
    const vh = v.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    if (vw < 1 || vh < 1 || canvas.width < 1 || canvas.height < 1) {
      this.invalidateCaptureBuffer();
      showToast('프레임이 없습니다.');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      showToast('캡처에 실패했습니다.');
      return;
    }

    ctx.filter = this.contrastOn ? 'contrast(2.5) brightness(1.1)' : 'none';
    // DEBUG: drawImage 호출 직전 확인 (확인 후 제거 예정)
    alert('drawImage start');
    try {
      ctx.drawImage(v, 0, 0, vw, vh);
    } catch (e) {
      this.invalidateCaptureBuffer();
      showToast('캡처에 실패했습니다.');
      return;
    }
    // DEBUG: drawImage 정상 호출 확인 (확인 후 제거 예정)
    alert('drawImage success');
    ctx.filter = 'none';

    this.captureStateValid = true;
    // 캡처 성공 시 overlay 강제 표시 (모바일에서 누락되는 경우 대비)
    if (overlay) {
      overlay.classList.add('show');
      overlay.hidden = false;
      overlay.style.display = '';
    }
    if (flash) {
      flash.classList.add('flash');
      setTimeout(() => flash.classList.remove('flash'), 200);
    }

    if (BrowserOcr.available() || KeugeOcr.isNativeAvailable()) {
      await this._autoRunOcr(canvas);
    } else {
      showToast('캡처 완료!');
    }
  },

  async runOCR() {
    vib();

    if (KeugeOcr.isNativeCameraAvailable()) {
      OcrResultUI.showLoading();
      NavigationManager.announce('글자를 읽는 중입니다. 잠시만 기다려 주세요.');
      try {
        const text = await KeugeOcr.startNativeCapture(true);
        if (!text) {
          OcrResultUI.showError('글자를 찾지 못했습니다. 더 밝은 곳에서 선명하게 다시 찍어 주세요.');
          return;
        }
        OcrResultUI.showResult(text);
        showToast('글자를 찾았습니다');
      } catch (e) {
        if (e && e.message === 'cancelled') {
          OcrResultUI.hide();
          return;
        }
        OcrResultUI.showError(this.mapOcrError(e));
      }
      return;
    }

    const canvas = document.getElementById('capturedCanvas');
    const overlay = document.getElementById('capturedOverlay');
    const hasCapture =
      this.captureStateValid &&
      canvas &&
      overlay &&
      overlay.classList.contains('show') &&
      canvas.width > 0 &&
      canvas.height > 0;

    if (!hasCapture) {
      showToast('먼저 사진을 찍어 주세요');
      NavigationManager.announce('먼저 사진을 찍어 주세요');
      return;
    }

    if (!KeugeOcr.isNativeAvailable()) {
      if (BrowserOcr.available()) {
        if (!hasCapture) {
          showToast('먼저 사진을 찍어 주세요');
          NavigationManager.announce('먼저 사진을 찍어 주세요');
          return;
        }
        await this._autoRunOcr(canvas);
      } else {
        showToast('글자 읽기 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        NavigationManager.announce('글자 읽기 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    OcrResultUI.showLoading();
    this.pauseStream();
    NavigationManager.announce('글자를 읽는 중입니다. 잠시만 기다려 주세요.');

    try {
      const text = await KeugeOcr.recognizeCanvas(canvas);
      if (!text) {
        OcrResultUI.showError('글자를 찾지 못했습니다. 더 밝은 곳에서 선명하게 다시 찍어 주세요.');
        return;
      }
      OcrResultUI.showResult(text);
      showToast('글자를 찾았습니다');
    } catch (e) {
      OcrResultUI.showError(this.mapOcrError(e));
    }
  },

  mapOcrError(error) {
    const code = error && error.message ? error.message : 'ocr_failed';
    if (code === 'no_bridge') return '앱에서만 글자 읽기를 사용할 수 있습니다.';
    if (code === 'tesseract_not_loaded') return '글자 읽기 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    if (code === 'cancelled') return '촬영을 취소했습니다.';
    if (code === 'timeout') return '글자 읽기 시간이 초과되었습니다. 다시 시도해 주세요.';
    if (code === 'empty_image' || code === 'invalid_image') return '사진을 다시 찍어 주세요.';
    if (code === 'empty_text') return '글자를 찾지 못했습니다. 더 선명하게 다시 찍어 주세요.';
    return '글자를 인식하지 못했습니다. 사진을 더 선명하게 찍어 주세요.';
  },

  pauseStream() {
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
      } catch (e) {}
      this.stream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = null;
  },

  restartIfNeeded() {
    const cameraScreen = document.getElementById('screen-camera');
    if (!cameraScreen || !cameraScreen.classList.contains('active')) return;
    if (OcrResultUI.isOpen()) return;
    const overlay = document.getElementById('capturedOverlay');
    if (overlay && overlay.classList.contains('show')) return;
    if (!this.stream) this.start();
  },

  async _processPhotoFile(file) {
    const canvas = document.getElementById('capturedCanvas');
    const overlay = document.getElementById('capturedOverlay');
    const flash = document.getElementById('flashOverlay');
    if (!canvas || !file) return;

    await new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(); return; }
        ctx.filter = this.contrastOn ? 'contrast(2.5) brightness(1.1)' : 'none';
        ctx.drawImage(img, 0, 0);
        ctx.filter = 'none';
        this.captureStateValid = true;
        if (overlay) overlay.classList.add('show');
        if (flash) {
          flash.classList.add('flash');
          setTimeout(() => flash.classList.remove('flash'), 200);
        }
        vib([50, 30, 50]);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('사진을 불러오는 데 실패했습니다.');
        resolve();
      };
      img.src = url;
    });

    if (BrowserOcr.available() || KeugeOcr.isNativeAvailable()) {
      await this._autoRunOcr(canvas);
    } else {
      showToast('사진 저장 완료. 글자 읽기를 눌러주세요.');
    }
  },

  async _autoRunOcr(canvas) {
    OcrResultUI.showLoading();
    NavigationManager.announce('글자를 읽는 중입니다. 잠시만 기다려 주세요.');
    try {
      let text;
      if (BrowserOcr.available()) {
        showToast('글자를 읽는 중...');
        text = await BrowserOcr.recognize(canvas);
      } else {
        text = await KeugeOcr.recognizeCanvas(canvas);
      }
      if (!text) {
        OcrResultUI.showError('글자를 찾지 못했습니다. 더 밝은 곳에서 선명하게 다시 찍어 주세요.');
        return;
      }
      OcrResultUI.showResult(text);
      showToast('글자를 찾았습니다');
    } catch (e) {
      if (e && e.message === 'cancelled') { OcrResultUI.hide(); return; }
      OcrResultUI.showError(this.mapOcrError(e));
    }
  }
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
