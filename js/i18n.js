// js/i18n.js — i18n loader + helper t() + auto-apply [data-i18n]
(function () {
  "use strict";

  const UI_PATH = "data/ui";
  let _dict = {};

  function t(path, fallback) {
    const parts = (path || "").split(".");
    let cur = _dict;
    for (const p of parts) {
      if (!cur || typeof cur !== "object" || !(p in cur)) return fallback || "";
      cur = cur[p];
    }
    return typeof cur === "string" ? cur : (fallback || "");
  }

  function applyDataI18n(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const val = t(key, "");
      if (val) el.textContent = val;
    });
  }

  async function load(lang) {
    const safe = (lang === "en") ? "en" : "fr";
    const url = `${UI_PATH}/ui_${safe}.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`i18n not found: ${url}`);
    _dict = await res.json();

    // html lang + title (si clés présentes)
    document.documentElement.lang = safe;
    const pageTitle = t("ui.page_title", "");
    if (pageTitle) document.title = pageTitle;

    // UI "fixes" si tu veux (optionnel)
    const setText = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = t(key, "");
      if (v) el.textContent = v;
    };
    setText("ui_app_title", "ui.app_title");
    setText("ui_app_subtitle", "ui.app_subtitle");
    setText("ui_index_title", "ui.index_title");
    setText("ui_index_subtitle", "ui.index_subtitle");

    const lbl = t("ui.language_label", "");
    const lblEl = document.getElementById("ui_language_label");
    const sel = document.getElementById("langSelect");
    if (lblEl && lbl) lblEl.textContent = lbl;
    if (sel && lbl) sel.setAttribute("aria-label", lbl);

    const frTxt = t("ui.language_fr", "");
    const enTxt = t("ui.language_en", "");
    const frEl = document.getElementById("ui_language_fr");
    const enEl = document.getElementById("ui_language_en");
    if (frEl && frTxt) frEl.textContent = frTxt;
    if (enEl && enTxt) enEl.textContent = enTxt;

    // applique tous les data-i18n
    applyDataI18n(document);
  }

  // expose global
  window.VCI18N = {
    load,
    t,
    apply: applyDataI18n,
    getLang: () => (localStorage.getItem("vchoice_lang") || "fr"),
    setLang: (lang) => localStorage.setItem("vchoice_lang", (lang === "en" ? "en" : "fr"))
  };
})();
