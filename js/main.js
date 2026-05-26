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

const EventDiag = {
  boundNodes: {},
  _touchProbeBound: false,

  log(msg, data) {
    console.log('[EventDiag] ' + msg, data !== undefined ? data : '');
  },

  logBind(name, el) {
    this.boundNodes[name] = el || null;
    this.log('bind:' + name, {
      ok: !!el,
      id: el?.id || null,
      connected: el?.isConnected ?? null
    });
  },

  probeNode(name, id) {
    const current = document.getElementById(id);
    const bound = this.boundNodes[name];
    this.log('probe:' + name, {
      currentExists: !!current,
      boundExists: !!bound,
      sameNode: !!(current && bound && current === bound),
      currentConnected: current?.isConnected ?? null
    });
    return current;
  },

  probeHomeButtons() {
    const homeSearchBtn = document.getElementById('homeSearchBtn');
    const catBtns = document.querySelectorAll('#screen-home .home-cat-btn');
    this.log('probe:homeSearchBtn', {
      exists: !!homeSearchBtn,
      hasClickListener: homeSearchBtn ? homeSearchBtn.dataset.diagClickBound === '1' : false
    });
    catBtns.forEach((btn, i) => {
      this.log('probe:categoryBtn[' + i + ']', {
        label: btn.getAttribute('aria-label'),
        hasOnclick: !!btn.getAttribute('onclick'),
        onclick: btn.getAttribute('onclick') || null
      });
    });
  },

  probeDelegation() {
    this.probeNode('resultsList', 'resultsList');
    this.probeNode('detailContent', 'detailContent');
    this.probeNode('favList', 'favList');
    const resultsList = document.getElementById('resultsList');
    const detailContent = document.getElementById('detailContent');
    this.log('probe:delegation', {
      resultsListDiagBound: resultsList?.dataset.diagClickBound === '1',
      detailContentDiagBound: detailContent?.dataset.diagClickBound === '1',
      resultsChildCount: resultsList?.childElementCount ?? 0,
      detailChildCount: detailContent?.childElementCount ?? 0,
      ttsBtnCount: document.querySelectorAll('.tts-btn').length
    });
  },

  afterRender(renderName) {
    this.log('afterRender:' + renderName, { appInitialized: _appInitialized });
    if (renderName === 'renderHomeScreen') this.probeHomeButtons();
    if (renderName === 'renderBrandList' || renderName === 'renderBrandDetail') this.probeDelegation();
  },

  wrapClick(name, handler) {
    return (e) => {
      this.log('event:delegation-click:' + name, {
        type: e.type,
        target: e.target?.className || e.target?.tagName,
        closestTts: !!e.target?.closest?.('.tts-btn'),
        closestBrand: !!e.target?.closest?.('.brand-card')
      });
      return handler(e);
    };
  },

  bindTouchProbe() {
    if (this._touchProbeBound) return;
    this._touchProbeBound = true;
    const logTouch = (e) => {
      const t = e.target?.closest?.('.back-btn, .tts-btn, .home-cat-btn, .brand-card, .homeSearchBtn, #homeSearchBtn, .nav-tab, button');
      if (!t) return;
      this.log('event:' + e.type, {
        tag: t.tagName,
        class: t.className,
        id: t.id || null,
        aria: t.getAttribute('aria-label')
      });
    };
    document.addEventListener('touchstart', logTouch, { capture: true, passive: true });
    document.addEventListener('pointerup', logTouch, { capture: true, passive: true });
    document.addEventListener('click', logTouch, { capture: true, passive: true });
    this.log('touchProbe:bound', { events: ['touchstart', 'pointerup', 'click'] });
  }
};

function bindUIListeners() {
  ['resultsList', 'favList'].forEach(id => {
    const el = document.getElementById(id);
    EventDiag.logBind(id, el);
    if (el) {
      el.dataset.diagClickBound = '1';
      el.addEventListener('click', EventDiag.wrapClick(id, (e) => UI.handleBrandListClick(e)));
    }
  });
  const detailContent = document.getElementById('detailContent');
  EventDiag.logBind('detailContent', detailContent);
  if (detailContent) {
    detailContent.dataset.diagClickBound = '1';
    detailContent.addEventListener('click', EventDiag.wrapClick('detailContent', (e) => UI.handleDetailClick(e)));
  }

  const homeSearchBtn = document.getElementById('homeSearchBtn');
  EventDiag.logBind('homeSearchBtn', homeSearchBtn);
  if (homeSearchBtn) {
    homeSearchBtn.dataset.diagClickBound = '1';
    homeSearchBtn.addEventListener('click', () => {
      EventDiag.log('event:homeSearchBtn-click');
      const input = document.getElementById('homeSearchInput');
      if (input) doSearch(input.value);
    });
  }
  const voiceSearchBtn = document.getElementById('voiceSearchBtn');
  EventDiag.logBind('voiceSearchBtn', voiceSearchBtn);
  if (voiceSearchBtn) voiceSearchBtn.addEventListener('click', () => SpeechManager.toggleVoiceSearch());
  const homeSearchInput = document.getElementById('homeSearchInput');
  EventDiag.logBind('homeSearchInput', homeSearchInput);
  if (homeSearchInput) {
    homeSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch(e.target.value);
    });
  }
  const zoomInBtn = document.getElementById('zoomInBtn');
  EventDiag.logBind('zoomInBtn', zoomInBtn);
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      vib();
      CameraManager.zoomScale = Math.min(4, CameraManager.zoomScale + 0.5);
      CameraManager.applyZoom();
      CameraManager.updateUI();
    });
  }
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  EventDiag.logBind('zoomOutBtn', zoomOutBtn);
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      vib();
      CameraManager.zoomScale = Math.max(1, CameraManager.zoomScale - 0.5);
      CameraManager.applyZoom();
      CameraManager.updateUI();
    });
  }
  const contrastBtn = document.getElementById('contrastBtn');
  EventDiag.logBind('contrastBtn', contrastBtn);
  if (contrastBtn) contrastBtn.addEventListener('click', () => CameraManager.toggleContrast());
  const captureBtn = document.getElementById('captureBtn');
  EventDiag.logBind('captureBtn', captureBtn);
  if (captureBtn) captureBtn.addEventListener('click', () => CameraManager.capture());
  const ocrBtn = document.getElementById('ocrBtn');
  EventDiag.logBind('ocrBtn', ocrBtn);
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
  EventDiag.log('initApp:called', {
    appInitialized: _appInitialized,
    coreInitialized: _coreInitialized,
    readyState: document.readyState
  });

  if (_appInitialized) {
    EventDiag.log('initApp:skip', 'already initialized');
    return;
  }

  if (!_coreInitialized) {
    _coreInitialized = true;
    EventDiag.log('initApp:coreInit', 'start');

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
    EventDiag.log('initApp:coreInit', 'done');
  }

  const canBind = canBindUIListeners();
  EventDiag.log('initApp:canBindUIListeners', { canBind });
  if (!canBind) return;

  bindUIListeners();
  bindDocumentListeners();
  EventDiag.bindTouchProbe();

  // 4. Initial Render
  UI.renderHomeScreen();
  _appInitialized = true;
  EventDiag.log('initApp:complete', { appInitialized: _appInitialized });
  EventDiag.probeHomeButtons();
  EventDiag.probeDelegation();
}

window.addEventListener('DOMContentLoaded', () => {
  EventDiag.log('lifecycle:DOMContentLoaded');
  initApp();
});
window.addEventListener('load', () => {
  EventDiag.log('lifecycle:load');
  initApp();
});
