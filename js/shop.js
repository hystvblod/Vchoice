// js/shop.js
// ✅ Boutique — 100% i18n keys (aucun texte en dur)

(function(){
  "use strict";

  function isShopPage(){
    try { return document.body && document.body.getAttribute("data-page") === "shop"; }
    catch { return false; }
  }
  if (!isShopPage()) return;

  // =========================
  // i18n helper
  // =========================
  function getI18n(){
    // adapte automatiquement selon ton app (VCI18n / VRI18n)
    return window.VCI18n || window.VRI18n || window.VCI18N || window.VRI18N || null;
  }

  function t(key, vars){
    try{
      const i18n = getI18n();
      if (!i18n) return String(key || "");
      if (typeof i18n.t === "function") return i18n.t(String(key || ""), vars || {});
      if (typeof i18n.get === "function") return i18n.get(String(key || ""), vars || {});
      if (typeof i18n.translate === "function") return i18n.translate(String(key || ""), vars || {});
      return String(key || "");
    }catch(_){
      return String(key || "");
    }
  }

  function applyI18nNow(){
    // Si ton i18n.js gère déjà ça, ça ne gêne pas : on laisse ton système faire.
    try{
      const i18n = getI18n();
      if (i18n && typeof i18n.apply === "function") i18n.apply(document);
      if (i18n && typeof i18n.update === "function") i18n.update(document);
    }catch(_){}
  }

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
    vchoice_jetons_12:   { kind:"jetons", amount:12,   titleKey:"ui.shop_p_jetons12_title",   descKey:"ui.shop_p_jetons12_desc" },
    vchoice_jetons_30:   { kind:"jetons", amount:30,   titleKey:"ui.shop_p_jetons30_title",   descKey:"ui.shop_p_jetons30_desc" },
    vchoice_vcoins_500:  { kind:"vcoins", amount:500,  titleKey:"ui.shop_p_vcoins500_title",  descKey:"ui.shop_p_vcoins500_desc" },
    vchoice_vcoins_3000: { kind:"vcoins", amount:3000, titleKey:"ui.shop_p_vcoins3000_title", descKey:"ui.shop_p_vcoins3000_desc" },
    vchoice_no_ads:      { kind:"no_ads", amount:0,    titleKey:"ui.shop_p_noads_title",      descKey:"ui.shop_p_noads_desc" },
    vchoice_ultra:       { kind:"ultra",  amount:0,    titleKey:"ui.shop_p_diamond_title",    descKey:"ui.shop_p_diamond_desc" }
  };

  const I18N = {
    loading: "ui.loading",
    unavailable: "ui.shop_unavailable",
    buy: "ui.shop_buy",
    enabled: "ui.shop_enabled",
    included: "ui.shop_included"
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
      el.textContent = price || t(I18N.loading);
    });
  }

  function refreshAllPrices(){
    PRODUCT_IDS.forEach(pid => {
      setPrice(pid, getPrice(pid) || t(I18N.loading));
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

    const meta = PRODUCT_META[_openPid] || { titleKey:"", descKey:"" };

    // Icon: on reprend l’icône de la carte cliquée si possible
    try{
      const card = document.querySelector(`[data-product="${CSS.escape(_openPid)}"]`);
      const img = card ? card.querySelector("img[data-product-icon]") : null;
      if (img && modalIcon){
        modalIcon.src = img.getAttribute("src") || "";
      }
    }catch(_){}

    if (modalTitle) modalTitle.textContent = meta.titleKey ? t(meta.titleKey) : "";
    if (modalDesc) modalDesc.textContent = meta.descKey ? t(meta.descKey) : "";

    const p = getPrice(_openPid);
    if (modalPrice) modalPrice.textContent = p ? p : t(I18N.loading);

    if (modalBuy){
      modalBuy.setAttribute("data-buy", _openPid);
      refreshEntitlementsUI();
    }

    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    _lockScroll(true);
  }

  if (modal){
    modal.addEventListener("click", (e) => {
      const tEl = e.target;
      if (!tEl) return;
      if (tEl === modal) closeModal();
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
        btn.textContent = t(I18N.loading);
      }

      await api.order(pid);
    }catch(_){ }
    finally{
      setTimeout(() => {
        refreshEntitlementsUI();
        refreshAllPrices();
        applyI18nNow();
      }, 450);

      setTimeout(() => {
        // pour les consumables, on remet l’état normal
        $all(`[data-buy="${pid}"]`).forEach(b => {
          const isPermanent = (pid === "vchoice_no_ads" || pid === "vchoice_ultra");
          if (!isPermanent){
            b.disabled = false;
            b.textContent = t(I18N.buy);
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
        modalBuy.textContent = ultra ? t(I18N.enabled) : t(I18N.buy);
      } else if (pid === "vchoice_no_ads"){
        if (ultra){
          modalBuy.disabled = true;
          modalBuy.textContent = t(I18N.included);
        } else {
          modalBuy.disabled = noAds;
          modalBuy.textContent = noAds ? t(I18N.enabled) : t(I18N.buy);
        }
      } else {
        modalBuy.disabled = false;
        modalBuy.textContent = t(I18N.buy);
      }
    }

    // Badges visuels sur cards
    $all("[data-product]").forEach(card => {
      const pid = String(card.getAttribute("data-product") || "");
      card.classList.toggle("is-owned", (pid === "vchoice_ultra" && ultra) || (pid === "vchoice_no_ads" && (noAds || ultra)));
      card.classList.toggle("is-ultra-owned", (pid === "vchoice_ultra" && ultra));
      card.classList.toggle("is-noads-owned", (pid === "vchoice_no_ads" && (noAds || ultra)));
    });

    // Si jamais tu ajoutes des boutons d’achat dans la grille plus tard
    $all("[data-buy]").forEach(btn => {
      const pid = String(btn.getAttribute("data-buy") || "");
      if (!pid) return;

      if (pid === "vchoice_ultra"){
        btn.disabled = ultra;
        btn.textContent = ultra ? t(I18N.enabled) : t(I18N.buy);
      } else if (pid === "vchoice_no_ads"){
        if (ultra){
          btn.disabled = true;
          btn.textContent = t(I18N.included);
        } else {
          btn.disabled = noAds;
          btn.textContent = noAds ? t(I18N.enabled) : t(I18N.buy);
        }
      } else {
        btn.disabled = false;
        btn.textContent = t(I18N.buy);
      }
    });
  }

  function disableAllBuyButtonsIfNoIAP(){
    const ok = iapAvailable();
    if (!ok){
      $all("[data-price-for]").forEach(el => { el.textContent = t(I18N.unavailable); });
      if (modalPrice) modalPrice.textContent = t(I18N.unavailable);
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
    if (on){
      btn.textContent = t(I18N.loading);
    } else {
      // remet le texte via i18n
      btn.textContent = t("ui.shop_watch_ad");
    }
  }

  async function rewardJeton(){
    try{
      setAdBusy("jeton", true);
      const r = await window.VAds?.showRewarded?.();
      if (!r || !r.ok) return;

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
    const tEl = e.target;

    // Rewarded buttons
    const adBtn = tEl && tEl.closest ? tEl.closest("[data-ad]") : null;
    if (adBtn){
      const which = String(adBtn.getAttribute("data-ad") || "");
      if (which === "jeton") rewardJeton();
      else if (which === "vcoins") rewardVCoins();
      return;
    }

    // Open product modal
    const card = tEl && tEl.closest ? tEl.closest("[data-product]") : null;
    if (card){
      const pid = card.getAttribute("data-product");
      if (pid) openModalFor(pid);
      return;
    }

    // Modal buy
    const buyBtn = tEl && tEl.closest ? tEl.closest("#shopModalBuy,[data-modal-buy]") : null;
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

    setPrice(pid, price || t(I18N.loading));

    if (_openPid && pid === _openPid && modalPrice){
      modalPrice.textContent = price || t(I18N.loading);
    }
  });

  // Crédit / restore -> update UI
  window.addEventListener("vc:iap_credited", () => {
    refreshEntitlementsUI();
    refreshAllPrices();
    applyI18nNow();
  });

  // init
  applyI18nNow();
  refreshAllPrices();
  refreshEntitlementsUI();
  disableAllBuyButtonsIfNoIAP();

  // store parfois lent -> refresh
  setTimeout(refreshAllPrices, 900);
  setTimeout(refreshAllPrices, 2200);
  setTimeout(refreshAllPrices, 4200);

})();