// js/i18n.js — loader i18n + popup choix langue avec validation
// ✅ Supporte JSON imbriqué ET clés plates
// ✅ Si langue déjà enregistrée : pas de popup
// ✅ Sinon : popup langue au démarrage
// ✅ Clic drapeau = sélection seulement, validation via bouton SVG
// ✅ Priorité langue ensuite : localStorage > langue device > EN
// ✅ Fallback fichier : si ui_xx.json absent => ui_en.json

(function () {
  "use strict";

  const UI_PATH = "data/ui";
  const LANG_STORAGE_KEY = "vchoice_lang";
  const SUPPORTED_LANGS = ["fr", "en", "de", "es", "pt", "ptbr", "it", "ko", "ja", "id"];

  // Version actuelle du projet : popup volontairement limitée à FR/EN
  // pour rester cohérent avec les fichiers vraiment présents.
  const LANGUAGE_CHOICES = [
    { code: "fr", label: "Français", flag: "🇫🇷" },
    { code: "en", label: "English", flag: "🇬🇧" }
  ];

  let _dict = {};
  let _lang = "en";
  let _langPickerPromise = null;

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

  function _getPreferredLangWithoutPopup() {
    const stored = _readStoredLang();
    if (stored) return stored;

    const detected = _normalizeLang(_detectDeviceLang()) || "en";
    if (detected === "fr" || detected === "en") return detected;
    return "en";
  }

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

  function _whenDomReady() {
    return new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  function _ensureLanguagePickerStyles() {
    if (document.getElementById("vc-lang-picker-style")) return;

    const style = document.createElement("style");
    style.id = "vc-lang-picker-style";
    style.textContent = `
      .vcLangOverlay{
        position:fixed;
        inset:0;
        z-index:99999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(8,12,22,.72);
        backdrop-filter:blur(6px);
        -webkit-backdrop-filter:blur(6px);
      }

      .vcLangModal{
        width:min(92vw, 420px);
        max-height:86vh;
        overflow:auto;
        border-radius:24px;
        padding:20px 16px 18px;
        background:linear-gradient(180deg, rgba(19,28,48,.98) 0%, rgba(11,17,32,.98) 100%);
        box-shadow:0 28px 80px rgba(0,0,0,.40);
        border:1px solid rgba(255,255,255,.08);
      }

      .vcLangGrid{
        display:grid;
        grid-template-columns:repeat(2, minmax(0,1fr));
        gap:12px;
      }

      .vcLangBtn{
        width:100%;
        min-height:110px;
        padding:12px 8px 12px;
        border:1px solid transparent;
        border-radius:18px;
        background:rgba(255,255,255,.04);
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:8px;
        cursor:pointer;
        appearance:none;
        -webkit-tap-highlight-color:transparent;
        transition:transform .12s ease, border-color .12s ease, background .12s ease, box-shadow .12s ease;
      }

      .vcLangBtn:active{
        transform:scale(.98);
      }

      .vcLangBtn.isActive{
        border-color:rgba(255,255,255,.32);
        background:rgba(255,255,255,.10);
        box-shadow:0 0 0 2px rgba(255,255,255,.08) inset;
      }

      .vcLangFlag{
        font-size:34px;
        line-height:1;
      }

      .vcLangText{
        min-height:30px;
        font-size:clamp(12px, 2.8vw, 14px);
        line-height:1.15;
        font-weight:800;
        color:#ffffff;
        text-align:center;
        word-break:break-word;
      }

      .vcLangActions{
        display:flex;
        justify-content:center;
        margin-top:18px;
      }

      .vcLangConfirm{
        width:68px;
        height:68px;
        min-width:68px;
        min-height:68px;
        padding:0;
        border:0;
        border-radius:18px;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#0b1020;
        background:#ffffff;
        box-shadow:0 12px 30px rgba(0,0,0,.28);
        cursor:pointer;
        transition:transform .12s ease, opacity .12s ease, box-shadow .12s ease;
      }

      .vcLangConfirm:active{
        transform:scale(.98);
      }

      .vcLangConfirm[disabled]{
        opacity:.45;
        cursor:default;
        transform:none;
        box-shadow:none;
      }

      .vcLangConfirm svg{
        width:34px;
        height:34px;
        display:block;
      }
    `;
    document.head.appendChild(style);
  }

  async function _persistChosenLang(lang) {
    const chosen = _safeLang(lang);
    _writeStoredLang(chosen);

    try {
      if (window.VUserData && typeof window.VUserData.setLang === "function") {
        await window.VUserData.setLang(chosen);
      }
    } catch (_) {}

    try {
      window.dispatchEvent(new CustomEvent("vc:lang", { detail: { lang: chosen } }));
    } catch (_) {}

    return chosen;
  }

  async function _showLanguagePicker() {
    if (_langPickerPromise) return _langPickerPromise;

    _langPickerPromise = (async () => {
      await _whenDomReady();
      _ensureLanguagePickerStyles();

      const active = _getPreferredLangWithoutPopup();
      let selected = active;

      return await new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "vcLangOverlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Language");

        const modal = document.createElement("div");
        modal.className = "vcLangModal";

        const grid = document.createElement("div");
        grid.className = "vcLangGrid";

        const buttons = [];
        let confirmBtn = null;

        function refreshActiveState() {
          buttons.forEach((btn) => {
            const isOn = btn.getAttribute("data-lang") === selected;
            btn.classList.toggle("isActive", isOn);
          });
          if (confirmBtn) confirmBtn.disabled = !selected;
        }

        LANGUAGE_CHOICES.forEach((item) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "vcLangBtn" + (selected === item.code ? " isActive" : "");
          btn.setAttribute("data-lang", item.code);
          btn.setAttribute("aria-label", item.label);

          const flag = document.createElement("div");
          flag.className = "vcLangFlag";
          flag.textContent = item.flag;

          const text = document.createElement("div");
          text.className = "vcLangText";
          text.textContent = item.label;

          btn.appendChild(flag);
          btn.appendChild(text);

          btn.addEventListener("click", () => {
            selected = item.code;
            refreshActiveState();
          });

          buttons.push(btn);
          grid.appendChild(btn);
        });

        modal.appendChild(grid);

        const actions = document.createElement("div");
        actions.className = "vcLangActions";

        confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "vcLangConfirm";
        confirmBtn.disabled = !selected;
        confirmBtn.setAttribute("aria-label", "Confirm language");
        confirmBtn.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12.5L9.5 17L19 7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        `;

        confirmBtn.addEventListener("click", async () => {
          const chosen = await _persistChosenLang(selected || active || "en");
          try { overlay.remove(); } catch (_) {}
          _langPickerPromise = null;
          resolve(chosen);
        });

        actions.appendChild(confirmBtn);
        modal.appendChild(actions);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        refreshActiveState();
      });
    })();

    return _langPickerPromise;
  }

  async function _resolveInitialLang(forcedLang) {
    if (forcedLang) {
      return _safeLang(forcedLang);
    }

    const stored = _readStoredLang();
    if (stored) return stored;

    const picked = await _showLanguagePicker();
    return _safeLang(picked || _detectDeviceLang() || "en");
  }

  async function load(lang) {
    const requestedLang = await _resolveInitialLang(lang);
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

    document.documentElement.lang = loadedLang;
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
        return _readStoredLang() || _getPreferredLangWithoutPopup() || "en";
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