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

  function _asText(v, fallback){
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "1" : "0";
    return (typeof fallback === "string") ? fallback : "";
  }

  function t(key, vars){
    const k = String(key || "");
    const v = (vars && typeof vars === "object") ? vars : null;

    try{
      const i18n = getI18n();
      if (!i18n) return k;

      // ✅ IMPORTANT: ton i18n.js a la signature t(key, fallback, vars)
      if (typeof i18n.t === "function"){
        const out = i18n.t(k, k, v || undefined);
        return _asText(out, k);
      }

      // fallback (au cas où tu changes d’i18n plus tard)
      if (typeof i18n.get === "function"){
        const out = i18n.get(k, k, v || undefined);
        return _asText(out, k);
      }
      if (typeof i18n.translate === "function"){
        const out = i18n.translate(k, k, v || undefined);
        return _asText(out, k);
      }

      return k;
    }catch(_){
      return k;
    }
  }

  function applyI18nNow(){
    // ton i18n.js expose applyI18n(root)
    try{
      const i18n = getI18n();
      if (i18n && typeof i18n.applyI18n === "function") i18n.applyI18n(document);
      if (i18n && typeof i18n.apply === "function") i18n.apply(document);
      if (i18n && typeof i18n.update === "function") i18n.update(document);
    }catch(_){}
  }

  async function ensureI18nReady(){
    try{
      const i18n = getI18n();
      if (!i18n) return;

      let lang = "";
      try{ lang = String(localStorage.getItem("vchoice_lang") || ""); }catch(_){ lang = ""; }
      if (!lang){
        try{ lang = String(window.VUserData?.getLang?.() || ""); }catch(_){ lang = ""; }
      }
      if (!lang) lang = "fr";

      if (typeof i18n.initI18n === "function"){
        await i18n.initI18n(lang);
        return;
      }
      if (typeof i18n.load === "function"){
        await i18n.load(lang);
        return;
      }
    }catch(_){}
  }

  // =========================
  // CONFIG
  // =========================
  const PRODUCT_IDS = [
    "vchoice_jetons_12",
    "vchoice_jetons_30",
    "vchoice_vcoins_1200",
    "vchoice_vcoins_3000",
    "vchoice_no_ads",
    "vchoice_ultra"
  ];

  const PRODUCT_META = {
    vchoice_jetons_12:   { kind:"jetons", amount:12,   titleKey:"ui.shop_p_jetons12_title",   descKey:"ui.shop_p_jetons12_desc" },
    vchoice_jetons_30:   { kind:"jetons", amount:30,   titleKey:"ui.shop_p_jetons30_title",   descKey:"ui.shop_p_jetons30_desc" },
    vchoice_vcoins_1200:  { kind:"vcoins", amount:1200,  titleKey:"ui.shop_p_vcoins1200_title",  descKey:"ui.shop_p_vcoins1200_desc" },
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

  // =========================
  // PRICE SANITIZER (FIX [object Object])
  // =========================
  function sanitizePrice(v){
    try{
      if (!v) return "";
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);

      if (typeof v === "object"){
        // cas possibles selon impl store / wrappers
        if (v?.pricing?.price) return String(v.pricing.price);

        if (typeof v.getOffer === "function"){
          const offer = v.getOffer();
          if (offer?.pricing?.price) return String(offer.pricing.price);
        }

        // parfois direct { price: "0,99 €" }
        if (v?.price) return String(v.price);
      }

      return "";
    }catch(_){
      return "";
    }
  }

  // =========================
  // Store helpers
  // =========================
  function getPrice(pid){
    try{
      const api = getStoreApi();
      const v = api?.getPrice?.(pid);
      return sanitizePrice(v);
    }catch(_){ return ""; }
  }

  function setPrice(pid, price){
    const p = sanitizePrice(price);
    $all(`[data-price-for="${pid}"]`).forEach(el => {
      el.textContent = p || t(I18N.loading);
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
      btn.textContent = t("ui.shop_watch_ad");
    }
  }

  async function doRewarded(which){
    const cfgMap = {
      jeton:  { kind: "jetons", amount: 1,   placement: "shop_jeton" },
      vcoins: { kind: "vcoins", amount: 100, placement: "shop_vcoins" }
    };

    const cfg = cfgMap[String(which || "")];
    if (!cfg) return false;

    try{
      setAdBusy(which, true);

      const before =
        cfg.kind === "jetons"
          ? Number(window.VUserData?.getJetons?.() || 0)
          : Number(window.VUserData?.getVCoins?.() || 0);

      const r = await window.VAds?.showRewarded?.({ placement: cfg.placement });
      if (!r || !r.ok) return false;

      if (cfg.kind === "jetons"){
        if (typeof window.VUserData?.addJetons !== "function") return false;
        await window.VUserData.addJetons(cfg.amount);
      } else {
        if (typeof window.VUserData?.addVCoins !== "function") return false;
        await window.VUserData.addVCoins(cfg.amount);
      }

      try { await window.VUserData?.refresh?.(); } catch(_) {}

      const after =
        cfg.kind === "jetons"
          ? Number(window.VUserData?.getJetons?.() || 0)
          : Number(window.VUserData?.getVCoins?.() || 0);

      if (after < before + cfg.amount){
        return false;
      }

      try { window.VAds?.markGameRewardSeen?.(); } catch(_) {}

      refreshEntitlementsUI();
      refreshAllPrices();
      applyI18nNow();

      return true;
    }catch(_){
      return false;
    }finally{
      setAdBusy(which, false);
    }
  }

  async function rewardJeton(){
    return doRewarded("jeton");
  }

  async function rewardVCoins(){
    return doRewarded("vcoins");
  }

  // =========================
  // Books / Amazon
  // =========================

  const BOOK_MARKET_STORAGE_KEY = "vchoice_book_market";

  const BOOKS = [
    {
      id: "book_01",
      cover: "assets/img/books/book_01.webp",
      titleKey: "ui.book_01_title",
      descKey: "ui.book_01_desc",
      asins: {
        fr: "ASIN_BOOK_01_FR",
        en: "ASIN_BOOK_01_EN",
        de: "ASIN_BOOK_01_DE",
        es: "ASIN_BOOK_01_ES",
        it: "ASIN_BOOK_01_IT"
      }
    },
    {
      id: "book_02",
      cover: "assets/img/books/book_02.webp",
      titleKey: "ui.book_02_title",
      descKey: "ui.book_02_desc",
      asins: {
        fr: "ASIN_BOOK_02_FR",
        en: "ASIN_BOOK_02_EN",
        de: "ASIN_BOOK_02_DE",
        es: "ASIN_BOOK_02_ES",
        it: "ASIN_BOOK_02_IT"
      }
    },
    {
      id: "book_03",
      cover: "assets/img/books/book_03.webp",
      titleKey: "ui.book_03_title",
      descKey: "ui.book_03_desc",
      asins: {
        fr: "ASIN_BOOK_03_FR",
        en: "ASIN_BOOK_03_EN",
        de: "ASIN_BOOK_03_DE",
        es: "ASIN_BOOK_03_ES",
        it: "ASIN_BOOK_03_IT"
      }
    },
    {
      id: "book_04",
      cover: "assets/img/books/book_04.webp",
      titleKey: "ui.book_04_title",
      descKey: "ui.book_04_desc",
      asins: {
        fr: "ASIN_BOOK_04_FR",
        en: "ASIN_BOOK_04_EN",
        de: "ASIN_BOOK_04_DE",
        es: "ASIN_BOOK_04_ES",
        it: "ASIN_BOOK_04_IT"
      }
    },
    {
      id: "book_05",
      cover: "assets/img/books/book_05.webp",
      titleKey: "ui.book_05_title",
      descKey: "ui.book_05_desc",
      asins: {
        fr: "ASIN_BOOK_05_FR",
        en: "ASIN_BOOK_05_EN",
        de: "ASIN_BOOK_05_DE",
        es: "ASIN_BOOK_05_ES",
        it: "ASIN_BOOK_05_IT"
      }
    },
    {
      id: "book_06",
      cover: "assets/img/books/book_06.webp",
      titleKey: "ui.book_06_title",
      descKey: "ui.book_06_desc",
      asins: {
        fr: "ASIN_BOOK_06_FR",
        en: "ASIN_BOOK_06_EN",
        de: "ASIN_BOOK_06_DE",
        es: "ASIN_BOOK_06_ES",
        it: "ASIN_BOOK_06_IT"
      }
    },
    {
      id: "book_07",
      cover: "assets/img/books/book_07.webp",
      titleKey: "ui.book_07_title",
      descKey: "ui.book_07_desc",
      asins: {
        fr: "ASIN_BOOK_07_FR",
        en: "ASIN_BOOK_07_EN",
        de: "ASIN_BOOK_07_DE",
        es: "ASIN_BOOK_07_ES",
        it: "ASIN_BOOK_07_IT"
      }
    },
    {
      id: "book_08",
      cover: "assets/img/books/book_08.webp",
      titleKey: "ui.book_08_title",
      descKey: "ui.book_08_desc",
      asins: {
        fr: "ASIN_BOOK_08_FR",
        en: "ASIN_BOOK_08_EN",
        de: "ASIN_BOOK_08_DE",
        es: "ASIN_BOOK_08_ES",
        it: "ASIN_BOOK_08_IT"
      }
    },
    {
      id: "book_09",
      cover: "assets/img/books/book_09.webp",
      titleKey: "ui.book_09_title",
      descKey: "ui.book_09_desc",
      asins: {
        fr: "ASIN_BOOK_09_FR",
        en: "ASIN_BOOK_09_EN",
        de: "ASIN_BOOK_09_DE",
        es: "ASIN_BOOK_09_ES",
        it: "ASIN_BOOK_09_IT"
      }
    },
    {
      id: "book_10",
      cover: "assets/img/books/book_10.webp",
      titleKey: "ui.book_10_title",
      descKey: "ui.book_10_desc",
      asins: {
        fr: "ASIN_BOOK_10_FR",
        en: "ASIN_BOOK_10_EN",
        de: "ASIN_BOOK_10_DE",
        es: "ASIN_BOOK_10_ES",
        it: "ASIN_BOOK_10_IT"
      }
    },
    {
      id: "book_11",
      cover: "assets/img/books/book_11.webp",
      titleKey: "ui.book_11_title",
      descKey: "ui.book_11_desc",
      asins: {
        fr: "ASIN_BOOK_11_FR",
        en: "ASIN_BOOK_11_EN",
        de: "ASIN_BOOK_11_DE",
        es: "ASIN_BOOK_11_ES",
        it: "ASIN_BOOK_11_IT"
      }
    },
    {
      id: "book_12",
      cover: "assets/img/books/book_12.webp",
      titleKey: "ui.book_12_title",
      descKey: "ui.book_12_desc",
      asins: {
        fr: "B0GYG3CQHZ",
        en: "B0GYS49PNJ",
        de: "B0GYQPX3BP",
        es: "ASIN_BOOK_12_ES",
        it: "ASIN_BOOK_12_IT"
      }
    }
  ];

  const BOOK_MARKETS = [
    {
      id: "fr_FR",
      labelKey: "ui.book_market_fr_fr",
      domain: "amazon.fr",
      lang: "fr",
      localeMatches: ["fr-FR"],
      regionMatches: ["FR"]
    },
    {
      id: "fr_BE",
      labelKey: "ui.book_market_fr_be",
      domain: "amazon.com.be",
      lang: "fr",
      localeMatches: ["fr-BE"],
      regionMatches: ["BE"]
    },
    {
      id: "fr_CH",
      labelKey: "ui.book_market_fr_ch",
      domain: "amazon.fr",
      lang: "fr",
      localeMatches: ["fr-CH"],
      regionMatches: []
    },
    {
      id: "fr_LU",
      labelKey: "ui.book_market_fr_lu",
      domain: "amazon.fr",
      lang: "fr",
      localeMatches: ["fr-LU"],
      regionMatches: []
    },
    {
      id: "fr_MC",
      labelKey: "ui.book_market_fr_mc",
      domain: "amazon.fr",
      lang: "fr",
      localeMatches: ["fr-MC"],
      regionMatches: ["MC"]
    },

    {
      id: "en_GB",
      labelKey: "ui.book_market_en_gb",
      domain: "amazon.co.uk",
      lang: "en",
      localeMatches: ["en-GB"],
      regionMatches: ["GB"]
    },
    {
      id: "en_IE",
      labelKey: "ui.book_market_en_ie",
      domain: "amazon.ie",
      lang: "en",
      localeMatches: ["en-IE"],
      regionMatches: ["IE"]
    },
    {
      id: "en_US",
      labelKey: "ui.book_market_en_us",
      domain: "amazon.com",
      lang: "en",
      localeMatches: ["en-US"],
      regionMatches: ["US"]
    },
    {
      id: "en_CA",
      labelKey: "ui.book_market_en_ca",
      domain: "amazon.ca",
      lang: "en",
      localeMatches: ["en-CA"],
      regionMatches: ["CA"]
    },
    {
      id: "en_AU",
      labelKey: "ui.book_market_en_au",
      domain: "amazon.com.au",
      lang: "en",
      localeMatches: ["en-AU"],
      regionMatches: ["AU"]
    },
    {
      id: "en_NL",
      labelKey: "ui.book_market_en_nl",
      domain: "amazon.nl",
      lang: "en",
      localeMatches: ["nl-NL", "en-NL"],
      regionMatches: ["NL"]
    },

    {
      id: "de_DE",
      labelKey: "ui.book_market_de_de",
      domain: "amazon.de",
      lang: "de",
      localeMatches: ["de-DE"],
      regionMatches: ["DE"]
    },
    {
      id: "de_AT",
      labelKey: "ui.book_market_de_at",
      domain: "amazon.de",
      lang: "de",
      localeMatches: ["de-AT"],
      regionMatches: ["AT"]
    },
    {
      id: "de_CH",
      labelKey: "ui.book_market_de_ch",
      domain: "amazon.de",
      lang: "de",
      localeMatches: ["de-CH"],
      regionMatches: []
    },
    {
      id: "de_LU",
      labelKey: "ui.book_market_de_lu",
      domain: "amazon.de",
      lang: "de",
      localeMatches: ["de-LU"],
      regionMatches: []
    },

    {
      id: "it_IT",
      labelKey: "ui.book_market_it_it",
      domain: "amazon.it",
      lang: "it",
      localeMatches: ["it-IT"],
      regionMatches: ["IT"]
    },
    {
      id: "it_CH",
      labelKey: "ui.book_market_it_ch",
      domain: "amazon.it",
      lang: "it",
      localeMatches: ["it-CH"],
      regionMatches: []
    },

    {
      id: "es_ES",
      labelKey: "ui.book_market_es_es",
      domain: "amazon.es",
      lang: "es",
      localeMatches: ["es-ES"],
      regionMatches: ["ES"]
    }
  ];

  const BOOK_LANGUAGE_FALLBACKS = {
    fr: "fr_FR",
    en: "en_US",
    de: "de_DE",
    es: "es_ES",
    it: "it_IT",
    nl: "en_NL"
  };

  function normalizeLocaleTag(tag){
    return String(tag || "")
      .trim()
      .replace(/_/g, "-");
  }

  function getLocaleLanguage(tag){
    const safeTag = normalizeLocaleTag(tag);
    if (!safeTag) return "";
    return safeTag.split("-")[0].toLowerCase();
  }

  function getRegionFromLocale(tag){
    const safeTag = normalizeLocaleTag(tag);
    if (!safeTag) return "";

    try{
      const loc = new Intl.Locale(safeTag);
      if (loc && loc.region) return String(loc.region).toUpperCase();

      const max = loc.maximize ? loc.maximize() : null;
      if (max && max.region) return String(max.region).toUpperCase();
    }catch(_){}

    const parts = safeTag.split("-");
    if (parts.length >= 2){
      const last = parts[parts.length - 1];
      if (/^[a-zA-Z]{2}$/.test(last)) return last.toUpperCase();
    }

    return "";
  }

  function getLocaleCandidates(){
    const out = [];

    try{
      if (Array.isArray(navigator.languages)){
        navigator.languages.forEach(v => {
          const n = normalizeLocaleTag(v);
          if (n) out.push(n);
        });
      }
    }catch(_){}

    try{
      const n = normalizeLocaleTag(navigator.language);
      if (n) out.push(n);
    }catch(_){}

    return out.filter(Boolean);
  }

  function getBookMarketById(id){
    return BOOK_MARKETS.find(m => String(m.id) === String(id)) || null;
  }

  function getSavedBookMarket(){
    try{
      const saved = localStorage.getItem(BOOK_MARKET_STORAGE_KEY);
      if (!saved) return null;
      return getBookMarketById(saved);
    }catch(_){
      return null;
    }
  }

  function saveBookMarket(marketId){
    try{
      localStorage.setItem(BOOK_MARKET_STORAGE_KEY, String(marketId || ""));
    }catch(_){}
  }

  function detectBookMarketFromPhone(){
    const locales = getLocaleCandidates();

    for (const locale of locales){
      const normalized = normalizeLocaleTag(locale);

      const exactMarket = BOOK_MARKETS.find(m => {
        return Array.isArray(m.localeMatches) && m.localeMatches.includes(normalized);
      });

      if (exactMarket) return exactMarket;
    }

    for (const locale of locales){
      const region = getRegionFromLocale(locale);

      if (!region) continue;

      const regionMarket = BOOK_MARKETS.find(m => {
        return Array.isArray(m.regionMatches) && m.regionMatches.includes(region);
      });

      if (regionMarket) return regionMarket;
    }

    for (const locale of locales){
      const lang = getLocaleLanguage(locale);
      const fallbackMarketId = BOOK_LANGUAGE_FALLBACKS[lang];

      if (!fallbackMarketId) continue;

      const fallbackMarket = getBookMarketById(fallbackMarketId);
      if (fallbackMarket) return fallbackMarket;
    }

    return null;
  }

  function getBookMarket(){
    return getSavedBookMarket() || detectBookMarketFromPhone();
  }

  function isPlaceholderAsin(asin){
    const safe = String(asin || "").trim();
    return !safe || safe.includes("ASIN_BOOK_");
  }

  function buildAmazonBookUrl(book){
    const market = getBookMarket();
    if (!market || !market.domain || !market.lang) return "";

    const asin = String(book?.asins?.[market.lang] || "").trim();

    if (isPlaceholderAsin(asin)) return "";

    return `https://www.${market.domain}/dp/${encodeURIComponent(asin)}`;
  }

  function getBookById(id){
    return BOOKS.find(b => String(b.id) === String(id)) || null;
  }

  function openAmazonUrl(url){
    const safeUrl = String(url || "").trim();
    if (!safeUrl) return;

    try{
      window.open(safeUrl, "_blank", "noopener,noreferrer");
    }catch(_){
      try{ window.location.href = safeUrl; }catch(__){}
    }
  }

  function getBookMarketLabel(){
    const market = getBookMarket();
    if (!market) return "";

    return t("ui.book_market_note", {
      market: String(market.domain || "")
    });
  }

  const bookModal = $("#bookModal");
  const bookModalCover = $("#bookModalCover");
  const bookModalTitle = $("#bookModalTitle");
  const bookModalDesc = $("#bookModalDesc");
  const bookModalCountry = $("#bookModalCountry");
  const bookModalAmazon = $("#bookModalAmazon");
  const bookModalCancel = $("#bookModalCancel");
  const bookChangeMarket = $("#bookChangeMarket");

  const bookMarketModal = $("#bookMarketModal");
  const bookMarketList = $("#bookMarketList");
  const bookMarketCancel = $("#bookMarketCancel");

  let currentBookModalId = "";

  function closeBookModal(){
    if (!bookModal) return;

    bookModal.setAttribute("aria-hidden", "true");
    bookModal.classList.remove("is-open");

    if (bookModalAmazon) bookModalAmazon.setAttribute("data-book-amazon", "");

    currentBookModalId = "";
    _lockScroll(false);
  }

  function openBookModal(bookId){
    const book = getBookById(bookId);
    if (!book || !bookModal) return;

    const url = buildAmazonBookUrl(book);
    if (!url) return;

    currentBookModalId = bookId;

    if (bookModalCover){
      bookModalCover.src = book.cover || "";
      bookModalCover.alt = "";
    }

    if (bookModalTitle) bookModalTitle.textContent = t(book.titleKey);
    if (bookModalDesc) bookModalDesc.textContent = t(book.descKey);
    if (bookModalCountry) bookModalCountry.textContent = getBookMarketLabel();

    if (bookModalAmazon){
      bookModalAmazon.textContent = t("ui.book_buy_amazon");
      bookModalAmazon.setAttribute("data-book-amazon", url);
    }

    bookModal.setAttribute("aria-hidden", "false");
    bookModal.classList.add("is-open");
    _lockScroll(true);
  }

  function closeBookMarketModal(){
    if (!bookMarketModal) return;

    bookMarketModal.setAttribute("aria-hidden", "true");
    bookMarketModal.classList.remove("is-open");

    if (bookModal && bookModal.classList.contains("is-open")){
      _lockScroll(true);
    }else{
      _lockScroll(false);
    }
  }

  function openBookMarketModal(){
    renderBookMarketList();

    if (!bookMarketModal) return;

    bookMarketModal.setAttribute("aria-hidden", "false");
    bookMarketModal.classList.add("is-open");
    _lockScroll(true);
  }

  function renderBookMarketList(){
    if (!bookMarketList) return;

    const activeMarket = getBookMarket();

    bookMarketList.innerHTML = BOOK_MARKETS.map(market => {
      const activeClass = activeMarket && activeMarket.id === market.id ? " is-active" : "";

      return `
        <button class="book-market-option${activeClass}" type="button" data-book-market="${market.id}">
          ${t(market.labelKey)}
        </button>
      `;
    }).join("");
  }

  function refreshOpenBookModalAfterMarketChange(){
    if (!currentBookModalId) return;

    const book = getBookById(currentBookModalId);
    if (!book) return;

    const url = buildAmazonBookUrl(book);

    if (!url){
      closeBookModal();
      return;
    }

    if (bookModalCountry) bookModalCountry.textContent = getBookMarketLabel();

    if (bookModalAmazon){
      bookModalAmazon.textContent = t("ui.book_buy_amazon");
      bookModalAmazon.setAttribute("data-book-amazon", url);
    }
  }

  function renderBooks(){
    const grid = $("#bookGrid");
    const section = $("#booksSection");
    const divider = $("#booksDivider");

    if (!grid) return;

    const market = getBookMarket();

    if (!market){
      grid.innerHTML = "";
      if (section) section.style.display = "none";
      if (divider) divider.style.display = "none";
      return;
    }

    const availableBooks = BOOKS
      .map(book => {
        return {
          book,
          url: buildAmazonBookUrl(book)
        };
      })
      .filter(item => !!item.url);

    if (!availableBooks.length){
      grid.innerHTML = "";
      if (section) section.style.display = "none";
      if (divider) divider.style.display = "none";
      return;
    }

    if (section) section.style.display = "";
    if (divider) divider.style.display = "";

    grid.innerHTML = availableBooks.map(item => {
      const book = item.book;
      const title = t(book.titleKey);

      return `
        <article class="shop-panel book-card" data-book-card="${book.id}">
          <div class="book-inner">
            <button class="book-cover-btn" type="button" data-book-open="${book.id}" aria-label="${title}">
              <img class="book-cover" src="${book.cover}" alt="" draggable="false" />
            </button>

            <div class="book-title">${title}</div>

            <button class="book-buy-btn" type="button" data-book-buy="${item.url}">
              ${t("ui.book_buy_amazon")}
            </button>
          </div>
        </article>
      `;
    }).join("");
  }

  if (bookModal){
    bookModal.addEventListener("click", (e) => {
      const tEl = e.target;
      if (!tEl) return;
      if (tEl === bookModal) closeBookModal();
    });
  }

  if (bookModalCancel){
    bookModalCancel.addEventListener("click", (e) => {
      e.preventDefault();
      closeBookModal();
    });
  }

  if (bookChangeMarket){
    bookChangeMarket.addEventListener("click", (e) => {
      e.preventDefault();
      openBookMarketModal();
    });
  }

  if (bookMarketModal){
    bookMarketModal.addEventListener("click", (e) => {
      const tEl = e.target;
      if (!tEl) return;
      if (tEl === bookMarketModal) closeBookMarketModal();
    });
  }

  if (bookMarketCancel){
    bookMarketCancel.addEventListener("click", (e) => {
      e.preventDefault();
      closeBookMarketModal();
    });
  }

  if (bookMarketList){
    bookMarketList.addEventListener("click", (e) => {
      const tEl = e.target;
      const btn = tEl && tEl.closest ? tEl.closest("[data-book-market]") : null;
      if (!btn) return;

      const marketId = btn.getAttribute("data-book-market");
      const market = getBookMarketById(marketId);

      if (!market) return;

      saveBookMarket(market.id);
      renderBooks();
      refreshOpenBookModalAfterMarketChange();
      closeBookMarketModal();
    });
  }

  // =========================
  // Events
  // =========================
  document.addEventListener("click", (e) => {
    const tEl = e.target;

    // Books: ouverture popup via couverture
    const bookOpen = tEl && tEl.closest ? tEl.closest("[data-book-open]") : null;
    if (bookOpen){
      const bookId = bookOpen.getAttribute("data-book-open");
      if (bookId) openBookModal(bookId);
      return;
    }

    // Books: achat direct Amazon
    const bookBuy = tEl && tEl.closest ? tEl.closest("[data-book-buy]") : null;
    if (bookBuy){
      const url = bookBuy.getAttribute("data-book-buy");
      openAmazonUrl(url);
      return;
    }

    // Books: achat depuis popup
    const bookAmazon = tEl && tEl.closest ? tEl.closest("[data-book-amazon]") : null;
    if (bookAmazon){
      const url = bookAmazon.getAttribute("data-book-amazon");
      openAmazonUrl(url);
      return;
    }

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
    const price = sanitizePrice(d.price); // ✅ FIX: évite String(object) => [object Object]
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

  // init (⚠️ sur shop.html tu n’avais pas d’init i18n, donc tout tombait en fallback -> [object Object])
  (async function boot(){
    await ensureI18nReady();

    renderBooks();

    applyI18nNow();
    refreshEntitlementsUI();
    refreshAllPrices();
    disableAllBuyButtonsIfNoIAP();

    // store parfois lent -> refresh
    setTimeout(refreshAllPrices, 900);
    setTimeout(refreshAllPrices, 2200);
    setTimeout(refreshAllPrices, 4200);
  })();

})();
