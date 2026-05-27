const UI = {
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  buildBrandCard(brand) {
    const name = this.escapeHtml(brand.name);
    const cat = this.escapeHtml(brand.cat);
    return `
      <div class="brand-card" role="listitem" tabindex="0" data-brand="${name}" data-cat="${cat}" aria-label="${name} 메뉴 보기">
        <div class="brand-card-info">
          <div class="brand-card-name">${name}</div>
        </div>
        <button type="button" class="tts-btn" data-speak="${name}" aria-label="${name} 이름 듣기">듣기</button>
      </div>
    `;
  },

  buildMenuCard(menuName) {
    const menu = this.escapeHtml(menuName);
    return `
      <div class="menu-card" role="listitem" tabindex="0" aria-label="${menu} 메뉴">
        <div class="menu-card-info">
          <div class="menu-card-name">${menu}</div>
        </div>
        <button type="button" class="tts-btn" data-speak="${menu}" aria-label="${menu} 듣기">듣기</button>
      </div>
    `;
  },

  buildCategorySection(cat, items) {
    if (!items.length) {
      return `
        <section class="category-section" aria-label="${cat} 목록">
          <h2 class="section-heading">${cat}</h2>
          <div class="category-empty">등록된 ${cat}가 없습니다.</div>
        </section>
      `;
    }
    return `
      <section class="category-section" aria-label="${cat} 목록">
        <h2 class="section-heading">${cat}</h2>
        <div class="brand-card-list" role="list">
          ${items.map(brand => this.buildBrandCard(brand)).join('')}
        </div>
      </section>
    `;
  },

  handleBrandListClick(e) {
    const ttsBtn = e.target.closest('.tts-btn');
    if (ttsBtn) {
      e.stopPropagation();
      const text = ttsBtn.dataset.speak;
      if (text) SpeechManager.speakFromUserAction(text);
      return;
    }
    const card = e.target.closest('.brand-card[data-brand], .recent-card[data-brand]');
    if (card) openBrand(card.dataset.brand, card.dataset.cat);
  },

  handleDetailClick(e) {
    const ttsBtn = e.target.closest('.tts-btn');
    if (!ttsBtn) return;
    e.stopPropagation();
    const text = ttsBtn.dataset.speak;
    if (text) SpeechManager.speakFromUserAction(text);
  },

  renderBrandList(brands, title, options = {}) {
    const { grouped = false, emptyMessage } = options;
    const list = document.getElementById('resultsList');
    document.getElementById('resultsTitle').textContent = title;

    const isEmpty = grouped
      ? CATEGORIES.every(cat => !brands[cat] || brands[cat].length === 0)
      : !brands || brands.length === 0;

    if (isEmpty) {
      list.innerHTML = `<div class="no-results">${emptyMessage || '결과가 없습니다.<br><br>다른 검색어로<br>다시 시도해 보세요.'}</div>`;
      NavigationManager.announce(emptyMessage ? emptyMessage.replace(/<[^>]+>/g, '') : '검색 결과가 없습니다.');
      return;
    }

    const html = grouped
      ? CATEGORIES.filter(cat => brands[cat] && brands[cat].length).map(cat => this.buildCategorySection(cat, brands[cat])).join('')
      : `<div class="brand-card-list" role="list">${brands.map(brand => this.buildBrandCard(brand)).join('')}</div>`;

    requestAnimationFrame(() => {
      list.innerHTML = html;
      list.scrollTop = 0;
    });

    const count = grouped
      ? CATEGORIES.reduce((n, cat) => n + (brands[cat] ? brands[cat].length : 0), 0)
      : brands.length;
    NavigationManager.announce(`${title} ${count}개가 있습니다.`);
  },

  renderBrandDetail(name, cat) {
    if (!AppState.brands || !AppState.brands[cat]) return;
    const brand = AppState.brands[cat].find(b => b.name === name);
    if (!brand) return;

    const isFav = AppState.favorites.includes(name);
    const menus = DataHelper.getBrandMenus(brand);
    const safeName = this.escapeHtml(name);

    document.getElementById('detailTitle').textContent = name;
    const bc = document.getElementById('detailBreadcrumb');
    if (bc) bc.innerHTML = `<span>홈</span><span>${this.escapeHtml(cat)}</span><span aria-current="location">${safeName}</span>`;

    const menuHTML = menus.length
      ? `<div class="menu-card-list" role="list">${menus.map(menu => this.buildMenuCard(menu)).join('')}</div>`
      : '<div class="no-results">등록된 메뉴가 없습니다.</div>';

    document.getElementById('detailContent').innerHTML = `
      ${menuHTML}
      <div class="detail-actions">
        <button class="add-fav-btn ${isFav ? 'active' : ''}" data-fav-brand="${safeName}" aria-label="${isFav ? '즐겨찾기 삭제' : '즐겨찾기 추가'}" aria-pressed="${isFav}">
          <span class="fav-icon" aria-hidden="true">${isFav ? '★' : '☆'}</span>
          <span>${isFav ? '즐겨찾기 삭제' : '즐겨찾기 추가'}</span>
        </button>
      </div>
    `;

    const favBtn = document.getElementById('detailContent').querySelector('[data-fav-brand]');
    if (favBtn) {
      favBtn.addEventListener('click', () => toggleFav(name));
    }

    NavigationManager.announce(`${name} 메뉴 ${menus.length}개가 있습니다.`);
  },

  renderHomeScreen() {
    const homeContent = document.querySelector('#screen-home .home-menu-zone');
    if (!homeContent) return;

    if (AppState.brandsLoading || !AppState.brands) {
      homeContent.innerHTML = '<div class="no-results">데이터를 불러오는 중입니다...</div>';
      return;
    }

    if (homeContent.querySelector('.home-cat-btn')) return;

    homeContent.innerHTML = `
      <div class="home-cat-grid">
        <button class="home-cat-btn" onclick="gotoScreen('search')" aria-label="메뉴 검색하기 버튼">
          <span class="cat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
          <span>검색하기</span>
        </button>
        <button class="home-cat-btn" onclick="goCat('카페')" aria-label="카페 메뉴 보기 버튼">
          <span class="cat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></span>
          <span>카페</span>
        </button>
        <button class="home-cat-btn" onclick="goCat('식당')" aria-label="식당 메뉴 보기 버튼">
          <span class="cat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"></path><path d="M7 2v20"></path><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"></path></svg></span>
          <span>식당</span>
        </button>
        <button class="home-cat-btn" onclick="navTo('settings')" aria-label="설정 버튼">
          <span class="cat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></span>
          <span>설정</span>
        </button>
      </div>
    `;
  },

  renderSearchScreen() {
    const zone = document.querySelector('#screen-search .home-search-zone');
    if (!zone) return;

    const existingRecent = zone.querySelector('.recent-searches');
    if (existingRecent) existingRecent.remove();

    const searches = Array.isArray(AppState.recentSearches) ? AppState.recentSearches : [];
    if (searches.length === 0) return;

    const recentDiv = document.createElement('div');
    recentDiv.className = 'recent-searches';

    const heading = document.createElement('h2');
    heading.className = 'section-heading';
    heading.textContent = '최근 검색어';
    recentDiv.appendChild(heading);

    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'recent-tags';

    searches.forEach(raw => {
      if (raw == null) return;
      const term = String(raw);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result-card recent-tag-btn';
      btn.textContent = term;
      btn.setAttribute('aria-label', `${term} 검색하기`);
      btn.addEventListener('click', () => doSearch(term));
      tagsWrap.appendChild(btn);
    });

    if (tagsWrap.childElementCount === 0) return;

    recentDiv.appendChild(tagsWrap);
    zone.appendChild(recentDiv);
  },

  renderFavScreen() {
    const items = DataHelper.getAllBrands().filter(b => AppState.favorites.includes(b.name));
    const list = document.getElementById('favList');
    if (items.length === 0) {
      list.innerHTML = '<div class="no-results">아직 즐겨찾기가 없습니다.<br><br>브랜드 메뉴에서<br>별표를 눌러 추가해 보세요.</div>';
      return;
    }
    list.innerHTML = `<div class="brand-card-list" role="list">${items.map(brand => this.buildBrandCard(brand)).join('')}</div>`;
  },

  renderSettingsScreen() {
    const s = AppState.settings;
    document.getElementById('settings-voice-btn').querySelector('span').textContent = s.voiceEnabled ? '음성 안내 켜짐' : '음성 안내 꺼짐';
    document.getElementById('settings-motion-btn').querySelector('span').textContent = s.reducedMotion ? '애니메이션 제한됨' : '애니메이션 사용 중';

    document.querySelectorAll('#screen-settings .result-card').forEach(btn => {
      btn.classList.remove('active');
      const onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes('fontSize')) {
        if (onclick.includes(`'${s.fontSize}'`)) btn.classList.add('active');
      } else if (onclick.includes('displayMode')) {
        if (onclick.includes(`'${s.displayMode}'`)) btn.classList.add('active');
      }
    });
  }
};
