// js/i18n.js — loader i18n + compat VRI18n + i18nGet + auto-apply [data-i18n]
// ✅ Supporte JSON imbriqué (ui: { page_title: ... }) ET JSON à clés plates ("ui.page_title": "...").
// ✅ Priorité langue : localStorage > langue device > EN
// ✅ Si rien en localStorage : on lit la langue du device ET on la sauvegarde
// ✅ Fallback fichier : si ui_xx.json absent => ui_en.json

(function () {
  "use strict";

  const UI_PATH = "data/ui";
  const LANG_STORAGE_KEY = "vchoice_lang";
  const SUPPORTED_LANGS = ["fr", "en", "de", "es", "pt", "ptbr", "it", "ko", "ja", "id"];

  let _dict = {};
  let _lang = "en";

  function _normalizeLang(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s) return "";

    s = s.replace(/_/g, "-");

    const map = {
      "pt-br": "ptbr",
      "pt-pt": "pt",
      "ja-jp": "ja",
      "ko-kr": "ko",
      "jp": "ja",
      "kr": "ko",
      "in": "id",
      "id-id": "id"
    };

    const exact = map[s] || s;
    const base = exact.split("-")[0] || "";

    if (SUPPORTED_LANGS.includes(exact)) return exact;
    if (SUPPORTED_LANGS.includes(base)) return base;
    return "";
  }

  function _safeLang(lang) {
    return _normalizeLang(lang) || "en";
  }

  function _readStoredLang() {
    try {
      return _normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
    } catch (_) {
      return "";
    }
  }

  function _writeStoredLang(lang) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, _safeLang(lang));
    } catch (_) {}
  }

  function _detectDeviceLang() {
    try {
      const list = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language || ""];

      for (const raw of list) {
        const n = _normalizeLang(raw);
        if (n) return n;
      }
    } catch (_) {}

    return "en";
  }

  function _getPreferredLangAndPersist() {
    const stored = _readStoredLang();
    if (stored) return stored;

    const detected = _normalizeLang(_detectDeviceLang()) || "en";
    _writeStoredLang(detected);
    return detected;
  }

  // Récupération style "a.b.c" dans un objet imbriqué
  function _getPath(obj, path) {
    const parts = String(path || "").split(".");
    let cur = obj;

    for (const p of parts) {
      if (!cur || typeof cur !== "object" || !(p in cur)) return undefined;
      cur = cur[p];
    }

    return cur;
  }

  function _interpolate(str, vars) {
    if (!vars || !str) return str || "";

    let out = String(str);

    try {
      Object.keys(vars).forEach((k) => {
        out = out.split("{" + k + "}").join(String(vars[k]));
      });
    } catch (_) {}

    return out;
  }

  function t(key, fallback, vars) {
    const k = String(key || "");
    if (!k) return fallback || "";

    let v = _getPath(_dict, k);

    if (v === undefined && _dict && typeof _dict === "object") {
      v = _dict[k];
    }

    const out = typeof v === "string" ? v : (fallback || "");
    return _interpolate(out, vars) || "";
  }

  function apply(root) {
    const r = root || document;

    r.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;

      const val = t(key, "");
      if (val) el.textContent = val;
    });

    r.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (!key) return;

      const val = t(key, "");
      if (val) el.setAttribute("aria-label", val);
    });

    r.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;

      const val = t(key, "");
      if (val) el.setAttribute("title", val);
    });

    r.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;

      const val = t(key, "");
      if (val) el.setAttribute("placeholder", val);
    });
  }

  async function load(lang) {
    const requestedLang = _safeLang(lang || _getPreferredLangAndPersist());
    let loadedLang = requestedLang;

    let res = await fetch(`${UI_PATH}/ui_${requestedLang}.json`, { cache: "no-store" });

    if (!res.ok && requestedLang !== "en") {
      loadedLang = "en";
      res = await fetch(`${UI_PATH}/ui_en.json`, { cache: "no-store" });
    }

    if (!res.ok) {
      throw new Error(`i18n not found for lang=${requestedLang}`);
    }

    _lang = loadedLang;
    _dict = await res.json();

    // IMPORTANT : langue réellement chargée
    document.documentElement.lang = loadedLang;

    // IMPORTANT : on fige aussi la langue réellement chargée
    _writeStoredLang(loadedLang);

    const pageTitle = t("ui.page_title", "");
    if (pageTitle) document.title = pageTitle;

    apply(document);
    return true;
  }

  async function initI18n(lang) {
    return load(lang);
  }

  window.VRI18n = {
    initI18n: initI18n,
    load: load,

    t: function (key, fallback, vars) {
      return t(key, fallback, vars);
    },

    _t: function (key, fallback, vars) {
      return t(key, fallback, vars);
    },

    applyI18n: apply,

    getLang: function () {
      try {
        return _getPreferredLangAndPersist();
      } catch (_) {
        return "en";
      }
    },

    setLang: function (lang) {
      try {
        _writeStoredLang(lang);
      } catch (_) {}
    },

    getLoadedLang: function () {
      return _lang;
    }
  };

  window.i18nGet = function (key) {
    return t(key, "");
  };

  window.VCI18N = {
    load: load,
    t: function (key, fallback, vars) {
      return t(key, fallback, vars);
    },
    _t: function (key, fallback, vars) {
      return t(key, fallback, vars);
    },
    apply: apply,
    getLang: function () {
      return window.VRI18n.getLang();
    },
    setLang: function (lang) {
      return window.VRI18n.setLang(lang);
    }
  };
})();