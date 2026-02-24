// js/audio.js — BGM manager (Capacitor/iOS safe)
// - Musique par "universeId"
// - Loop
// - iOS: démarre seulement après 1ère interaction utilisateur (auto-handled)
// - Prefs: localStorage vchoice_bgm_enabled ("1"/"0"), vchoice_bgm_volume ("0.0".."1.0")

(function(){
  "use strict";

  const KEY_ENABLED = "vchoice_bgm_enabled";
  const KEY_VOLUME  = "vchoice_bgm_volume";

  const BASE = "assets/audio/bgm/";
  const FALLBACK_UNIVERSE = "default";

  let audio = null;
  let currentUniverse = null;

  let enabled = true;
  let volume = 0.6;

  let unlocked = false;
  let wantPlay = false;
  let unlockHooked = false;

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
  }

  function _ensureAudio(){
    if (audio) return;
    audio = new Audio();
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = volume;

    // Si un fichier manque -> fallback
    audio.addEventListener("error", () => {
      if (currentUniverse && currentUniverse !== FALLBACK_UNIVERSE) {
        setUniverse(FALLBACK_UNIVERSE);
      }
    });

    // Pause/resume quand l’app passe en arrière-plan
    document.addEventListener("visibilitychange", () => {
      if (!audio) return;
      if (document.hidden) {
        try { audio.pause(); } catch(_) {}
      } else {
        if (enabled && wantPlay) _tryPlay();
      }
    });
  }

  function _pickSrc(universeId){
    // iOS + Android OK
    return BASE + encodeURIComponent(universeId) + ".m4a";
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
    _ensureAudio();
    if (unlocked) return true;

    // tentative d’unlock iOS : play/pause sous geste utilisateur
    try {
      const prevVol = audio.volume;
      audio.volume = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.volume = prevVol;

      unlocked = true;

      if (enabled && wantPlay) _tryPlay();
      return true;
    } catch(_) {
      // iOS a refusé => on attendra un autre geste
      unlocked = false;
      _hookUnlockOnFirstGesture();
      return false;
    }
  }

  async function _tryPlay(){
    _ensureAudio();
    audio.volume = volume;

    if (!enabled) {
      try { audio.pause(); } catch(_) {}
      return;
    }

    wantPlay = true;

    try {
      await audio.play();
    } catch(_) {
      // Bloqué (iOS) => on arme l’unlock
      _hookUnlockOnFirstGesture();
    }
  }

  function setUniverse(universeId){
    _loadPrefs();
    _ensureAudio();

    const id = String(universeId || "").trim() || FALLBACK_UNIVERSE;
    if (currentUniverse === id) {
      if (enabled) _tryPlay();
      return;
    }

    currentUniverse = id;
    audio.src = _pickSrc(id);

    if (enabled) _tryPlay();
  }

  function setEnabled(on){
    enabled = !!on;
    _lsSet(KEY_ENABLED, enabled ? "1" : "0");
    if (!audio) return;
    if (enabled) _tryPlay();
    else { try { audio.pause(); } catch(_) {} }
  }

  function setVolume(v){
    volume = Math.max(0, Math.min(1, Number(v)));
    _lsSet(KEY_VOLUME, String(volume));
    if (audio) audio.volume = volume;
  }

  function pause(){
    wantPlay = false;
    if (audio) { try { audio.pause(); } catch(_) {} }
  }

  function play(){
    wantPlay = true;
    _tryPlay();
  }

  function stop(){
    wantPlay = false;
    if (!audio) return;
    try { audio.pause(); } catch(_) {}
    try { audio.currentTime = 0; } catch(_) {}
  }

  // expose
  window.VCAudio = {
    setUniverse,
    unlock,
    play,
    pause,
    stop,
    setEnabled,
    setVolume,
    isEnabled: () => enabled,
    getVolume: () => volume,
    ensureUnlockedOnFirstGesture: _hookUnlockOnFirstGesture
  };

})();