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

function closeOcrResult() {
  OcrResultUI.hide();
}

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
let _initPromise = null;
let _documentListenersBound = false;
const _boundElements = new WeakSet();

function bindElementListener(el, type, handler, options) {
  if (!el || _boundElements.has(el)) return;
  _boundElements.add(el);
  el.addEventListener(type, handler, options);
}

async function initApp() {
  if (!_initPromise) {
    _initPromise = (async () => {
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
      KeugeOcr.init();
      if (typeof MenuPreviewZoom !== 'undefined') MenuPreviewZoom.init();
      OcrResultUI.bindEvents(bindElementListener);

      ['resultsList', 'favList'].forEach(id => {
        bindElementListener(document.getElementById(id), 'click', (e) => UI.handleBrandListClick(e));
      });
      bindElementListener(document.getElementById('detailContent'), 'click', (e) => UI.handleDetailClick(e));

      // 3. Event Listeners
      bindElementListener(document.getElementById('homeSearchBtn'), 'click', () => {
        const input = document.getElementById('homeSearchInput');
        if (input) doSearch(input.value);
      });
      bindElementListener(document.getElementById('voiceSearchBtn'), 'click', () => SpeechManager.toggleVoiceSearch());
      bindElementListener(document.getElementById('homeSearchInput'), 'keydown', e => {
        if (e.key === 'Enter') doSearch(e.target.value);
      });
      const captureBtnEl = document.getElementById('captureBtn');
      if (captureBtnEl) {
        bindElementListener(captureBtnEl, 'click', () => {
          void CameraManager.capture().catch(() => {
            showToast('사진 선택에 실패했습니다.');
          });
        });
      }
      bindElementListener(document.getElementById('ocrBtn'), 'click', () => CameraManager.runOCR());

      if (!_documentListenersBound) {
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
          if (target) {
            const label = target.getAttribute('aria-label') || target.innerText || target.placeholder || '';
            if (label) speak(label, true);
          }
        });

        document.addEventListener('click', (e) => {
          const raw = e.target;
          const origin = raw instanceof Element ? raw : raw && raw.parentElement;
          if (!origin || !origin.closest) return;

          if (origin.closest('button') || origin.closest('.result-card')) {
            if (navigator.vibrate) navigator.vibrate(25);
          }
        }, { passive: true });
      }

      // 4. Initial Render
      UI.renderHomeScreen();
    })();
  }
  return _initPromise;
}

window.addEventListener('DOMContentLoaded', () => {
  void initApp().catch(() => {});
});
