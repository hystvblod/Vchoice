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
    _debug: {
      getPlatform,
      getTestIds,
    },
  };

  try {
    setPersonalized(getPersonalized());
  } catch (_) {}

  try {
    init();
  } catch (_) {}
})();