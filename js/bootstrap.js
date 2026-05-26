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

// ═══════════════════════════════════════════
//   CORE MODULE: STATE & SETTINGS
// ═══════════════════════════════════════════
const AppState = {
  screenHistory: ['home'],
  favorites: JSON.parse(localStorage.getItem('fav') || '[]'),
  recentMenus: JSON.parse(localStorage.getItem('recentMenus') || '[]'),
  recentSearches: JSON.parse(localStorage.getItem('recentSearches') || '[]'),
  settings: JSON.parse(localStorage.getItem('settings') || '{"voiceEnabled": true, "fontSize": "medium", "displayMode": "normal", "reducedMotion": false}'),
  brands: null,
  brandsLoading: false,
  brandsLoadFailed: false,
  brandsLoadErrors: [],
  brandsSource: null,

  save() {
    localStorage.setItem('fav', JSON.stringify(this.favorites));
    localStorage.setItem('recentMenus', JSON.stringify(this.recentMenus));
    localStorage.setItem('recentSearches', JSON.stringify(this.recentSearches));
    localStorage.setItem('settings', JSON.stringify(this.settings));
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
//   CAMERA & OCR MODULE
// ═══════════════════════════════════════════
const CameraManager = {
  stream: null,
  zoomScale: 1,
  contrastOn: false,
  zoomTimer: null,
  contrastTimer: null,

  _showCameraFallback(video, noSupport) {
    if (video) video.style.display = 'none';
    if (noSupport) noSupport.style.display = 'flex';
  },

  async start() {
    const video = document.getElementById('cameraVideo');
    const noSupport = document.getElementById('cameraNoSupport');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._showCameraFallback(video, noSupport);
      return;
    }

    showToast('카메라를 준비 중입니다...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (!video) {
        this.stop();
        return;
      }
      video.srcObject = this.stream;
      video.style.display = 'block';
      if (noSupport) noSupport.style.display = 'none';
      await this.applyZoom();
    } catch (err) {
      this._showCameraFallback(video, noSupport);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        this.showPermissionModal();
      }
      showToast('카메라 오류');
    }
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
    this.zoomScale = 1;
    this.contrastOn = false;
    this.updateUI();
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

  capture() {
    vib([50, 30, 50]);
    const video = document.getElementById('cameraVideo');
    if (!this.stream || !video || video.readyState < 2) return;

    const flash = document.getElementById('flashOverlay');
    if (flash) {
      flash.classList.add('flash');
      setTimeout(() => flash.classList.remove('flash'), 200);
    }

    const canvas = document.getElementById('capturedCanvas');
    if (!canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    if (this.contrastOn) {
      ctx.filter = 'contrast(2.5) brightness(1.1)';
      ctx.drawImage(canvas, 0, 0);
    }

    const overlay = document.getElementById('capturedOverlay');
    if (overlay) overlay.classList.add('show');
    showToast('캡처 완료!');
  },

  async runOCR() {
    vib();
    const video = document.getElementById('cameraVideo');
    if (!this.stream || !video || video.readyState < 2) return;

    showToast('글자를 읽는 중입니다...');
    NavigationManager.announce('글자를 읽는 중입니다. 잠시만 기다려 주세요.');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      NavigationManager.announce('글자를 인식하지 못했습니다.');
      showToast('인식 실패');
      return;
    }
    ctx.drawImage(video, 0, 0);

    let text = '';
    try {
      text = await this.recognizeText(canvas);
    } catch (e) {
      text = '';
    }

    const ocrArea = document.getElementById('ocrResultArea');
    if (text) {
      NavigationManager.announce(`인식된 글자입니다: ${text}`);
      if (ocrArea) ocrArea.textContent = text;
      showToast('인식 완료!');
    } else {
      NavigationManager.announce('글자를 인식하지 못했습니다.');
      showToast('인식 실패');
    }
  },

  async recognizeText(canvas) {
    // 실제 OCR 엔진(Tesseract.js 등) 연결 지점
    return new Promise(resolve => {
      setTimeout(() => {
        resolve("샘플 메뉴: 아메리카노 4,500원, 카페라떼 5,000원");
      }, 1500);
    });
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
        console.log('[DataLoader] brands loaded', {
          source: url,
          cafe: AppState.brands['카페'].length,
          restaurant: AppState.brands['식당'].length
        });
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
