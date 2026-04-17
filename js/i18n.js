// js/i18n.js — loader i18n + popup choix langue avec validation
// ✅ Supporte JSON imbriqué ET clés plates
// ✅ Si langue déjà enregistrée : pas de popup
// ✅ Sinon : popup langue au démarrage
// ✅ Clic drapeau = sélection seulement, validation via bouton SVG
// ✅ Langues affichées sous les drapeaux dans leur propre langue
// ✅ Popup déjà prête pour FR / EN / DE / ES / PT / PTBR / IT / KO / JA / ID
// ✅ Priorité langue ensuite : localStorage > langue device > EN
// ✅ Fallback fichier : si ui_xx.json absent => ui_en.json

(function () {
  "use strict";

  const UI_PATH = "data/ui";
  const LANG_STORAGE_KEY = "vchoice_lang";
  const SUPPORTED_LANGS = ["fr", "en", "de", "es", "eslatam", "pt", "ptbr", "it", "ko", "ja", "id"];

  const LANGUAGE_CHOICES = [
    { code: "fr", label: "Français" },
    { code: "en", label: "English" },
    { code: "de", label: "Deutsch" },
    { code: "es", label: "Español" },
    { code: "eslatam", label: "Español LATAM" },
    { code: "pt", label: "Português" },
    { code: "ptbr", label: "Português BR" },
    { code: "it", label: "Italiano" },
    { code: "ko", label: "한국어" },
    { code: "ja", label: "日本語" },
    { code: "id", label: "Bahasa Indonesia" }
  ];

  const LANGUAGE_FLAGS = {
    fr: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="10" height="20" fill="#1f4fbf"></rect>
        <rect x="10" y="0" width="10" height="20" fill="#ffffff"></rect>
        <rect x="20" y="0" width="10" height="20" fill="#d11f2e"></rect>
      </svg>
    `,
    en: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect width="30" height="20" fill="#ffffff"></rect>
        <g fill="#b22234">
          <rect y="0" width="30" height="1.538"></rect>
          <rect y="3.076" width="30" height="1.538"></rect>
          <rect y="6.152" width="30" height="1.538"></rect>
          <rect y="9.228" width="30" height="1.538"></rect>
          <rect y="12.304" width="30" height="1.538"></rect>
          <rect y="15.38" width="30" height="1.538"></rect>
          <rect y="18.456" width="30" height="1.544"></rect>
        </g>
        <rect width="12.6" height="10.77" fill="#3c3b6e"></rect>
        <g fill="#ffffff" opacity="0.95">
          <circle cx="1.8" cy="1.6" r=".35"></circle>
          <circle cx="3.6" cy="1.6" r=".35"></circle>
          <circle cx="5.4" cy="1.6" r=".35"></circle>
          <circle cx="7.2" cy="1.6" r=".35"></circle>
          <circle cx="9.0" cy="1.6" r=".35"></circle>
          <circle cx="10.8" cy="1.6" r=".35"></circle>

          <circle cx="2.7" cy="2.8" r=".35"></circle>
          <circle cx="4.5" cy="2.8" r=".35"></circle>
          <circle cx="6.3" cy="2.8" r=".35"></circle>
          <circle cx="8.1" cy="2.8" r=".35"></circle>
          <circle cx="9.9" cy="2.8" r=".35"></circle>

          <circle cx="1.8" cy="4.0" r=".35"></circle>
          <circle cx="3.6" cy="4.0" r=".35"></circle>
          <circle cx="5.4" cy="4.0" r=".35"></circle>
          <circle cx="7.2" cy="4.0" r=".35"></circle>
          <circle cx="9.0" cy="4.0" r=".35"></circle>
          <circle cx="10.8" cy="4.0" r=".35"></circle>

          <circle cx="2.7" cy="5.2" r=".35"></circle>
          <circle cx="4.5" cy="5.2" r=".35"></circle>
          <circle cx="6.3" cy="5.2" r=".35"></circle>
          <circle cx="8.1" cy="5.2" r=".35"></circle>
          <circle cx="9.9" cy="5.2" r=".35"></circle>

          <circle cx="1.8" cy="6.4" r=".35"></circle>
          <circle cx="3.6" cy="6.4" r=".35"></circle>
          <circle cx="5.4" cy="6.4" r=".35"></circle>
          <circle cx="7.2" cy="6.4" r=".35"></circle>
          <circle cx="9.0" cy="6.4" r=".35"></circle>
          <circle cx="10.8" cy="6.4" r=".35"></circle>

          <circle cx="2.7" cy="7.6" r=".35"></circle>
          <circle cx="4.5" cy="7.6" r=".35"></circle>
          <circle cx="6.3" cy="7.6" r=".35"></circle>
          <circle cx="8.1" cy="7.6" r=".35"></circle>
          <circle cx="9.9" cy="7.6" r=".35"></circle>

          <circle cx="1.8" cy="8.8" r=".35"></circle>
          <circle cx="3.6" cy="8.8" r=".35"></circle>
          <circle cx="5.4" cy="8.8" r=".35"></circle>
          <circle cx="7.2" cy="8.8" r=".35"></circle>
          <circle cx="9.0" cy="8.8" r=".35"></circle>
          <circle cx="10.8" cy="8.8" r=".35"></circle>
        </g>
      </svg>
    `,
    de: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="6.666" fill="#111111"></rect>
        <rect x="0" y="6.666" width="30" height="6.666" fill="#d11f2e"></rect>
        <rect x="0" y="13.332" width="30" height="6.668" fill="#f1c232"></rect>
      </svg>
    `,
    es: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="20" fill="#f1c232"></rect>
        <rect x="0" y="0" width="30" height="4.5" fill="#c81e1e"></rect>
        <rect x="0" y="15.5" width="30" height="4.5" fill="#c81e1e"></rect>
      </svg>
    `,
    eslatam: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="30" height="20" fill="#ffffff"/>
  <g transform="translate(7.2 1.65) scale(0.06)">
    <path
      d="M 143.9 157.2 L 130.3 148.1 L 115.0 123.2 L 119.3 113.0 L 115.9 108.3 L 127.1 94.0 L 124.0 80.9 L 120.0 79.1 L 116.1 84.1 L 102.1 76.2 L 96.7 66.3 L 49.9 51.7 L 21.6 14.0 L 16.4 13.3 L 31.3 38.4 L 16.1 24.1 L 18.7 21.6 L 10.0 10.0 L 41.1 12.3 L 48.6 19.6 L 57.3 19.2 L 63.0 28.0 L 68.5 29.5 L 66.9 41.1 L 76.4 52.1 L 87.1 48.8 L 88.6 43.8 L 98.0 42.2 L 92.5 58.7 L 108.7 60.5 L 107.5 72.7 L 112.2 78.9 L 119.9 77.1 L 127.9 79.9 L 133.6 72.8 L 142.8 68.8 L 143.0 78.7 L 148.1 69.6 L 153.2 74.3 L 171.7 74.1 L 178.3 79.4 L 180.4 72.7 L 180.9 80.7 L 185.4 83.7 L 186.3 82.2 L 184.3 77.9 L 187.0 76.2 L 185.4 74.0 L 192.3 76.7 L 191.8 79.7 L 197.6 79.0 L 203.1 82.7 L 205.8 88.8 L 214.3 92.4 L 225.7 95.2 L 231.7 100.0 L 235.2 107.8 L 243.8 116.3 L 250.0 124.7 L 249.9 141.1 L 241.5 149.4 L 237.5 164.9 L 234.6 179.4 L 223.3 184.8 L 209.0 189.3 L 204.1 198.5 L 191.8 213.9 L 185.6 222.2 L 171.9 227.2 L 169.1 231.5 L 160.4 235.5 L 160.0 240.5 L 155.7 245.3 L 158.9 249.3 L 150.8 255.7 L 153.0 257.0 L 152.3 261.5 L 142.8 268.3 L 125.3 261.8 L 123.2 250.7 L 129.0 240.4 L 126.6 239.1 L 131.2 228.6 L 132.8 224.2 L 137.6 202.8 L 142.5 185.5 L 142.2 168.0 L 135.6 161.0 Z"
      fill="none"
      stroke="#174e6a"
      stroke-width="12"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </g>
</svg>`,
    pt: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="12" height="20" fill="#1f7a34"></rect>
        <rect x="12" y="0" width="18" height="20" fill="#c81e1e"></rect>
        <circle cx="12.5" cy="10" r="3.2" fill="#f1c232"></circle>
      </svg>
    `,
    ptbr: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="20" fill="#1f7a34"></rect>
        <polygon points="15,2 26,10 15,18 4,10" fill="#f1c232"></polygon>
        <circle cx="15" cy="10" r="4.1" fill="#1f4fbf"></circle>
      </svg>
    `,
    it: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="10" height="20" fill="#1f7a34"></rect>
        <rect x="10" y="0" width="10" height="20" fill="#ffffff"></rect>
        <rect x="20" y="0" width="10" height="20" fill="#d11f2e"></rect>
      </svg>
    `,
    ko: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="20" fill="#ffffff"></rect>
        <path d="M15 6.2a3.8 3.8 0 0 1 0 7.6a3.8 3.8 0 0 1 0-7.6z" fill="#cd2e3a"></path>
        <path d="M15 13.8a3.8 3.8 0 0 1 0-7.6a3.8 3.8 0 0 0 0 7.6z" fill="#0047a0"></path>

        <g fill="#111111">
          <rect x="4" y="3" width="4.3" height="0.8" transform="rotate(-28 4 3)"></rect>
          <rect x="4.6" y="4.3" width="4.3" height="0.8" transform="rotate(-28 4.6 4.3)"></rect>
          <rect x="5.2" y="5.6" width="4.3" height="0.8" transform="rotate(-28 5.2 5.6)"></rect>

          <rect x="21.8" y="14.3" width="4.3" height="0.8" transform="rotate(-28 21.8 14.3)"></rect>
          <rect x="22.4" y="15.6" width="4.3" height="0.8" transform="rotate(-28 22.4 15.6)"></rect>
          <rect x="23" y="16.9" width="4.3" height="0.8" transform="rotate(-28 23 16.9)"></rect>

          <rect x="22.2" y="3.2" width="4.3" height="0.8" transform="rotate(28 22.2 3.2)"></rect>
          <rect x="22.8" y="4.5" width="4.3" height="0.8" transform="rotate(28 22.8 4.5)"></rect>

          <rect x="3.8" y="14.1" width="4.3" height="0.8" transform="rotate(28 3.8 14.1)"></rect>
          <rect x="4.4" y="15.4" width="4.3" height="0.8" transform="rotate(28 4.4 15.4)"></rect>
        </g>
      </svg>
    `,
    ja: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="20" fill="#ffffff"></rect>
        <circle cx="15" cy="10" r="5.2" fill="#c81e1e"></circle>
      </svg>
    `,
    id: `
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <rect x="0" y="0" width="30" height="10" fill="#c81e1e"></rect>
        <rect x="0" y="10" width="30" height="10" fill="#ffffff"></rect>
      </svg>
    `
  };

  let _dict = {};
  let _lang = "en";
  let _langPickerPromise = null;

  function _normalizeLang(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s) return "";

    s = s.replace(/_/g, "-");

    const map = {
      "es-us": "eslatam",
      "es-419": "eslatam",
      "eslatam": "eslatam",
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

    if (base === "es" && (exact.includes("419") || exact.includes("latam") || exact.includes("us"))) return "eslatam";
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
    if (detected) return detected;
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
    if (document.getElementById("vr-language-picker-style")) return;

    const style = document.createElement("style");
    style.id = "vr-language-picker-style";
    style.textContent = `
      .vrLangOverlay{
        position:fixed;
        inset:0;
        z-index:999999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(7,10,18,.82);
        backdrop-filter:blur(10px);
        -webkit-backdrop-filter:blur(10px);
      }

      .vrLangModal{
        width:min(92vw, 560px);
        max-height:86vh;
        overflow:auto;
        background:linear-gradient(180deg, rgba(18,25,43,.98), rgba(11,16,28,.98));
        border:1px solid rgba(255,255,255,.12);
        border-radius:24px;
        box-shadow:0 20px 60px rgba(0,0,0,.45);
        padding:18px 16px 16px;
        color:#ffffff;
      }

      .vrLangTitle{
        text-align:center;
        font-weight:900;
        font-size:clamp(22px, 4.8vw, 32px);
        line-height:1.1;
        margin:0 0 18px;
      }

      .vrLangOverlay .vr-langGrid{
        display:grid;
        grid-template-columns:repeat(3, minmax(0, 1fr));
        gap:12px;
        margin-top:6px;
        margin-bottom:6px;
      }

      @media (min-width: 560px){
        .vrLangOverlay .vr-langGrid{
          grid-template-columns:repeat(4, minmax(0, 1fr));
        }
      }

      .vrLangOverlay .vr-langBtn{
        width:100%;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:10px;
        padding:14px 10px 12px;
        border-radius:16px;
        border:0 !important;
        background:rgba(255,255,255,.04) !important;
        box-shadow:none !important;
        color:inherit;
        cursor:pointer;
        -webkit-tap-highlight-color:transparent;
        text-align:center;
        appearance:none;
        transition:transform .12s ease, box-shadow .12s ease, background .12s ease;
      }

      .vrLangOverlay .vr-langBtn:active{
        transform:scale(.98);
      }

      .vrLangOverlay .vr-langBtn.isActive{
        background:rgba(255,255,255,.08) !important;
        box-shadow:
          0 0 0 2px rgba(255,255,255,.22),
          0 14px 34px rgba(0,0,0,.26) !important;
      }

      .vrLangOverlay .vr-flagBox{
        width:56px;
        height:38px;
        border-radius:10px;
        overflow:hidden;
        border:0 !important;
        outline:0 !important;
        box-shadow:none !important;
        background:transparent !important;
        flex:0 0 auto;
      }

      .vrLangOverlay .vr-flagBox svg{
        width:100%;
        height:100%;
        display:block;
      }

      .vrLangOverlay .vr-langText{
        display:flex !important;
        align-items:center;
        justify-content:center;
        min-height:30px;
        font-size:clamp(12px, 2.9vw, 14px);
        font-weight:800;
        line-height:1.15;
        color:rgba(255,255,255,.96);
        text-align:center;
        word-break:break-word;
      }

      .vrLangOverlay .vr-langText > div{
        max-width:100%;
      }

      .vrLangActions{
        display:flex;
        justify-content:center;
        margin-top:18px;
      }

      .vrLangConfirm{
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

      .vrLangConfirm:active{
        transform:scale(.98);
      }

      .vrLangConfirm[disabled]{
        opacity:.45;
        cursor:default;
        transform:none;
        box-shadow:none;
      }

      .vrLangConfirm svg{
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
        overlay.className = "vrLangOverlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Choose your language");

        const modal = document.createElement("div");
        modal.className = "vrLangModal";

        const title = document.createElement("div");
        title.className = "vrLangTitle";
        title.textContent = "Choose your language";
        modal.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "vr-langGrid";

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
          btn.className = "vr-langBtn" + (selected === item.code ? " isActive" : "");
          btn.setAttribute("data-lang", item.code);
          btn.setAttribute("aria-label", item.label);

          const flag = document.createElement("div");
          flag.className = "vr-flagBox";
          flag.innerHTML = LANGUAGE_FLAGS[item.code] || LANGUAGE_FLAGS.en;

          const txt = document.createElement("div");
          txt.className = "vr-langText";

          const name = document.createElement("div");
          name.textContent = item.label;

          txt.appendChild(name);
          btn.appendChild(flag);
          btn.appendChild(txt);

          btn.addEventListener("click", () => {
            selected = item.code;
            refreshActiveState();
          });

          buttons.push(btn);
          grid.appendChild(btn);
        });

        modal.appendChild(grid);

        const actions = document.createElement("div");
        actions.className = "vrLangActions";

        confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "vrLangConfirm";
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