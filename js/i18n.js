// js/i18n.js
// - Charge data/ui/ui_<lang>.json
// - Détecte la langue appareil si aucune préférence
// - Fallback automatique sur FR si le fichier n'existe pas encore
// - Stocke la langue en localStorage (VREALMS_LANG)

(function(){
  "use strict";

  const STORAGE_KEY = "VREALMS_LANG";
  const UI_PATH = "data/ui";

  // Langues prévues dans l'app (même si certains fichiers ui_<lang>.json ne sont pas encore créés)
  const SUPPORTED_LANGS = ["fr","en","es","pt","ptbr","it","ko","ja","id"];

  let _lang = "fr";
  let _ui = null;

  function normalizeLang(raw){
    if(!raw) return null;
    const s = String(raw).trim().toLowerCase();

    const map = {
      "pt-br":"ptbr",
      "pt_br":"ptbr",
      "pt-pt":"pt",
      "pt_pt":"pt",
      "jp":"ja",
      "ja-jp":"ja",
      "kr":"ko",
      "ko-kr":"ko",
      "id-id":"id",
      "in":"id"
    };
    if(map[s]) return map[s];

    const base = s.split(/[-_]/)[0];
    if(base === "pt" && (s.includes("br") || s.includes("ptbr"))) return "ptbr";
    if(base === "ja") return "ja";
    if(base === "ko") return "ko";
    if(base === "id") return "id";
    return base || null;
  }

  function _safeLang(raw){
    const base = normalizeLang(raw);
    return (base && SUPPORTED_LANGS.includes(base)) ? base : "fr";
  }

  function _detectDeviceLang(){
    const list = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

    for(const candidate of list){
      const base = _safeLang(candidate);
      if(base && SUPPORTED_LANGS.includes(base)) return base;
    }
    return "fr";
  }

  async function _fetchJSON(url){
    const r = await fetch(url, { cache:"no-store" });
    if(!r.ok) throw new Error(`fetch ${url} => ${r.status}`);
    return await r.json();
  }

  async function _loadUIFor(lang){
    const wanted = _safeLang(lang);
    try{
      return await _fetchJSON(`${UI_PATH}/ui_${wanted}.json`);
    }catch(e){
      // fallback FR si le fichier n'existe pas encore
      _lang = "fr";
      return await _fetchJSON(`${UI_PATH}/ui_fr.json`);
    }
  }

  function _applyText(id, value){
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = String(value ?? "");
  }

  function _applyAttr(id, attr, value){
    const el = document.getElementById(id);
    if(!el) return;
    el.setAttribute(attr, String(value ?? ""));
  }

  function _applyAll(){
    if(!_ui || typeof _ui !== "object") return;
    const u = _ui.ui || {};

    // index.html
    _applyText("ui_app_title", u.app_title);
    _applyText("ui_app_subtitle", u.app_subtitle);

    _applyText("ui_index_title", u.index_title);
    _applyText("ui_index_subtitle", u.index_subtitle);

    // boutons / labels s'ils existent sur la page
    _applyText("btnProfileLabel", u.btn_profile);
    _applyText("btnSettingsLabel", u.btn_settings);
    _applyText("btnShopLabel", u.btn_shop);

    // settings.html
    _applyText("settingsTitle", u.settings_title);
    _applyText("settingsLangLabel", u.settings_language_label);
    _applyText("settingsLangDesc", u.settings_language_desc);
    _applyText("settingsBackLabel", u.btn_back);

    // accessibilité
    _applyAttr("btnBackSettings", "aria-label", u.btn_back);
  }

  function getLang(){
    return _lang;
  }

  function setLang(lang){
    _lang = _safeLang(lang);
    try{ localStorage.setItem(STORAGE_KEY, _lang); }catch(e){}
    return _lang;
  }

  async function initI18n(preferred){
    // priorité: param explicite > localStorage > html lang > device
    let lang = preferred;

    if(!lang){
      try{ lang = localStorage.getItem(STORAGE_KEY); }catch(e){}
    }
    if(!lang){
      const htmlLang = document.documentElement?.getAttribute("lang");
      lang = htmlLang || null;
    }
    if(!lang){
      lang = _detectDeviceLang();
    }

    _lang = _safeLang(lang);
    _ui = await _loadUIFor(_lang);
    _applyAll();
    return _lang;
  }

  function t(key, fallback=""){
    if(!_ui || !_ui.ui) return fallback || `[ui.${key}]`;
    const v = _ui.ui[key];
    if(v == null) return fallback || `[ui.${key}]`;
    return String(v);
  }

  window.VRI18n = {
    initI18n,
    t,
    getLang,
    setLang,
    supported: () => SUPPORTED_LANGS.slice(),
    normalize: normalizeLang
  };
})();