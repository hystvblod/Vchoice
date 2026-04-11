// js/onesignal.js
(function () {
  "use strict";

  const ONESIGNAL_APP_ID = "5be55174-857b-4300-9180-37c1b076885b";

  const K_PROMPT_DONE = "vc_os_native_prompt_done_v2";
  const K_PENDING_INDEX = "vc_os_native_prompt_pending_v2";

  let initialized = false;
  let bootPromise = null;
  let requestInFlight = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getOS() {
    try {
      if (window.plugins && window.plugins.OneSignal) return window.plugins.OneSignal;
    } catch (_) {}
    try {
      if (window.OneSignal) return window.OneSignal;
    } catch (_) {}
    return null;
  }

  function isNative() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function") {
        return !!window.Capacitor.isNativePlatform();
      }
      if (window.cordova) return true;
    } catch (_) {}
    return false;
  }

  function isIndexPage() {
    try {
      const p = String(window.location.pathname || "").toLowerCase();
      return p.endsWith("/index.html") || p.endsWith("index.html") || p === "/" || p === "";
    } catch (_) {
      return false;
    }
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  async function getUidBestEffort() {
    try {
      if (window.VUserData && typeof window.VUserData.ensureAuth === "function") {
        const uid = await window.VUserData.ensureAuth();
        if (uid) return String(uid);
      }
    } catch (_) {}

    try {
      if (window.sb && window.sb.auth && typeof window.sb.auth.getUser === "function") {
        const res = await window.sb.auth.getUser();
        const uid = res?.data?.user?.id;
        if (uid) return String(uid);
      }
    } catch (_) {}

    return null;
  }

  async function syncExternalId() {
    const OS = getOS();
    if (!OS) return false;

    const uid = await getUidBestEffort();
    if (!uid) return false;

    try {
      if (typeof OS.login === "function") {
        await OS.login(uid);
        return true;
      }
    } catch (_) {}

    try {
      if (typeof OS.setExternalUserId === "function") {
        await OS.setExternalUserId(uid);
        return true;
      }
    } catch (_) {}

    return false;
  }

  async function initOneSignal() {
    if (initialized) return true;

    const OS = getOS();
    if (!OS) {
      console.warn("[OneSignal] window.plugins.OneSignal introuvable");
      return false;
    }

    try {
      if (OS.Debug && typeof OS.Debug.setLogLevel === "function") {
        OS.Debug.setLogLevel(6);
      }

      if (typeof OS.initialize === "function") {
        OS.initialize(ONESIGNAL_APP_ID);
      } else if (typeof OS.setAppId === "function") {
        OS.setAppId(ONESIGNAL_APP_ID);
      } else {
        console.warn("[OneSignal] initialize/setAppId introuvable sur window.plugins.OneSignal", Object.keys(OS || {}));
        return false;
      }

      initialized = true;
      await syncExternalId();
      return true;
    } catch (e) {
      console.warn("[OneSignal] initOneSignal() error", e);
      return false;
    }
  }

  async function bootOneSignal() {
    if (initialized) return true;
    if (!isNative()) return false;
    if (bootPromise) return bootPromise;

    bootPromise = (async function () {
      try {
        for (let i = 0; i < 20; i++) {
          const ok = await initOneSignal();
          if (ok) return true;
          await sleep(400);
        }
        return false;
      } finally {
        if (!initialized) bootPromise = null;
      }
    })();

    return bootPromise;
  }

  async function requestNativePermission() {
    const bootOk = await bootOneSignal();
    if (!bootOk) {
      console.warn("[OneSignal] bootOneSignal() failed");
      return { attempted: false, accepted: false };
    }

    const OS = getOS();
    if (!OS) {
      console.warn("[OneSignal] getOS() returned null");
      return { attempted: false, accepted: false };
    }

    try {
      if (OS.Notifications && typeof OS.Notifications.requestPermission === "function") {
        const accepted = await OS.Notifications.requestPermission(false);
        console.log("[OneSignal] Native permission result:", accepted);
        return { attempted: true, accepted: !!accepted };
      }
    } catch (e) {
      console.warn("[OneSignal] Notifications.requestPermission failed", e);
    }

    try {
      if (typeof OS.promptForPushNotificationsWithUserResponse === "function") {
        const accepted = await new Promise((resolve) => {
          OS.promptForPushNotificationsWithUserResponse(function (ok) {
            resolve(!!ok);
          });
        });
        console.log("[OneSignal] Legacy native permission result:", accepted);
        return { attempted: true, accepted: !!accepted };
      }
    } catch (e) {
      console.warn("[OneSignal] Legacy prompt failed", e);
    }

    console.warn("[OneSignal] No native permission API available");
    return { attempted: false, accepted: false };
  }

  function markPromptPendingOnNextIndex() {
    if (lsGet(K_PROMPT_DONE) === "1") return false;
    lsSet(K_PENDING_INDEX, "1");
    return true;
  }

  function clearPendingPrompt() {
    lsDel(K_PENDING_INDEX);
  }

  async function maybePromptNativeAfterAdmobOnIndex() {
    if (!isIndexPage()) return false;
    if (lsGet(K_PROMPT_DONE) === "1") return false;
    if (lsGet(K_PENDING_INDEX) !== "1") return false;

    if (requestInFlight) return requestInFlight;

    requestInFlight = (async function () {
      try {
        const result = await requestNativePermission();

        if (result && result.attempted) {
          lsSet(K_PROMPT_DONE, "1");
          clearPendingPrompt();
        }

        return !!result?.accepted;
      } catch (e) {
        console.warn("[OneSignal] maybePromptNativeAfterAdmobOnIndex failed", e);
        return false;
      } finally {
        requestInFlight = null;
      }
    })();

    return requestInFlight;
  }

  window.VROneSignal = {
    boot: bootOneSignal,
    syncExternalId: syncExternalId,
    requestNativePermission: requestNativePermission,
    markPromptPendingOnNextIndex: markPromptPendingOnNextIndex,
    clearPendingPrompt: clearPendingPrompt,
    maybePromptNativeAfterAdmobOnIndex: maybePromptNativeAfterAdmobOnIndex,
    isReady: function () {
      return initialized;
    }
  };

  document.addEventListener("deviceready", async function () {
    await bootOneSignal();
  }, false);

  document.addEventListener("resume", function () {
    syncExternalId();
  }, false);
})();