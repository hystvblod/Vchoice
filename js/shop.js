// js/shop.js
// ✅ Page boutique (guard: index.html charge aussi shop.js, donc on ne fait rien hors shop.html)

(function(){
  "use strict";

  function isShopPage(){
    try { return document.body && document.body.getAttribute("data-page") === "shop"; }
    catch { return false; }
  }
  if (!isShopPage()) return;

  // =========================
  // CONFIG
  // =========================
  const PRODUCT_IDS = [
    "vchoice_jetons_12",
    "vchoice_jetons_30",
    "vchoice_vcoins_500",
    "vchoice_vcoins_3000",
    "vchoice_no_ads",
    "vchoice_ultra"
  ];

  const PRODUCT_META = {
    vchoice_jetons_12:   { kind:"jetons", amount:12,   title:"12",   desc:"Pack de jetons à utiliser pour débloquer des scénarios ou certaines actions." },
    vchoice_jetons_30:   { kind:"jetons", amount:30,   title:"30",   desc:"Pack de jetons plus avantageux, pour avancer plus vite." },
    vchoice_vcoins_500:  { kind:"vcoins", amount:500,  title:"500",  desc:"VCoins utilisables pour les achats en jeu et déblocages." },
    vchoice_vcoins_3000: { kind:"vcoins", amount:3000, title:"3000", desc:"Gros pack de VCoins pour le meilleur ratio." },
    vchoice_no_ads:      { kind:"no_ads", amount:0,    title:"No Ads",  desc:"Désactive les publicités interstitielles. Les pubs récompensées restent disponibles (volontaires)." },
    vchoice_ultra:       { kind:"ultra",  amount:0,    title:"Diamond", desc:"Accès Diamond : tous les scénarios actuels et à venir + No Ads. Bonus inclus selon ton pack." }
  };

  // =========================
  // DOM helpers
  // =========================
  function $(sel, root){ return (root || document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

  function getStoreApi(){
    try{ return window.VCIAP || window.VRIAP || null; }catch(_){ return null; }
  }
  function iapAvailable(){
    try{
      const api = getStoreApi();
      return !!api?.isAvailable?.();
    }catch(_){ return false; }
  }

  function getPrice(pid){
    try{
      const api = getStoreApi();
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
      setPrice(pid, getPrice(pid) || "…");
    });
  }

  function entHasUltra(){
    try { return !!window.VCEnt?.hasUltra?.(); } catch(_) { return false; }
  }
  function entHasNoAds(){
    try { return !!window.VCEnt?.hasNoAds?.(); } catch(_) { return false; }
  }

  // =========================
  // Modal (popup)
  // =========================
  const modal = $("#shopModal");
  const modalCard = modal ? $(".shop-modal-card", modal) : null;

  const modalIcon = $("#shopModalIcon");
  const modalTitle = $("#shopModalTitle");
  const modalDesc = $("#shopModalDesc");
  const modalPrice = $("#shopModalPrice");
  const modalBuy = $("#shopModalBuy");
  const modalCancel = $("#shopModalCancel");

  let _openPid = "";

  function _lockScroll(on){
    try{
      document.documentElement.classList.toggle("shop-modal-open", !!on);
      document.body.classList.toggle("shop-modal-open", !!on);
    }catch(_){}
  }

  function closeModal(){
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-open");
    _openPid = "";
    _lockScroll(false);
    try{ modalBuy.disabled = false; }catch(_){}
  }

  function openModalFor(pid){
    if (!modal || !pid) return;

    _openPid = String(pid);

    const meta = PRODUCT_META[_openPid] || { title:"", desc:"" };

    // Icon: on reprend l’icône de la carte cliquée si possible
    try{
      const card = document.querySelector(`[data-product="${CSS.escape(_openPid)}"]`);
      const img = card ? card.querySelector("img[data-product-icon]") : null;
      if (img && modalIcon){
        modalIcon.src = img.getAttribute("src") || "";
      }
    }catch(_){}

    if (modalTitle) modalTitle.textContent = meta.title || "";
    if (modalDesc) modalDesc.textContent = meta.desc || "";
    if (modalPrice) modalPrice.textContent = getPrice(_openPid) || "…";

    if (modalBuy){
      modalBuy.setAttribute("data-buy", _openPid);
      // état bouton (non-consumables)
      refreshEntitlementsUI();
    }

    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    _lockScroll(true);
  }

  // Click outside to close
  if (modal){
    modal.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      if (t === modal) closeModal();
    });
  }
  if (modalCancel){
    modalCancel.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.classList.contains("is-open")){
      closeModal();
    }
  });

  // =========================
  // Buy flow (IAP)
  // =========================
  async function buy(pid, btn){
    try{
      const api = getStoreApi();
      if (!api?.order) return;

      if (btn){
        btn.disabled = true;
        btn.textContent = "…";
      }

      await api.order(pid);
      // l’UI se mettra à jour sur vc:iap_credited (ou restore)
    }catch(_){ }
    finally{
      setTimeout(() => {
        refreshEntitlementsUI();
        refreshAllPrices();
      }, 450);

      setTimeout(() => {
        // pour les consumables, on remet l’état normal
        $all(`[data-buy="${pid}"]`).forEach(b => {
          const isPermanent = (pid === "vchoice_no_ads" || pid === "vchoice_ultra");
          if (!isPermanent){
            b.disabled = false;
            b.textContent = "Acheter";
          }
        });
      }, 900);
    }
  }

  function refreshEntitlementsUI(){
    const ultra = entHasUltra();
    const noAds = entHasNoAds();

    // Bouton modal (si ouvert)
    if (modalBuy){
      const pid = String(modalBuy.getAttribute("data-buy") || "");
      if (pid === "vchoice_ultra"){
        modalBuy.disabled = ultra;
        modalBuy.textContent = ultra ? "Activé" : "Acheter";
      } else if (pid === "vchoice_no_ads"){
        if (ultra){
          modalBuy.disabled = true;
          modalBuy.textContent = "Inclus";
        } else {
          modalBuy.disabled = noAds;
          modalBuy.textContent = noAds ? "Activé" : "Acheter";
        }
      } else {
        modalBuy.disabled = false;
        modalBuy.textContent = "Acheter";
      }
    }

    // Badges visuels sur cards
    $all("[data-product]").forEach(card => {
      const pid = String(card.getAttribute("data-product") || "");
      card.classList.toggle("is-owned", (pid === "vchoice_ultra" && ultra) || (pid === "vchoice_no_ads" && (noAds || ultra)));
      card.classList.toggle("is-ultra-owned", (pid === "vchoice_ultra" && ultra));
      card.classList.toggle("is-noads-owned", (pid === "vchoice_no_ads" && (noAds || ultra)));
    });

    // Buy buttons inside cards (si présents)
    $all("[data-buy]").forEach(btn => {
      const pid = String(btn.getAttribute("data-buy") || "");
      if (pid === "vchoice_ultra"){
        btn.disabled = ultra;
        btn.textContent = ultra ? "Activé" : "Acheter";
      } else if (pid === "vchoice_no_ads"){
        if (ultra){
          btn.disabled = true;
          btn.textContent = "Inclus";
        } else {
          btn.disabled = noAds;
          btn.textContent = noAds ? "Activé" : "Acheter";
        }
      } else {
        btn.disabled = false;
        btn.textContent = "Acheter";
      }
    });
  }

  function disableAllBuyButtonsIfNoIAP(){
    const ok = iapAvailable();
    if (!ok){
      $all("[data-buy]").forEach(btn => {
        btn.disabled = true;
        btn.textContent = "—";
      });
      $all("[data-price-for]").forEach(el => { el.textContent = "—"; });
    }
  }

  // =========================
  // Rewarded ads (top offers)
  // =========================
  function setAdBusy(which, on){
    const btn = $(`[data-ad="${which}"]`);
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle("is-busy", !!on);
  }

  async function rewardJeton(){
    try{
      setAdBusy("jeton", true);
      const r = await window.VAds?.showRewarded?.();
      if (!r || !r.ok) return;

      // crédit
      if (window.VUserData?.addJetons){
        await window.VUserData.addJetons(1);
      }
    }catch(_){ }
    finally{
      setAdBusy("jeton", false);
    }
  }

  async function rewardVCoins(){
    try{
      setAdBusy("vcoins", true);
      const r = await window.VAds?.showRewarded?.();
      if (!r || !r.ok) return;

      if (window.VUserData?.addVCoins){
        await window.VUserData.addVCoins(100);
      }
    }catch(_){ }
    finally{
      setAdBusy("vcoins", false);
    }
  }

  // =========================
  // Events
  // =========================
  document.addEventListener("click", (e) => {
    const t = e.target;

    // Rewarded buttons
    const adBtn = t && t.closest ? t.closest("[data-ad]") : null;
    if (adBtn){
      const which = String(adBtn.getAttribute("data-ad") || "");
      if (which === "jeton") rewardJeton();
      else if (which === "vcoins") rewardVCoins();
      return;
    }

    // Open product modal
    const card = t && t.closest ? t.closest("[data-product]") : null;
    if (card){
      const pid = card.getAttribute("data-product");
      if (pid) openModalFor(pid);
      return;
    }

    // Modal buy
    const buyBtn = t && t.closest ? t.closest("#shopModalBuy,[data-modal-buy]") : null;
    if (buyBtn){
      const pid = buyBtn.getAttribute("data-buy") || buyBtn.getAttribute("data-modal-buy");
      if (pid) buy(pid, buyBtn);
      return;
    }
  });

  // Prix depuis store
  window.addEventListener("vc:iap_price", (ev) => {
    const d = ev?.detail || {};
    const pid = String(d.productId || "");
    const price = String(d.price || "");
    if (!pid) return;
    setPrice(pid, price || "…");

    // si le modal est ouvert sur ce pid, update direct
    if (_openPid && pid === _openPid && modalPrice){
      modalPrice.textContent = price || "…";
    }
  });

  // Crédit / restore -> update UI
  window.addEventListener("vc:iap_credited", () => {
    refreshEntitlementsUI();
    refreshAllPrices();
  });

  // init
  refreshAllPrices();
  refreshEntitlementsUI();
  disableAllBuyButtonsIfNoIAP();

  // store parfois lent -> refresh
  setTimeout(refreshAllPrices, 900);
  setTimeout(refreshAllPrices, 2200);
  setTimeout(refreshAllPrices, 4200);

})();