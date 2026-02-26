// js/audio.js — BGM manager (Capacitor/iOS safe) — VERSION PRO (loop clean)
// - Musique par universeId (ou scenarioId)
// - Loop pro: preload + crossfade long + courbe equal-power + trim fin (masque “fin + restart”)
// - PAS de fallback "default" (si fichier manquant -> stop)
// - iOS: démarre seulement après 1ère interaction utilisateur (auto-handled)
// - SFX fin (good/bad/secret) + ducking BGM pendant le SFX
//
// Prefs:
// - localStorage vchoice_bgm_enabled ("1"/"0")
// - localStorage vchoice_bgm_volume  ("0.0".."1.0")
// - localStorage vchoice_sfx_volume  ("0.0".."1.0")

(function(){
  "use strict";

  const KEY_ENABLED    = "vchoice_bgm_enabled";
  const KEY_VOLUME     = "vchoice_bgm_volume";
  const KEY_SFX_VOLUME = "vchoice_sfx_volume";

  const BASE_BGM = "assets/audio/bgm/";
  const BASE_SFX = "assets/audio/sfx/";

  // On essaie .m4a puis .aac (SFX accepte aussi mp3)
  const BGM_EXTS = ["m4a"];
  const SFX_EXTS = ["m4a"];

  // ✅ PRO LOOP SETTINGS (pour des sons 16–30s)
  // - Crossfade long = masque la fin + évite le “stop / restart”
  const CROSSFADE_MS = 2000;

  // - On prépare la piste suivante AVANT le fade (pour éviter le trou si buffering)
  const PRELOAD_LEAD_MS = 1600;

  // - On “ignore” la toute fin (souvent: queue de reverb / silence / clic)
  const TRIM_END_MS = 250;

  // - Tick léger
  const TICK_MS = 80;

  // Volumes par défaut (plus “pro”)
  let enabled = true;
  let volume = 0.55;      // BGM
  let sfxVolume = 0.80;   // SFX

  // Ducking BGM pendant SFX
  let duckMul = 1.0; // 1 = normal, 0.35 = BGM abaissée

  let unlocked = false;
  let wantPlay = false;
  let unlockHooked = false;

  let currentUniverse = null;

  // loop state:
  // {
  //   universeId, extIndex, src,
  //   a: Audio,
  //   b: Audio (préparée ou en fade),
  //   tick,
  //   crossfadeMs,
  //   bPrepared: bool,
  //   bStarted: bool,
  //   fading: bool
  // }
  let _loop = null;

  function _lsGet(k){
    try { return localStorage.getItem(k); } catch(_) { return null; }
  }
  function _lsSet(k,v){
    try { localStorage.setItem(k, v); } catch(_) {}
  }

  function _loadPrefs(){
    const e = _lsGet(KEY_ENABLED);
    if (e === "0") enabled = false;
    if (e === "1") enabled = true;

    const v = parseFloat(_lsGet(KEY_VOLUME) || "");
    if (!Number.isNaN(v)) volume = Math.max(0, Math.min(1, v));

    const sv = parseFloat(_lsGet(KEY_SFX_VOLUME) || "");
    if (!Number.isNaN(sv)) sfxVolume = Math.max(0, Math.min(1, sv));
  }

  function _pickSrcBgm(universeId, ext){
    return BASE_BGM + encodeURIComponent(String(universeId)) + "." + ext;
  }

  function _pickSrcSfx(name, ext){
    return BASE_SFX + encodeURIComponent(String(name)) + "." + ext;
  }

  function _hookUnlockOnFirstGesture(){
    if (unlockHooked) return;
    unlockHooked = true;

    const handler = async () => {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("touchstart", handler, true);
      window.removeEventListener("mousedown", handler, true);
      await unlock();
    };

    window.addEventListener("pointerdown", handler, true);
    window.addEventListener("touchstart", handler, true);
    window.addEventListener("mousedown", handler, true);
  }

  async function unlock(){
    _loadPrefs();
    if (unlocked) return true;

    try {
      const dummy = new Audio();
      dummy.preload = "auto";
      dummy.volume = 0;

      if (currentUniverse) {
        dummy.src = _pickSrcBgm(currentUniverse, BGM_EXTS[0]);
      }

      await dummy.play();
      dummy.pause();
      try { dummy.currentTime = 0; } catch(_) {}

      unlocked = true;
      if (enabled && wantPlay) _tryPlay();
      return true;
    } catch(_) {
      unlocked = false;
      _hookUnlockOnFirstGesture();
      return false;
    }
  }

  function _clearLoopInterval(){
    try { if (_loop && _loop.tick) clearInterval(_loop.tick); } catch(_) {}
    if (_loop) _loop.tick = null;
  }

  function _stopLoopElements(){
    try {
      if (_loop?.a) _loop.a.pause();
      if (_loop?.b) _loop.b.pause();
    } catch(_) {}

    try {
      if (_loop?.a) _loop.a.currentTime = 0;
      if (_loop?.b) _loop.b.currentTime = 0;
    } catch(_) {}
  }

  function _destroyLoop(){
    _clearLoopInterval();
    _stopLoopElements();
    _loop = null;
  }

  function _handleBgmMissingOrError(){
    if (!_loop) return;

    if (_loop.extIndex < BGM_EXTS.length - 1) {
      _loop.extIndex += 1;
      _startLoop(_loop.universeId, { restart:true });
      return;
    }

    _destroyLoop();
  }

  function _makeAudioEl(src){
    const el = new Audio(src);
    el.preload = "auto";
    el.loop = false; // IMPORTANT: pas loop natif
    el.volume = Math.max(0, Math.min(1, volume * duckMul));

    el.addEventListener("error", () => {
      _handleBgmMissingOrError();
    });

    // Petit hint iOS
    try { el.playsInline = true; } catch(_) {}

    return el;
  }

  async function _safePlay(el){
    try {
      await el.play();
      return true;
    } catch(_) {
      _hookUnlockOnFirstGesture();
      return false;
    }
  }

  function _applyVolumes(){
    const base = Math.max(0, Math.min(1, volume * duckMul));
    try {
      if (_loop?.a) _loop.a.volume = base;

      // si b existe mais pas en fade, on force aussi
      if (_loop?.b && !_loop.fading) _loop.b.volume = base;
    } catch(_) {}
  }

  function _setDuck(mult){
    duckMul = Math.max(0, Math.min(1, Number(mult)));
    _applyVolumes();
  }

  function _prepareNextIfNeeded(){
    if (!_loop?.a) return;

    const cur = _loop.a;
    if (!isFinite(cur.duration) || cur.duration <= 0) return;

    const fadeMs = (_loop.crossfadeMs || CROSSFADE_MS);
    const fadeS  = fadeMs / 1000;
    const preloadS = PRELOAD_LEAD_MS / 1000;
    const trimS = TRIM_END_MS / 1000;

    const remain = (cur.duration - cur.currentTime) - trimS;

    // Préparer b (sans la lancer) assez tôt
    if (!_loop.b && remain <= (fadeS + preloadS)) {
      const b = _makeAudioEl(_loop.src);
      b.volume = 0;
      try { b.currentTime = 0; } catch(_) {}
      try { b.load(); } catch(_) {}

      _loop.b = b;
      _loop.bPrepared = true;
      _loop.bStarted = false;
      _loop.fading = false;
    }
  }

  function _startFadeIfReady(){
    if (!_loop?.a) return;

    const cur = _loop.a;
    if (!isFinite(cur.duration) || cur.duration <= 0) return;

    const fadeMs = (_loop.crossfadeMs || CROSSFADE_MS);
    const fadeS  = fadeMs / 1000;
    const trimS  = TRIM_END_MS / 1000;

    const remain = (cur.duration - cur.currentTime) - trimS;

    // Démarrer le fade
    if (_loop.b && !_loop.fading && remain <= fadeS) {
      const b = _loop.b;

      // Lance b au début du fade (volume 0)
      if (!_loop.bStarted) {
        _loop.bStarted = true;
        try { b.volume = 0; } catch(_) {}
        _safePlay(b);
      }

      _loop.fading = true;

      const start = performance.now();
      const step = () => {
        if (!_loop?.a || !_loop?.b) return;

        const t = (performance.now() - start) / fadeMs;
        const k = Math.max(0, Math.min(1, t));

        // ✅ Equal-power crossfade (plus propre qu’un fade linéaire)
        const fadeIn  = Math.sin(k * Math.PI / 2);
        const fadeOut = Math.cos(k * Math.PI / 2);

        const base = Math.max(0, Math.min(1, volume * duckMul));

        try {
          _loop.b.volume = base * fadeIn;
          _loop.a.volume = base * fadeOut;
        } catch(_) {}

        if (k >= 1) {
          try {
            _loop.a.pause();
            _loop.a.currentTime = 0;
          } catch(_) {}

          // Swap
          _loop.a = _loop.b;
          _loop.b = null;

          _loop.bPrepared = false;
          _loop.bStarted = false;
          _loop.fading = false;

          try { _loop.a.volume = base; } catch(_) {}
          return;
        }

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    }
  }

  function _startLoop(universeId, opts){
    const { restart = false } = (opts || {});
    _loadPrefs();

    if (!enabled) return;

    const id = String(universeId || "").trim();
    if (!id) return;

    if (!restart) {
      _destroyLoop();
      _loop = {
        universeId: id,
        extIndex: 0,
        src: "",
        a: null,
        b: null,
        tick: null,
        crossfadeMs: CROSSFADE_MS,
        bPrepared: false,
        bStarted: false,
        fading: false
      };
    } else {
      _clearLoopInterval();
      _stopLoopElements();
      _loop.a = null;
      _loop.b = null;
      _loop.src = "";
      _loop.bPrepared = false;
      _loop.bStarted = false;
      _loop.fading = false;
    }

    const ext = BGM_EXTS[_loop.extIndex] || BGM_EXTS[0];
    const src = _pickSrcBgm(id, ext);

    _loop.src = src;

    const a = _makeAudioEl(src);
    a.volume = Math.max(0, Math.min(1, volume * duckMul));
    _loop.a = a;

    wantPlay = true;

    _safePlay(a).then(() => {
      _clearLoopInterval();

      // Tick: prepare b puis fade
      _loop.tick = setInterval(() => {
        try {
          if (!_loop?.a) return;

          _prepareNextIfNeeded();
          _startFadeIfReady();
        } catch(_) {}
      }, TICK_MS);
    });
  }

  async function _tryPlay(){
    _loadPrefs();

    if (!enabled) {
      _destroyLoop();
      return;
    }

    wantPlay = true;

    if (!_loop && currentUniverse) {
      _startLoop(currentUniverse, { restart:false });
      return;
    }

    if (_loop?.a) {
      _applyVolumes();
      const ok = await _safePlay(_loop.a);
      if (!ok) return;
    } else if (currentUniverse) {
      _startLoop(currentUniverse, { restart:false });
    }
  }

  function setUniverse(universeId){
    _loadPrefs();

    const id = String(universeId || "").trim();
    if (!id) {
      currentUniverse = null;
      _destroyLoop();
      return;
    }

    if (currentUniverse === id) {
      if (enabled && wantPlay) _tryPlay();
      return;
    }

    currentUniverse = id;

    if (enabled) {
      _destroyLoop();
      _loop = {
        universeId: id,
        extIndex: 0,
        src: "",
        a: null,
        b: null,
        tick: null,
        crossfadeMs: CROSSFADE_MS,
        bPrepared: false,
        bStarted: false,
        fading: false
      };
      _startLoop(id, { restart:true });
    }
  }

  function setEnabled(on){
    enabled = !!on;
    _lsSet(KEY_ENABLED, enabled ? "1" : "0");

    if (enabled) _tryPlay();
    else _destroyLoop();
  }

  function setVolume(v){
    volume = Math.max(0, Math.min(1, Number(v)));
    _lsSet(KEY_VOLUME, String(volume));
    _applyVolumes();
  }

  function setSfxVolume(v){
    sfxVolume = Math.max(0, Math.min(1, Number(v)));
    _lsSet(KEY_SFX_VOLUME, String(sfxVolume));
  }

  function pause(){
    wantPlay = false;
    _clearLoopInterval();
    try { if (_loop?.a) _loop.a.pause(); } catch(_) {}
    try { if (_loop?.b) _loop.b.pause(); } catch(_) {}
  }

  function play(){
    wantPlay = true;
    _tryPlay();
  }

  function stop(){
    wantPlay = false;
    _destroyLoop();
  }

  // SFX fin : "good" | "bad" | "secret"
  function playEnding(type){
    _loadPrefs();

    const t = String(type || "").toLowerCase();
    let name = "ending_good";
    if (t === "bad") name = "ending_bad";
    if (t === "secret") name = "ending_secret";

    const vol = Math.max(0, Math.min(1, sfxVolume));

    return new Promise((resolve) => {
      let idx = 0;

      const tryExt = () => {
        const ext = SFX_EXTS[idx];
        if (!ext) return resolve(false);

        const src = _pickSrcSfx(name, ext);
        const fx = new Audio(src);
        fx.preload = "auto";
        fx.loop = false;
        fx.volume = vol;

        // ✅ Duck BGM pendant le SFX (pro)
        const prevDuck = duckMul;
        _setDuck(Math.min(prevDuck, 0.35));

        const cleanup = () => {
          try { fx.pause(); } catch(_) {}
          _setDuck(prevDuck);
        };

        fx.addEventListener("ended", () => { cleanup(); resolve(true); }, { once:true });
        fx.addEventListener("error", () => {
          cleanup();
          idx += 1;
          tryExt();
        }, { once:true });

        fx.play().then(() => {
          // ok
        }).catch(() => {
          cleanup();
          _hookUnlockOnFirstGesture();
          resolve(false);
        });
      };

      tryExt();
    });
  }

  // Pause/resume quand l’app passe en arrière-plan
  document.addEventListener("visibilitychange", () => {
    try {
      if (document.hidden) {
        _clearLoopInterval();
        if (_loop?.a) _loop.a.pause();
        if (_loop?.b) _loop.b.pause();
      } else {
        if (enabled && wantPlay) _tryPlay();
      }
    } catch(_) {}
  });

  // expose
  window.VCAudio = {
    setUniverse,
    unlock,
    play,
    pause,
    stop,
    setEnabled,
    setVolume,
    setSfxVolume,
    playEnding,

    isEnabled: () => enabled,
    getVolume: () => volume,
    getSfxVolume: () => sfxVolume,

    ensureUnlockedOnFirstGesture: _hookUnlockOnFirstGesture
  };

})();