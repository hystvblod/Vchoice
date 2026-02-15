// js/i18n.js — loader i18n + compat VRI18n + i18nGet + auto-apply [data-i18n]
// Compatible avec ton index.html actuel (helper _t() qui cherche VRI18n.t / i18nGet)

(function () {
  "use strict";

  const UI_PATH = "data/ui";
  let _dict = {};
  let _lang = "fr";

  function _safeLang(lang) {
    return (String(lang || "").toLowerCase() === "en") ? "en" : "fr";
  }

  function t(path, fallback, vars) {
    const parts = (path || "").split(".");
    let cur = _dict;

    for (const p of parts) {
      if (!cur || typeof cur !== "object" || !(p in cur)) return fallback || "";
      cur = cur[p];
    }

    let out = (typeof cur === "string") ? cur : (fallback || "");
    if (vars && out) {
      try {
        Object.keys(vars).forEach((k) => {
          out = out.split("{" + k + "}").join(String(vars[k]));
        });
      } catch (_) {}
    }
    return out || "";
  }

  function apply(root) {
    const r = root || document;

    // Texte
    r.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const val = t(key, "");
      if (val) el.textContent = val;
    });

    // Aria-label
    r.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (!key) return;
      const val = t(key, "");
      if (val) el.setAttribute("aria-label", val);
    });

    // Title attribute (optionnel si tu l’utilises un jour)
    r.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      const val = t(key, "");
      if (val) el.setAttribute("title", val);
    });
  }

  async function load(lang) {
    _lang = _safeLang(lang);

    const url = `${UI_PATH}/ui_${_lang}.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`i18n not found: ${url}`);
    _dict = await res.json();

    // html lang + <title> si la clé existe
    document.documentElement.lang = _lang;
    const pageTitle = t("ui.page_title", "");
    if (pageTitle) document.title = pageTitle;

    // Applique tout de suite
    apply(document);
    return true;
  }

  async function initI18n(lang) {
    // alias pratique (ton index appelle VRI18n.initI18n)
    return load(lang);
  }

  // =========================
  // Expose globals COMPAT
  // =========================

  // ✅ ton index.html cherche ça
  window.VRI18n = {
    initI18n,
    load,
    t: (key, fallback, vars) => t(key, fallback, vars),
    applyI18n: apply,
    getLang: () => (localStorage.getItem("vchoice_lang") || "fr"),
    setLang: (lang) => localStorage.setItem("vchoice_lang", _safeLang(lang))
  };

  // ✅ ton helper _t() accepte aussi i18nGet()
  window.i18nGet = function (key) {
    return t(key, "");
  };

  // (Optionnel) garder l’ancien nom si tu l’utilises ailleurs
  window.VCI18N = {
    load,
    t: (key, fallback, vars) => t(key, fallback, vars),
    apply,
    getLang: () => window.VRI18n.getLang(),
    setLang: (lang) => window.VRI18n.setLang(lang)
  };
})();
