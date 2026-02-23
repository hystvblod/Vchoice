// ===============================================
// VChronicles - js/ads.js
// - API minimal pour Rewarded
// - + Gestion préférence "pub personnalisée"
//   => stock localStorage vchoice_ads_personalized ("1"/"0")
//   => exposé: window.VAds.getPersonalized() / setPersonalized()
//   => si bridge natif existe: window.VRAds.setPersonalized(bool)
// ===============================================

(function () {
  "use strict";

  const AdsPrefKey = "vchoice_ads_personalized"; // "1" / "0"

  function _readPersonalized(){
    try{
      const v = localStorage.getItem(AdsPrefKey);
      if (v === "1") return true;
      if (v === "0") return false;
    }catch(_){}
    // ✅ par défaut: OFF (plus safe GDPR). Change à true si tu veux.
    return false;
  }

  function _writePersonalized(on){
    try{ localStorage.setItem(AdsPrefKey, on ? "1" : "0"); }catch(_){}
  }

  async function setPersonalized(on){
    const v = !!on;
    _writePersonalized(v);

    // 1) Bridge natif custom si dispo (idéal: AdMob/AppLovin côté app)
    try{
      if (window.VRAds && typeof window.VRAds.setPersonalized === "function"){
        await Promise.resolve(window.VRAds.setPersonalized(v));
      }
    }catch(_){ /* ignore */ }

    return v;
  }

  function getPersonalized(){
    return _readPersonalized();
  }

  // Petit helper : timeout sur promesse
  function withTimeout(p, ms, errCode){
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(errCode || "timeout")), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }

  async function showRewarded(){
    const personalized = getPersonalized();

    // 1) Bridge natif custom
    if (window.VRAds && typeof window.VRAds.showRewarded === "function"){
      try{
        // On passe la pref si le bridge l'accepte (sinon il ignore)
        const r = await withTimeout(
          Promise.resolve(window.VRAds.showRewarded({ personalized })),
          45_000,
          "rewarded_timeout"
        );
        return (r && r.ok) ? { ok:true } : { ok:false, reason: r?.reason || "rewarded_failed" };
      }catch(e){
        return { ok:false, reason: e?.message || "rewarded_exception" };
      }
    }

    // 2) Tentative best-effort Capacitor AdMob (si présent)
    try{
      const cap = window.Capacitor;
      const plugin = cap && cap.Plugins && (cap.Plugins.AdMob || cap.Plugins.Admob || cap.Plugins.AdmobPlus);
      if (plugin){
        // Selon SDK, la personnalisation se règle souvent via "npa" / "nonPersonalizedAds"
        // Ici: on tente de passer un hint, sans casser si ignoré.
        const hint = { nonPersonalizedAds: !personalized };

        if (typeof plugin.showRewardVideoAd === "function"){
          await withTimeout(plugin.showRewardVideoAd(hint), 45_000, "rewarded_timeout");
          return { ok:true };
        }
        if (typeof plugin.showRewardedAd === "function"){
          await withTimeout(plugin.showRewardedAd(hint), 45_000, "rewarded_timeout");
          return { ok:true };
        }
        if (typeof plugin.prepareRewardVideoAd === "function" && typeof plugin.showRewardVideoAd === "function"){
          await withTimeout(plugin.prepareRewardVideoAd(hint), 45_000, "rewarded_timeout");
          await withTimeout(plugin.showRewardVideoAd(hint), 45_000, "rewarded_timeout");
          return { ok:true };
        }
      }
    }catch(_){ /* ignore */ }

    // 3) Web / pas de provider
    return { ok:false, reason:"no_rewarded_provider" };
  }

  // expose
  window.VAds = {
    showRewarded,
    getPersonalized,
    setPersonalized,
  };

  // push la pref au bridge au boot (si présent)
  try { setPersonalized(getPersonalized()); } catch(_){}

})();