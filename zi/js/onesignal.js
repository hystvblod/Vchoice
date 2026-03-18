// FILE: www/js/onesignal.js
// VChronicles - OneSignal init (Cordova plugin inside Capacitor)
// - Init on deviceready
// - Optional: link OneSignal user to Supabase uid (external id) if VUserData exists
// - Request permission once (for testing)

(function () {
  "use strict";

  const ONESIGNAL_APP_ID = "5be55174-857b-4300-9180-37c1b076885b";
  const PERM_FLAG_KEY = "vc_onesignal_perm_prompted_v1";

  let __inited = false;

  async function initOneSignal() {
    if (__inited) return;

    const os =
      (window.plugins && window.plugins.OneSignal) ? window.plugins.OneSignal :
      (window.OneSignal ? window.OneSignal : null);

    if (!os || typeof os.initialize !== "function") {
      console.warn("[OneSignal] SDK not ready (window.plugins.OneSignal missing).");
      return;
    }

    __inited = true;

    try {
      if (os.Debug && typeof os.Debug.setLogLevel === "function") {
        os.Debug.setLogLevel(6); // verbose (à enlever en prod)
      }
    } catch (_) {}

    try {
      os.initialize(ONESIGNAL_APP_ID);
    } catch (e) {
      console.error("[OneSignal] initialize failed:", e);
      return;
    }

    // (Optionnel) Lier à ton uid Supabase si dispo
    try {
      if (window.VUserData && typeof window.VUserData.ensureAuth === "function") {
        const uid = await window.VUserData.ensureAuth();
        if (uid) {
          if (typeof os.login === "function") os.login(String(uid));
          else if (typeof os.setExternalUserId === "function") os.setExternalUserId(String(uid));
        }
      }
    } catch (e) {
      console.warn("[OneSignal] external id link skipped:", e);
    }

    // Demande permission (TEST). OneSignal recommande de ne pas le faire en prod au lancement.
    try {
      if (!localStorage.getItem(PERM_FLAG_KEY) &&
          os.Notifications && typeof os.Notifications.requestPermission === "function") {
        localStorage.setItem(PERM_FLAG_KEY, "1");
        os.Notifications.requestPermission(false).then(function (accepted) {
          console.log("[OneSignal] User accepted notifications:", accepted);
        }).catch(function (err) {
          console.warn("[OneSignal] requestPermission error:", err);
        });
      }
    } catch (_) {}
  }

  document.addEventListener("deviceready", initOneSignal, false);
  setTimeout(initOneSignal, 3000); // fallback si la page se charge après deviceready
})();