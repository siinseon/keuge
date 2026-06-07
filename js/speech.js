const SpeechManager = {
  recognition: null,
  synth: null,
  Utterance: null,
  voicesReady: false,
  _cachedVoice: null,
  _pending: null,
  _retriesActive: false,
  _keepAliveTimer: null,
  _voiceRetryDelays: [50, 150, 300, 500, 800, 1200, 2000, 3000],

  isNativeTtsAvailable() {
    return typeof AndroidBridge !== 'undefined' && AndroidBridge.hasMethod('speakText');
  },

  _lastSpeakText: '',
  _lastSpeakAt: 0,

  _isDuplicateSpeak(text) {
    const now = Date.now();
    if (text === this._lastSpeakText && now - this._lastSpeakAt < 800) return true;
    this._lastSpeakText = text;
    this._lastSpeakAt = now;
    return false;
  },

  _showSpeakToast(text, skipToast) {
    if (!skipToast) showToast('"' + text + '" 읽는 중...');
  },

  speakNative(text) {
    if (!text || !this.isNativeTtsAvailable()) return false;
    try {
      AndroidBridge.call('speakText', String(text));
      return true;
    } catch (e) {
      return false;
    }
  },

  stopNative() {
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.hasMethod('stopSpeak')) {
      try {
        AndroidBridge.call('stopSpeak');
        return true;
      } catch (e) {}
    }
    return false;
  },

  getSynth() {
    return window.speechSynthesis || window.webkitSpeechSynthesis || null;
  },

  getUtteranceClass() {
    return window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance || null;
  },

  prepareSynth() {
    this.synth = this.getSynth();
    this.Utterance = this.getUtteranceClass();
    if (!this.synth) return false;
    try {
      if (this.synth.paused) this.synth.resume();
    } catch (e) {}
    return !!this.Utterance;
  },

  loadVoices() {
    if (!this.synth) return [];
    try {
      const voices = this.synth.getVoices();
      return voices && voices.length ? voices : [];
    } catch (e) {
      return [];
    }
  },

  pickVoice(voices) {
    const list = voices && voices.length ? voices : this.loadVoices();
    if (!list.length) return this._cachedVoice || null;

    const rules = [
      v => v.lang === 'ko-KR' && v.localService,
      v => v.lang === 'ko-KR',
      v => /^ko-KR/i.test(v.lang || ''),
      v => /^ko/i.test(v.lang || ''),
      v => (v.lang || '').toLowerCase().includes('ko'),
      v => /korean|ko-kr|google.*ko|samsung.*ko/i.test(v.name || ''),
      v => v.default === true,
    ];

    for (const rule of rules) {
      const found = list.find(rule);
      if (found) return found;
    }
    return list[0];
  },

  cacheVoice() {
    const voice = this.pickVoice(this.loadVoices());
    if (voice) {
      this._cachedVoice = voice;
      this.voicesReady = true;
    }
    return voice;
  },

  buildUtterance(text) {
    const utter = new this.Utterance(String(text));
    utter.lang = 'ko-KR';
    utter.rate = 0.9;
    utter.pitch = 1;
    utter.volume = 1;

    const voice = this.pickVoice(this.loadVoices()) || this._cachedVoice;
    if (voice) {
      utter.voice = voice;
      this._cachedVoice = voice;
    }
    return utter;
  },

  startKeepAlive() {
    this.stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (!this.synth) {
        this.stopKeepAlive();
        return;
      }
      if (!this.synth.speaking) {
        this.stopKeepAlive();
        return;
      }
      try {
        if (this.synth.paused) this.synth.resume();
      } catch (e) {}
    }, 250);
    setTimeout(() => this.stopKeepAlive(), 15000);
  },

  stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  },

  runSpeak(text, skipToast = false) {
    if (this.speakNative(text)) {
      this._showSpeakToast(text, skipToast);
      return;
    }

    if (!this.prepareSynth()) return;

    try {
      this.synth.cancel();
    } catch (e) {}

    setTimeout(() => {
      if (!this.prepareSynth()) return;

      try {
        if (this.synth.paused) this.synth.resume();

        const utter = this.buildUtterance(text);
        utter.onend = () => this.stopKeepAlive();
        utter.onerror = () => this.stopKeepAlive();

        this.startKeepAlive();
        this.synth.speak(utter);

        this._showSpeakToast(text, skipToast);
      } catch (e) {
        this.stopKeepAlive();
      }
    }, 50);
  },

  tryPendingSpeak() {
    if (!this._pending) return;

    const { text, skipToast } = this._pending;
    if (this.speakNative(text)) {
      this._pending = null;
      this._retriesActive = false;
      this._showSpeakToast(text, skipToast);
      return;
    }

    if (!this.prepareSynth()) return;

    const voices = this.loadVoices();
    if (!voices.length) {
      this.scheduleVoiceRetries();
      return;
    }

    this.cacheVoice();
    this._pending = null;
    this._retriesActive = false;
    this.runSpeak(text, skipToast);
  },

  scheduleVoiceRetries() {
    if (this._retriesActive) return;
    this._retriesActive = true;

    const attempt = () => {
      if (!this._pending) {
        this._retriesActive = false;
        return;
      }
      if (this.speakNative(this._pending.text)) {
        const { text, skipToast } = this._pending;
        this._pending = null;
        this._retriesActive = false;
        this._showSpeakToast(text, skipToast);
        return;
      }
      this.prepareSynth();
      const voices = this.loadVoices();
      if (voices.length > 0) {
        this.tryPendingSpeak();
      }
    };

    this._voiceRetryDelays.forEach(delay => setTimeout(attempt, delay));

    setTimeout(() => {
      if (!this._pending) {
        this._retriesActive = false;
        return;
      }
      const { text, skipToast } = this._pending;
      this._pending = null;
      this._retriesActive = false;
      this.runSpeak(text, skipToast);
    }, 3500);
  },

  queueSpeak(text, skipToast = false) {
    this._pending = { text, skipToast };
    this.tryPendingSpeak();
  },

  initVoiceEngine() {
    this.prepareSynth();

    const onVoicesChanged = () => {
      if (this.loadVoices().length > 0) {
        this.cacheVoice();
        if (this._pending) this.tryPendingSpeak();
      }
    };

    if (this.synth) {
      this.synth.onvoiceschanged = onVoicesChanged;
    }

    onVoicesChanged();
    this._voiceRetryDelays.forEach(delay => setTimeout(onVoicesChanged, delay));
  },

  bindUserGestureWarmUp() {
    if (this._warmUpBound) return;
    this._warmUpBound = true;
    const warmUp = () => {
      this.prepareSynth();
      this.cacheVoice();
    };
    document.addEventListener('touchstart', warmUp, { once: true, passive: true });
    document.addEventListener('click', warmUp, { once: true, passive: true });
  },

  getVoiceSearchBtn() {
    return document.getElementById('voiceSearchBtn');
  },

  getVoiceSearchBtnText() {
    return document.getElementById('voiceSearchBtnText');
  },

  setVoiceSearchListening(listening) {
    const btn = this.getVoiceSearchBtn();
    const label = this.getVoiceSearchBtnText();
    if (!btn || !label) return;

    if (listening) {
      btn.classList.add('listening');
      btn.setAttribute('aria-label', '듣고 있습니다. 다시 누르면 중단');
      label.textContent = '듣고 있습니다...';
    } else {
      btn.classList.remove('listening');
      btn.setAttribute('aria-label', '음성으로 검색하기');
      label.textContent = '음성으로 검색하기';
    }
  },

  startVoiceSearch() {
    vib();
    if (!this.recognition) {
      showToast('음성 검색을 사용할 수 없습니다');
      NavigationManager.announce('음성 검색을 사용할 수 없습니다');
      return;
    }

    try {
      this.recognition.start();
    } catch (e) {
      try {
        this.recognition.stop();
      } catch (err) {}
    }
  },

  toggleVoiceSearch() {
    const btn = this.getVoiceSearchBtn();
    if (btn && btn.classList.contains('listening')) {
      try {
        this.recognition?.stop();
      } catch (e) {}
      return;
    }
    this.startVoiceSearch();
  },

  init() {
    this.initVoiceEngine();
    this.bindUserGestureWarmUp();

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SR();
      this.recognition.lang = 'ko-KR';
      this.recognition.onstart = () => {
        this.setVoiceSearchListening(true);
        showToast('듣고 있습니다...');
        NavigationManager.announce('듣고 있습니다. 말씀해 주세요.');
      };
      this.recognition.onend = () => {
        this.setVoiceSearchListening(false);
      };
      this.recognition.onerror = () => {
        this.setVoiceSearchListening(false);
        showToast('음성 인식 실패');
        NavigationManager.announce('음성 인식에 실패했습니다.');
      };
      this.recognition.onresult = (e) => {
        const t = e.results[0][0].transcript;
        const input = document.getElementById('homeSearchInput');
        if (input) input.value = t;
        SearchManager.doSearch(t);
      };
    }
  },

  speak(text, skipToast = false) {
    if (!text) return;
    if (this._isDuplicateSpeak(text)) return;
    vib();
    if (this.speakNative(text)) {
      this._showSpeakToast(text, skipToast);
      return;
    }
    this.queueSpeak(text, skipToast);
  },

  speakFromUserAction(text, skipToast = false) {
    if (!text) return;
    if (this._isDuplicateSpeak(text)) return;
    vib();
    if (this.speakNative(text)) {
      this._showSpeakToast(text, skipToast);
      return;
    }

    this.prepareSynth();
    this.cacheVoice();

    const voices = this.loadVoices();
    if (voices.length > 0) {
      this._pending = null;
      this.runSpeak(text, skipToast);
    } else {
      this.queueSpeak(text, skipToast);
    }
  },

  toggle() {
    AppState.settings.voiceEnabled = !AppState.settings.voiceEnabled;
    AppState.save();
    const msg = AppState.settings.voiceEnabled ? '음성 안내를 시작합니다.' : '음성 안내를 종료합니다.';
    showToast(msg);

    const announcer = document.getElementById('sr-announcer');
    if (announcer) {
      announcer.textContent = '';
      setTimeout(() => { announcer.textContent = msg; }, 100);
    }

    if (AppState.settings.voiceEnabled) {
      this.speakFromUserAction(msg, true);
    } else {
      this.stopNative();
      try {
        if (this.prepareSynth()) this.synth.cancel();
      } catch (e) {}
      this.stopKeepAlive();
    }

    if (AppState.screenHistory[AppState.screenHistory.length - 1] === 'settings') {
      UI.renderSettingsScreen();
    }
  }
};
