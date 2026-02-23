// js/shop.js
// ✅ Page boutique (guard: index.html charge aussi shop.js, donc on ne fait rien hors shop.html)

(function(){
  "use strict";

  function isShopPage(){
    try { return document.body && document.body.getAttribute("data-page") === "shop"; }
    catch { return false; }
  }
  if (!isShopPage()) return;

  const PRODUCT_IDS = [
    "vchoice_jetons_12",
    "vchoice_jetons_30",
    "vchoice_vcoins_500",
    "vchoice_vcoins_3000",
    "vchoice_no_ads",
    "vchoice_ultra"
  ];

  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

  function getPrice(pid){
    try{
      const api = window.VCIAP || window.VRIAP;
      const v = api?.getPrice?.(pid);
      return (v && String(v).trim()) ? String(v) : "";
    }catch(_){ return ""; }
  }

  function setPrice(pid, price){
    $all(`[data-price-for="${pid}"]`).forEach(el => {
      el.textContent = price || "…";
    });
  }

  function refreshAllPrices(){
    PRODUCT_IDS.forEach(pid => {
      const p = getPrice(pid);
      setPrice(pid, p || "…");
    });
  }

  function entHasUltra(){
    try { return !!window.VCEnt?.hasUltra?.(); } catch(_) { return false; }
  }
  function entHasNoAds(){
    try { return !!window.VCEnt?.hasNoAds?.(); } catch(_) { return false; }
  }

  function refreshEntitlementsUI(){
    const ultra = entHasUltra();
    const noAds = entHasNoAds();

    const btnUltra = document.getElementById("buy_ultra");
    const btnNoAds = document.getElementById("buy_no_ads");

    if (btnUltra){
      btnUltra.disabled = ultra;
      btnUltra.textContent = ultra ? "Activé" : "Acheter";
    }

    if (btnNoAds){
      if (ultra){
        btnNoAds.disabled = true;
        btnNoAds.textContent = "Inclus (ULTRA)";
      } else {
        btnNoAds.disabled = noAds;
        btnNoAds.textContent = noAds ? "Activé" : "Acheter";
      }
    }
  }

  function iapAvailable(){
    try{
      const api = window.VCIAP || window.VRIAP;
      return !!api?.isAvailable?.();
    }catch(_){ return false; }
  }

  function disableAllBuyButtonsIfNoIAP(){
    const ok = iapAvailable();
    $all("[data-buy]").forEach(btn => {
      if (!ok){
        btn.disabled = true;
        btn.textContent = "Indisponible";
      }
    });
  }

  async function buy(pid, btn){
    try{
      const api = window.VCIAP || window.VRIAP;
      if (!api?.order) return;

      if (btn){
        btn.disabled = true;
        btn.textContent = "…";
      }

      await api.order(pid);
      // l’UI se mettra à jour sur vc:iap_credited (ou restore)
    }catch(_){}
    finally{
      // on ré-active si pas non-consumable acquis
      setTimeout(() => {
        refreshEntitlementsUI();
        // pour les consumables, on remet juste "Acheter"
        $all(`[data-buy="${pid}"]`).forEach(b => {
          const isPermanent = (pid === "vchoice_no_ads" || pid === "vchoice_ultra");
          if (!isPermanent){
            b.disabled = false;
            b.textContent = "Acheter";
          } else {
            // non-consumable: refreshEntitlementsUI gère
          }
        });
      }, 900);
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-buy]") : null;
    if (!btn) return;
    const pid = btn.getAttribute("data-buy");
    if (!pid) return;
    buy(pid, btn);
  });

  // Prix depuis store
  window.addEventListener("vc:iap_price", (ev) => {
    const d = ev?.detail || {};
    const pid = String(d.productId || "");
    const price = String(d.price || "");
    if (!pid) return;
    setPrice(pid, price || "…");
  });

  // Crédit / restore -> update UI
  window.addEventListener("vc:iap_credited", () => {
    refreshEntitlementsUI();
  });

  // init
  refreshAllPrices();
  refreshEntitlementsUI();
  disableAllBuyButtonsIfNoIAP();

  // si store met du temps -> petit refresh
  setTimeout(refreshAllPrices, 1200);
  setTimeout(refreshAllPrices, 2800);

})();