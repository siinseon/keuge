// ═══════════════════════════════════════════
//   GLOBAL HANDLERS
// ═══════════════════════════════════════════
function navTo(name) { NavigationManager.navTo(name); }
function gotoScreen(name) { NavigationManager.gotoScreen(name); }
function goBack() { NavigationManager.goBack(); }
function toggleVoice() { SpeechManager.toggle(); }
function speak(text, skip) { SpeechManager.speak(text, skip); }

function doSearch(q) { SearchManager.doSearch(q); }
function updateSetting(k, v) { SettingsManager.update(k, v); }

function goCat(cat) {
  vib();
  if (AppState.brandsLoading || !AppState.brands) {
    showToast('데이터를 불러오는 중입니다.');
    return;
  }
  if (AppState.brandsLoadFailed) {
    console.error('[DataLoader] fallback 데이터 사용 중:', {
      category: cat,
      errors: AppState.brandsLoadErrors,
      source: AppState.brandsSource
    });
  }
  const brands = DataHelper.getCategoryBrands(cat);
  if (!brands.length) {
    UI.renderBrandList([], cat, { emptyMessage: `등록된 ${cat}가 없습니다.` });
    NavigationManager.gotoScreen('results');
    return;
  }
  UI.renderBrandList(brands, cat, { emptyMessage: `등록된 ${cat}가 없습니다.` });
  const bc = document.getElementById('resultsBreadcrumb');
  if (bc) bc.innerHTML = `<span>홈</span><span aria-current="location">${cat}</span>`;
  NavigationManager.gotoScreen('results');
}

function openBrand(name, cat) {
  vib();
  if (!AppState.brands || !AppState.brands[cat]) return;
  const brand = AppState.brands[cat].find(b => b.name === name);
  if (!brand) return;

  AppState.recentMenus = AppState.recentMenus.filter(item => item.name !== name);
  AppState.recentMenus.unshift({ name, cat });
  AppState.recentMenus = AppState.recentMenus.slice(0, 10);
  AppState.save();

  UI.renderBrandDetail(name, cat);
  NavigationManager.gotoScreen('detail');
}

function toggleFav(name) {
  vib([30, 20, 30]);
  const idx = AppState.favorites.indexOf(name);
  let msg = '';
  if (idx === -1) {
    AppState.favorites.push(name);
    msg = `${name} 즐겨찾기에 추가되었습니다.`;
  } else {
    AppState.favorites.splice(idx, 1);
    msg = `${name} 즐겨찾기에서 삭제되었습니다.`;
  }
  AppState.save();
  showToast(msg);
  NavigationManager.announce(msg);
  
  const detailTitle = document.getElementById('detailTitle').textContent;
  if (detailTitle === name) {
    const brand = DataHelper.getAllBrands().find(b => b.name === name);
    if (brand) openBrand(name, brand.cat);
  }
}

function closeCaptured() { vib(); document.getElementById('capturedOverlay').classList.remove('show'); }

const ScrollPerf = {
  isScrolling: false,
  _timer: null,
  _scrollSelector: '.home-menu-zone, .results-list, .detail-content, .home-search-zone',

  init() {
    const onScrollActivity = () => {
      this.isScrolling = true;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => { this.isScrolling = false; }, 120);
    };

    document.addEventListener('scroll', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.matches(this._scrollSelector)) return;
      onScrollActivity();
    }, { passive: true, capture: true });
  }
};

// ═══════════════════════════════════════════
//   INITIALIZATION
// ═══════════════════════════════════════════
let _appInitialized = false;
let _coreInitialized = false;
let _documentListenersBound = false;

function bindUIListeners() {
  ['resultsList', 'favList'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => UI.handleBrandListClick(e));
  });
  const detailContent = document.getElementById('detailContent');
  if (detailContent) detailContent.addEventListener('click', (e) => UI.handleDetailClick(e));

  const homeSearchBtn = document.getElementById('homeSearchBtn');
  if (homeSearchBtn) {
    homeSearchBtn.addEventListener('click', () => {
      const input = document.getElementById('homeSearchInput');
      if (input) doSearch(input.value);
    });
  }
  const voiceSearchBtn = document.getElementById('voiceSearchBtn');
  if (voiceSearchBtn) voiceSearchBtn.addEventListener('click', () => SpeechManager.toggleVoiceSearch());
  const homeSearchInput = document.getElementById('homeSearchInput');
  if (homeSearchInput) {
    homeSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch(e.target.value);
    });
  }
  const zoomInBtn = document.getElementById('zoomInBtn');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      vib();
      CameraManager.zoomScale = Math.min(4, CameraManager.zoomScale + 0.5);
      CameraManager.applyZoom();
      CameraManager.updateUI();
    });
  }
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      vib();
      CameraManager.zoomScale = Math.max(1, CameraManager.zoomScale - 0.5);
      CameraManager.applyZoom();
      CameraManager.updateUI();
    });
  }
  const contrastBtn = document.getElementById('contrastBtn');
  if (contrastBtn) contrastBtn.addEventListener('click', () => CameraManager.toggleContrast());
  const captureBtn = document.getElementById('captureBtn');
  if (captureBtn) captureBtn.addEventListener('click', () => CameraManager.capture());
  const ocrBtn = document.getElementById('ocrBtn');
  if (ocrBtn) ocrBtn.addEventListener('click', () => CameraManager.runOCR());
}

function bindDocumentListeners() {
  if (_documentListenersBound) return;
  _documentListenersBound = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target.closest('button, [tabindex="0"]');
      if (target && !target.disabled) {
        if (e.key === ' ') e.preventDefault();
        target.click();
      }
    }
  });

  document.addEventListener('focusin', (e) => {
    if (!AppState.settings.voiceEnabled || ScrollPerf.isScrolling) return;
    const target = e.target.closest('button, input, [tabindex="0"]');
    if (!target || target.classList.contains('tts-btn')) return;
    const label = target.getAttribute('aria-label') || target.innerText || target.placeholder || '';
    if (label) speak(label, true);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.result-card')) {
      if (navigator.vibrate) navigator.vibrate(25);
    }
  }, { passive: true });
}

function canBindUIListeners() {
  return !!(document.getElementById('resultsList') && document.getElementById('detailContent'));
}

async function initApp() {
  if (_appInitialized) return;

  if (!_coreInitialized) {
    _coreInitialized = true;

    let loaded = false;
    try {
      loaded = await DataLoader.loadBrands();
    } catch (e) {
      loaded = false;
    }
    if (!loaded) {
      showToast('데이터를 가져올 수 없습니다');
    }

    SettingsManager.init();
    SpeechManager.init();
    ScrollPerf.init();
  }

  if (!canBindUIListeners()) return;

  bindUIListeners();
  bindDocumentListeners();

  // 4. Initial Render
  UI.renderHomeScreen();
  _appInitialized = true;
}

window.addEventListener('DOMContentLoaded', initApp);
window.addEventListener('load', initApp);
