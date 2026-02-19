// ===============================================
// VChronicles - js/ads.js
// - API minimal pour Rewarded
// - Objectif : engine.js peut appeler window.VAds.showRewarded()
//   et décider de doubler la récompense.
//
// NOTE:
// - Sur le web (sans Capacitor/SDK pub), showRewarded() renvoie ok:false.
// - Dans l'app, tu pourras brancher ici ton provider (AdMob / AppLovin, etc.).
// ===============================================

(function () {
  "use strict";

  // Petit helper : timeout sur promesse
  function withTimeout(p, ms, errCode){
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(errCode || "timeout")), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }

  async function showRewarded(){
    // 1) Si un bridge natif custom existe déjà, on l'utilise.
    // Ex: window.VRAds.showRewarded()
    if (window.VRAds && typeof window.VRAds.showRewarded === "function"){
      try{
        const r = await withTimeout(Promise.resolve(window.VRAds.showRewarded()), 45_000, "rewarded_timeout");
        return (r && r.ok) ? { ok:true } : { ok:false, reason: r?.reason || "rewarded_failed" };
      }catch(e){
        return { ok:false, reason: e?.message || "rewarded_exception" };
      }
    }

    // 2) Tentative best-effort: Capacitor AdMob (si présent).
    // On garde volontairement très défensif car les APIs peuvent varier.
    try{
      const cap = window.Capacitor;
      const plugin = cap && cap.Plugins && (cap.Plugins.AdMob || cap.Plugins.Admob || cap.Plugins.AdmobPlus);
      if (plugin){
        // On essaie les méthodes connues, sans casser si elles n'existent pas.
        // IMPORTANT: l'Ad Unit ID est géré côté natif / config, pas ici.

        if (typeof plugin.showRewardVideoAd === "function"){
          await withTimeout(plugin.showRewardVideoAd(), 45_000, "rewarded_timeout");
          return { ok:true };
        }
        if (typeof plugin.showRewardedAd === "function"){
          await withTimeout(plugin.showRewardedAd(), 45_000, "rewarded_timeout");
          return { ok:true };
        }
        // Certaines versions exigent un load avant show
        if (typeof plugin.prepareRewardVideoAd === "function" && typeof plugin.showRewardVideoAd === "function"){
          await withTimeout(plugin.prepareRewardVideoAd(), 45_000, "rewarded_timeout");
          await withTimeout(plugin.showRewardVideoAd(), 45_000, "rewarded_timeout");
          return { ok:true };
        }
      }
    }catch(_){ /* ignore */ }

    // 3) Web / pas de provider
    return { ok:false, reason:"no_rewarded_provider" };
  }

  window.VAds = {
    showRewarded,
  };
})();
