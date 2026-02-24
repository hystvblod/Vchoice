// js/audio.js — BGM manager (Capacitor/iOS safe) — VERSION PRO
// - Musique par universeId (ou scenarioId si tu passes ça)
// - Loop "sans couture" via crossfade (évite le "recommencement" audible)
// - PAS de fallback "default" (si fichier manquant -> on stop, pas de requête parasite)
// - iOS: démarre seulement après 1ère interaction utilisateur (auto-handled)
// - SFX de fin (good/bad/secret) qui se superpose (plus fort) à la BGM
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

  // ⚠️ Si tu héberges sur GitHub Pages et que tu publies la racine du repo (avec /www/),
  // alors tes assets sont peut-être sous "www/assets/...".
  // Dans Capacitor, la racine est "www/", donc "assets/..." est correct.
  const BASE_BGM = "assets/audio/bgm/";
  const BASE_SFX = "assets/audio/sfx/";

  // On essaie .m4a puis .aac (et pour SFX on peut aussi accepter mp3 si tu veux)
  const BGM_EXTS = ["m4a", "aac"];
  const SFX_EXTS = ["m4a", "aac", "mp3"];

  // Crossfade pour la boucle (ms). 140–220ms marche bien.
  const CROSSFADE_MS = 160;

  let enabled = true;
  let volume = 0.6;
  let sfxVolume = 0.95;

  let unlocked = false;
  let wantPlay = false;
  let unlockHooked = false;

  let currentUniverse = null;

  // loop state: { universeId, extIndex, src, a, b, tick, crossfadeMs }
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

    // pointerdown d’abord, + fallback
    window.addEventListener("pointerdown", handler, true);
    window.addEventListener("touchstart", handler, true);
    window.addEventListener("mousedown", handler, true);
  }

  async function unlock(){
    _loadPrefs();

    if (unlocked) return true;

    // Tentative d’unlock iOS : play/pause sous geste utilisateur.
    // On unlock un petit "audio dummy", puis derrière les play() passent.
    try {
      const dummy = new Audio();
      dummy.preload = "auto";
      dummy.volume = 0;
      // src minimal (même vide) : sur iOS, parfois play() sans src ne fait rien.
      // On met un src BGM si on a un universe courant, sinon on tente sans.
      if (currentUniverse) {
        dummy.src = _pickSrcBgm(currentUniverse, BGM_EXTS[0]);
      }
      await dummy.play();
      dummy.pause();
      dummy.currentTime = 0;

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
    try {
      if (_loop && _loop.tick) clearInterval(_loop.tick);
    } catch(_) {}
    if (_loop) _loop.tick = null;
  }

  function _stopLoopElements(){
    try {
      if (_loop?.a) { _loop.a.pause(); }
      if (_loop?.b) { _loop.b.pause(); }
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
    // On essaie l’extension suivante si possible, sinon on stop sans fallback.
    if (!_loop) return;

    if (_loop.extIndex < BGM_EXTS.length - 1) {
      _loop.extIndex += 1;
      _startLoop(_loop.universeId, { restart:true });
      return;
    }

    // Plus rien à tenter -> stop (pas de "default")
    _destroyLoop();
  }

  function _makeAudioEl(src){
    const el = new Audio(src);
    el.preload = "auto";
    el.loop = false; // IMPORTANT: pas loop natif
    el.volume = volume;
    el.addEventListener("error", () => {
      _handleBgmMissingOrError();
    });
    return el;
  }

  async function _safePlay(el){
    try {
      await el.play();
      return true;
    } catch(_) {
      // Bloqué (iOS) => on arme l’unlock
      _hookUnlockOnFirstGesture();
      return false;
    }
  }

  function _startLoop(universeId, opts){
    const { restart = false } = (opts || {});
    _loadPrefs();

    if (!enabled) return;

    const id = String(universeId || "").trim();
    if (!id) return;

    // (re)crée l’état loop
    if (!restart) {
      _destroyLoop();
      _loop = {
        universeId: id,
        extIndex: 0,
        src: "",
        a: null,
        b: null,
        tick: null,
        crossfadeMs: CROSSFADE_MS
      };
    } else {
      // restart en conservant extIndex/universeId
      _clearLoopInterval();
      _stopLoopElements();
      _loop.a = null;
      _loop.b = null;
      _loop.src = "";
    }

    const ext = BGM_EXTS[_loop.extIndex] || BGM_EXTS[0];
    const src = _pickSrcBgm(id, ext);

    _loop.src = src;

    const a = _makeAudioEl(src);
    a.volume = volume;
    _loop.a = a;

    wantPlay = true;

    _safePlay(a).then(() => {
      // interval de contrôle (déclenche crossfade proche de la fin)
      _clearLoopInterval();
      _loop.tick = setInterval(() => {
        try {
          if (!_loop?.a) return;

          const cur = _loop.a;

          // Durée parfois NaN tant que metadata pas chargées
          if (!isFinite(cur.duration) || cur.duration <= 0) return;

          const fadeS = (_loop.crossfadeMs || CROSSFADE_MS) / 1000;
          const remain = cur.duration - cur.currentTime;

          // Déclenche une seule fois par boucle
          if (!_loop.b && remain <= fadeS) {
            const b = _makeAudioEl(_loop.src);
            b.volume = 0;
            b.currentTime = 0;
            _loop.b = b;

            _safePlay(b);

            const start = performance.now();

            const step = () => {
              if (!_loop?.a || !_loop?.b) return;

              const t = (performance.now() - start) / (_loop.crossfadeMs || CROSSFADE_MS);
              const k = Math.max(0, Math.min(1, t));

              // Utilise le volume global actuel (si tu changes le slider pendant le fade)
              const base = volume;

              _loop.b.volume = base * k;
              _loop.a.volume = base * (1 - k);

              if (k >= 1) {
                try {
                  _loop.a.pause();
                  _loop.a.currentTime = 0;
                } catch(_) {}

                // Swap
                _loop.a = _loop.b;
                _loop.b = null;

                // remet le volume propre
                _loop.a.volume = base;
                return;
              }

              requestAnimationFrame(step);
            };

            requestAnimationFrame(step);
          }
        } catch(_) {}
      }, 60);
    });
  }

  async function _tryPlay(){
    _loadPrefs();

    if (!enabled) {
      // stop net si disabled
      _destroyLoop();
      return;
    }

    wantPlay = true;

    // si pas de loop active mais on a un universe -> on lance
    if (!_loop && currentUniverse) {
      _startLoop(currentUniverse, { restart:false });
      return;
    }

    // sinon on tente de relancer l'élément courant
    if (_loop?.a) {
      _loop.a.volume = volume;
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

    // si universe identique
    if (currentUniverse === id) {
      if (enabled && wantPlay) _tryPlay();
      return;
    }

    currentUniverse = id;

    // (re)start loop sur le nouvel universe
    if (enabled) {
      _destroyLoop();
      _loop = {
        universeId: id,
        extIndex: 0,
        src: "",
        a: null,
        b: null,
        tick: null,
        crossfadeMs: CROSSFADE_MS
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

    // applique au loop courant
    try {
      if (_loop?.a) _loop.a.volume = volume;
      // b est contrôlé par le fade, mais si pas en fade on le limite
      if (_loop?.b && _loop.b.volume > volume) _loop.b.volume = volume;
    } catch(_) {}
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
  // Fichiers attendus (ex):
  // - assets/audio/sfx/ending_good.m4a
  // - assets/audio/sfx/ending_bad.m4a
  // - assets/audio/sfx/ending_secret.m4a
  function playEnding(type){
    _loadPrefs();

    const t = String(type || "").toLowerCase();
    let name = "ending_good";
    if (t === "bad") name = "ending_bad";
    if (t === "secret") name = "ending_secret";

    // Plus fort que la BGM : tu peux ajuster ici
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

        fx.addEventListener("ended", () => resolve(true));
        fx.addEventListener("error", () => {
          idx += 1;
          tryExt();
        });

        fx.play().then(() => {
          // ok, on laisse jouer
        }).catch(() => {
          // iOS bloqué => on hook unlock et on abandonne (ça rejouera au prochain geste)
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
        // on pause sans perdre l’intention de play
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