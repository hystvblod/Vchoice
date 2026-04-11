// js/ads.js
// ===============================================
// VChronicles - js/ads.js
// - Branchements AdMob Capacitor avec IDs de test Google
// - Gère la préférence "pub personnalisée"
// - Rewarded + Interstitial
// ===============================================

(function () {
  "use strict";

  const AdsPrefKey = "vchoice_ads_personalized"; // "1" / "0"

  const TEST_IDS = {
    android: {
      banner: "ca-app-pub-3940256099942544/6300978111",
      adaptiveBanner: "ca-app-pub-3940256099942544/9214589741",
      interstitial: "ca-app-pub-3940256099942544/1033173712",
      rewarded: "ca-app-pub-3940256099942544/5224354917",
      rewardedInterstitial: "ca-app-pub-3940256099942544/5354046379",
    },
    ios: {
      banner: "ca-app-pub-3940256099942544/2934735716",
      adaptiveBanner: "ca-app-pub-3940256099942544/2435281174",
      interstitial: "ca-app-pub-3940256099942544/4411468910",
      rewarded: "ca-app-pub-3940256099942544/1712485313",
      rewardedInterstitial: "ca-app-pub-3940256099942544/6978759866",
    },
  };

  let _initPromise = null;
  let _rewardBusy = false;
  let _interstitialBusy = false;

  const LAST_REWARDED_AT_KEY = "vchoice_ads_last_rewarded_at_v1";
  const LAST_INTERSTITIAL_AT_KEY = "vchoice_ads_last_interstitial_at_v1";
  const INTERSTITIAL_GLOBAL_TIME_KEY = "vchoice_ads_ingame_time_ms_v1";
  const INTRO_FINISHED_FLOW_KEY = "vchoice_intro_just_finished";
  const CONSENT_RETRY_KEY = "vchoice_admob_consent_retry_v1";
  const CONSENT_STOP_KEY = "vchoice_admob_consent_stop_v1";

  let _weightedTimerStartedAt = 0;
  let _umpConsentInfo = null;

  function _nowMs() {
    return Date.now();
  }

  function _readTs(key) {
    try {
      const v = Number(localStorage.getItem(key) || 0);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (_) {}
    return 0;
  }

  function _writeTs(key, value) {
    try {
      const n = Math.max(0, Number(value || 0) || 0);
      localStorage.setItem(key, String(n));
    } catch (_) {}
  }

  function _isGameHtmlPage() {
    try {
      const p = String(location.pathname || "").toLowerCase();
      const h = String(location.href || "").toLowerCase();
      return p.endsWith("/game.html") || p === "/game.html" || h.includes("game.html");
    } catch (_) {}
    return false;
  }

  function _getScenarioIdFromUrl() {
    try {
      const u = new URL(location.href);
      return String(u.searchParams.get("scenario") || "").trim();
    } catch (_) {}
    return "";
  }

  function _isIntroScenarioPage() {
    return _isGameHtmlPage() && _getScenarioIdFromUrl() === "intro_tuto";
  }

  function _getWeightedFactor() {
    if (_isIntroScenarioPage()) return 0;
    return _isGameHtmlPage() ? 1 : (1 / 3);
  }

  function _addWeightedElapsed(elapsedMs) {
    const raw = Math.max(0, Number(elapsedMs || 0) || 0);
    if (raw <= 0) return 0;

    const weighted = Math.floor(raw * _getWeightedFactor());
    if (weighted <= 0) return 0;

    _writeTs(
      INTERSTITIAL_GLOBAL_TIME_KEY,
      _readTs(INTERSTITIAL_GLOBAL_TIME_KEY) + weighted
    );

    return weighted;
  }

  function _flushWeightedTimer() {
    if (_weightedTimerStartedAt <= 0) return 0;

    const elapsed = Math.max(0, _nowMs() - _weightedTimerStartedAt);
    _weightedTimerStartedAt = 0;

    return _addWeightedElapsed(elapsed);
  }

  function _startWeightedTimer() {
    try {
      if (document.hidden) return;
    } catch (_) {}
    if (_weightedTimerStartedAt > 0) return;
    _weightedTimerStartedAt = _nowMs();
  }

  function syncWeightedTime() {
    _flushWeightedTimer();
    _startWeightedTimer();
    return getWeightedAccumulatedMs();
  }

  function flushWeightedTime() {
    return _flushWeightedTimer();
  }

  function getWeightedAccumulatedMs() {
    return _readTs(INTERSTITIAL_GLOBAL_TIME_KEY);
  }

  function resetWeightedAccumulatedMs() {
    _writeTs(INTERSTITIAL_GLOBAL_TIME_KEY, 0);
  }

  function markRewardedShown() {
    _writeTs(LAST_REWARDED_AT_KEY, _nowMs());
  }

  function markInterstitialShown() {
    _writeTs(LAST_INTERSTITIAL_AT_KEY, _nowMs());
  }

  function getLastRewardedAt() {
    return _readTs(LAST_REWARDED_AT_KEY);
  }

  function getLastInterstitialAt() {
    return _readTs(LAST_INTERSTITIAL_AT_KEY);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _flushWeightedTimer();
    } else {
      _startWeightedTimer();
    }
  });

  window.addEventListener("pagehide", () => {
    _flushWeightedTimer();
  });

  function _readPersonalized() {
    try {
      const v = localStorage.getItem(AdsPrefKey);
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  }

  function _writePersonalized(on) {
    try {
      localStorage.setItem(AdsPrefKey, on ? "1" : "0");
    } catch (_) {}
  }

  function getPersonalized() {
    return _readPersonalized();
  }

  async function setPersonalized(on) {
    const v = !!on;
    _writePersonalized(v);
    return v;
  }

  function withTimeout(p, ms, errCode) {
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(errCode || "timeout")), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }

  function getPlatform() {
    try {
      const p = window.Capacitor && typeof window.Capacitor.getPlatform === "function"
        ? window.Capacitor.getPlatform()
        : "";
      if (p === "android" || p === "ios") return p;
    } catch (_) {}

    try {
      const ua = String(navigator.userAgent || "").toLowerCase();
      if (/iphone|ipad|ipod/.test(ua)) return "ios";
      if (/android/.test(ua)) return "android";
    } catch (_) {}

    return "web";
  }

  function getPlugin() {
    try {
      const cap = window.Capacitor;
      const plugins = cap && cap.Plugins;
      return (plugins && (plugins.AdMob || plugins.Admob || plugins.admob)) || null;
    } catch (_) {
      return null;
    }
  }

  function isNativeMobile() {
    const p = getPlatform();
    return p === "android" || p === "ios";
  }

  function _readLSString(key) {
    try {
      return String(localStorage.getItem(key) || "");
    } catch (_) {}
    return "";
  }

  function _writeLSString(key, value) {
    try {
      localStorage.setItem(key, String(value || ""));
    } catch (_) {}
  }

  function _removeLS(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function _isConsentRetryPending() {
    return _readLSString(CONSENT_RETRY_KEY) === "1";
  }

  function _isConsentStopFlagSet() {
    return _readLSString(CONSENT_STOP_KEY) === "1";
  }

  function _setConsentRetryPending(on) {
    if (on) _writeLSString(CONSENT_RETRY_KEY, "1");
    else _removeLS(CONSENT_RETRY_KEY);
  }

  function _setConsentStopFlag(on) {
    if (on) _writeLSString(CONSENT_STOP_KEY, "1");
    else _removeLS(CONSENT_STOP_KEY);
  }

  function _clearIntroFlowFlag() {
    _removeLS(INTRO_FINISHED_FLOW_KEY);
  }

  function _emptyConsentInfo() {
    return {
      status: "UNKNOWN",
      isConsentFormAvailable: false,
      canRequestAds: false,
      privacyOptionsRequirementStatus: "UNKNOWN"
    };
  }

  async function refreshGoogleConsentInfo(opts) {
    try {
      if (!isNativeMobile()) {
        _umpConsentInfo = {
          status: "NOT_REQUIRED",
          isConsentFormAvailable: false,
          canRequestAds: true,
          privacyOptionsRequirementStatus: "NOT_REQUIRED"
        };
        return _umpConsentInfo;
      }

      const plugin = getPlugin();
      if (!plugin || typeof plugin.requestConsentInfo !== "function") {
        _umpConsentInfo = _emptyConsentInfo();
        return _umpConsentInfo;
      }

      _umpConsentInfo = await plugin.requestConsentInfo(opts || {});
      return _umpConsentInfo || _emptyConsentInfo();
    } catch (_) {
      return _umpConsentInfo || _emptyConsentInfo();
    }
  }

  function getGoogleConsentInfo() {
    return _umpConsentInfo || _emptyConsentInfo();
  }

  async function canRequestAdsNowWithConsent() {
    try {
      const info = await refreshGoogleConsentInfo();
      return !!(info && info.canRequestAds);
    } catch (_) {
      return false;
    }
  }

  async function maybeShowGoogleConsentFormOnIndexAfterIntro() {
    try {
      if (!isNativeMobile()) return false;
      if (_isConsentStopFlagSet()) return false;

      const introJustFinished = _readLSString(INTRO_FINISHED_FLOW_KEY) === "1";
      const retryPending = _isConsentRetryPending();

      if (!introJustFinished && !retryPending) return false;

      const plugin = getPlugin();
      if (!plugin) {
        _setConsentRetryPending(true);
        return false;
      }

      if (typeof plugin.requestConsentInfo !== "function" || typeof plugin.showConsentForm !== "function") {
        _setConsentRetryPending(true);
        return false;
      }

      const beforeInfo = await refreshGoogleConsentInfo();

      if (beforeInfo && beforeInfo.canRequestAds) {
        _setConsentStopFlag(true);
        _setConsentRetryPending(false);
        _clearIntroFlowFlag();
        return false;
      }

      let shown = false;

      try {
        await plugin.showConsentForm();
        shown = true;
      } catch (_) {
        shown = false;
      }

      const afterInfo = await refreshGoogleConsentInfo();

      if (afterInfo && afterInfo.canRequestAds) {
        _setConsentStopFlag(true);
        _setConsentRetryPending(false);
        _clearIntroFlowFlag();
      } else {
        _setConsentRetryPending(true);
        _clearIntroFlowFlag();
      }

      return shown;
    } catch (_) {
      _setConsentRetryPending(true);
      return false;
    }
  }

  async function openGooglePrivacyOptionsForm() {
    try {
      if (!isNativeMobile()) return false;

      const plugin = getPlugin();
      if (!plugin) return false;
      if (typeof plugin.requestConsentInfo !== "function") return false;
      if (typeof plugin.showPrivacyOptionsForm !== "function") return false;

      const info = await refreshGoogleConsentInfo();

      if (info && info.canRequestAds) {
        _setConsentStopFlag(true);
        _setConsentRetryPending(false);
        _clearIntroFlowFlag();
        return false;
      }

      if (info.privacyOptionsRequirementStatus !== "REQUIRED") {
  _setConsentStopFlag(true);
  _setConsentRetryPending(false);
  _clearIntroFlowFlag();
  return false;
}

      await plugin.showPrivacyOptionsForm();

      const afterInfo = await refreshGoogleConsentInfo();

      _setConsentStopFlag(true);
      _setConsentRetryPending(false);
      _clearIntroFlowFlag();

      if (afterInfo && afterInfo.canRequestAds) {
        return true;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  function getTestIds() {
    const p = getPlatform();
    if (p === "ios") return TEST_IDS.ios;
    return TEST_IDS.android;
  }

  async function init() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      const plugin = getPlugin();
      if (!plugin) {
        return { ok: false, reason: "plugin_missing" };
      }

      if (!isNativeMobile()) {
        return { ok: false, reason: "not_native" };
      }

      if (typeof plugin.initialize === "function") {
        await plugin.initialize();
      }

      return { ok: true };
    })().catch((e) => {
      _initPromise = null;
      return { ok: false, reason: e?.message || "init_failed" };
    });

    return _initPromise;
  }

  function rewardedOptions(extra) {
    const ids = getTestIds();
    return Object.assign(
      {
        adId: ids.rewarded,
        isTesting: true,
        npa: !getPersonalized(),
        immersiveMode: true,
      },
      extra || {}
    );
  }

  function interstitialOptions(extra) {
    const ids = getTestIds();
    return Object.assign(
      {
        adId: ids.interstitial,
        isTesting: true,
        npa: !getPersonalized(),
        immersiveMode: true,
      },
      extra || {}
    );
  }

  async function showRewarded() {
    if (_rewardBusy) {
      return { ok: false, reason: "rewarded_busy" };
    }

    _rewardBusy = true;
    try {
      const plugin = getPlugin();
      if (!plugin) {
        return { ok: false, reason: "plugin_missing" };
      }

      const initState = await init();
      if (!initState || !initState.ok) {
        return { ok: false, reason: initState?.reason || "init_failed" };
      }

      if (typeof plugin.prepareRewardVideoAd !== "function" || typeof plugin.showRewardVideoAd !== "function") {
        return { ok: false, reason: "rewarded_api_missing" };
      }

      await withTimeout(
        plugin.prepareRewardVideoAd(rewardedOptions()),
        45000,
        "rewarded_prepare_timeout"
      );

      const rewardItem = await withTimeout(
        plugin.showRewardVideoAd(),
        45000,
        "rewarded_show_timeout"
      );

      markRewardedShown();

      return {
        ok: true,
        reward: rewardItem || null,
      };
    } catch (e) {
      return {
        ok: false,
        reason: e?.message || "rewarded_exception",
      };
    } finally {
      _rewardBusy = false;
    }
  }

  async function showInterstitial() {
    if (_interstitialBusy) {
      return { ok: false, reason: "interstitial_busy" };
    }

    if (!isInterstitialAllowed()) {
      return { ok: false, reason: "interstitial_blocked" };
    }

    _interstitialBusy = true;
    try {
      const plugin = getPlugin();
      if (!plugin) {
        return { ok: false, reason: "plugin_missing" };
      }

      const initState = await init();
      if (!initState || !initState.ok) {
        return { ok: false, reason: initState?.reason || "init_failed" };
      }

      if (typeof plugin.prepareInterstitial !== "function" || typeof plugin.showInterstitial !== "function") {
        return { ok: false, reason: "interstitial_api_missing" };
      }

      await withTimeout(
        plugin.prepareInterstitial(interstitialOptions()),
        45000,
        "interstitial_prepare_timeout"
      );

      await withTimeout(
        plugin.showInterstitial(),
        45000,
        "interstitial_show_timeout"
      );

      markInterstitialShown();
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        reason: e?.message || "interstitial_exception",
      };
    } finally {
      _interstitialBusy = false;
    }
  }

  function isInterstitialAllowed() {
    try {
      if (window.VUserData && typeof window.VUserData.hasNoAds === "function" && window.VUserData.hasNoAds()) {
        return false;
      }
    } catch (_) {}
    return true;
  }

  window.VAds = {
    init,
    showRewarded,
    showInterstitial,
    getPersonalized,
    setPersonalized,
    isInterstitialAllowed,
    getLastRewardedAt,
    getLastInterstitialAt,
    syncWeightedTime,
    flushWeightedTime,
    getWeightedAccumulatedMs,
    resetWeightedAccumulatedMs,
    refreshGoogleConsentInfo,
    getGoogleConsentInfo,
    canRequestAdsNowWithConsent,
    maybeShowGoogleConsentFormOnIndexAfterIntro,
    openGooglePrivacyOptionsForm,
    _debug: {
      getPlatform,
      getTestIds,
    },
  };

  try {
    setPersonalized(getPersonalized());
  } catch (_) {}

  try {
    _startWeightedTimer();
  } catch (_) {}

  try {
    init();
  } catch (_) {}
})();
