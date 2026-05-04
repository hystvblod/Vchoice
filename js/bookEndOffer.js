// js/bookEndOffer.js
// Popup roman Amazon au retour sur index.html après une fin de scénario.
// Utilise les IDs book_01, book_02, etc. de la boutique.
// Affiche seulement si un vrai ASIN existe dans la langue actuelle de l'app.

(function () {
  "use strict";

  const PENDING_SCENARIO_KEY = "vchoice_pending_book_offer_scenario";
  const SHOWN_PREFIX = "vchoice_book_offer_shown_";

  const BOOKS_CONFIG_URL = "https://eygcqhrccukwvmepacrt.supabase.co/storage/v1/object/public/app-config/books/books.json";
  const BOOKS_CONFIG_CACHE_KEY = "vchoice_books_config_cache_v1";

  const SCENARIO_TO_BOOK_ID = {
    dossier14_appartement: "book_01",
    bunker_reserve: "book_02",
    chateau_absents: "book_03",
    foret_relais: "book_04",
    grotte_angelique: "book_05",
    hopital_ferme: "book_06",
    marais_sans_sepulture: "book_07",
    metro_station_zero: "book_08",
    styx_gare: "book_09",
    temple_mictlan: "book_10",
    village_brume_noire: "book_11"
  };

  const FALLBACK_BOOKS = [
    {
      id: "book_01",
      titleKey: "ui.book_01_title",
      asins: {
        fr: "ASIN_BOOK_01_FR",
        en: "ASIN_BOOK_01_EN",
        de: "ASIN_BOOK_01_DE",
        es: "ASIN_BOOK_01_ES",
        it: "ASIN_BOOK_01_IT",
        ptbr: "ASIN_BOOK_01_PTBR"
      }
    },
    {
      id: "book_02",
      titleKey: "ui.book_02_title",
      asins: {
        fr: "ASIN_BOOK_02_FR",
        en: "ASIN_BOOK_02_EN",
        de: "ASIN_BOOK_02_DE",
        es: "ASIN_BOOK_02_ES",
        it: "ASIN_BOOK_02_IT",
        ptbr: "ASIN_BOOK_02_PTBR"
      }
    },
    {
      id: "book_03",
      titleKey: "ui.book_03_title",
      asins: {
        fr: "ASIN_BOOK_03_FR",
        en: "ASIN_BOOK_03_EN",
        de: "ASIN_BOOK_03_DE",
        es: "ASIN_BOOK_03_ES",
        it: "ASIN_BOOK_03_IT",
        ptbr: "ASIN_BOOK_03_PTBR"
      }
    },
    {
      id: "book_04",
      titleKey: "ui.book_04_title",
      asins: {
        fr: "ASIN_BOOK_04_FR",
        en: "ASIN_BOOK_04_EN",
        de: "ASIN_BOOK_04_DE",
        es: "ASIN_BOOK_04_ES",
        it: "ASIN_BOOK_04_IT",
        ptbr: "ASIN_BOOK_04_PTBR"
      }
    },
    {
      id: "book_05",
      titleKey: "ui.book_05_title",
      asins: {
        fr: "ASIN_BOOK_05_FR",
        en: "ASIN_BOOK_05_EN",
        de: "ASIN_BOOK_05_DE",
        es: "ASIN_BOOK_05_ES",
        it: "ASIN_BOOK_05_IT",
        ptbr: "ASIN_BOOK_05_PTBR"
      }
    },
    {
      id: "book_06",
      titleKey: "ui.book_06_title",
      asins: {
        fr: "ASIN_BOOK_06_FR",
        en: "ASIN_BOOK_06_EN",
        de: "ASIN_BOOK_06_DE",
        es: "ASIN_BOOK_06_ES",
        it: "ASIN_BOOK_06_IT",
        ptbr: "ASIN_BOOK_06_PTBR"
      }
    },
    {
      id: "book_07",
      titleKey: "ui.book_07_title",
      asins: {
        fr: "ASIN_BOOK_07_FR",
        en: "ASIN_BOOK_07_EN",
        de: "ASIN_BOOK_07_DE",
        es: "ASIN_BOOK_07_ES",
        it: "ASIN_BOOK_07_IT",
        ptbr: "ASIN_BOOK_07_PTBR"
      }
    },
    {
      id: "book_08",
      titleKey: "ui.book_08_title",
      asins: {
        fr: "ASIN_BOOK_08_FR",
        en: "ASIN_BOOK_08_EN",
        de: "ASIN_BOOK_08_DE",
        es: "ASIN_BOOK_08_ES",
        it: "ASIN_BOOK_08_IT",
        ptbr: "ASIN_BOOK_08_PTBR"
      }
    },
    {
      id: "book_09",
      titleKey: "ui.book_09_title",
      asins: {
        fr: "ASIN_BOOK_09_FR",
        en: "ASIN_BOOK_09_EN",
        de: "ASIN_BOOK_09_DE",
        es: "ASIN_BOOK_09_ES",
        it: "ASIN_BOOK_09_IT",
        ptbr: "ASIN_BOOK_09_PTBR"
      }
    },
    {
      id: "book_10",
      titleKey: "ui.book_10_title",
      asins: {
        fr: "ASIN_BOOK_10_FR",
        en: "ASIN_BOOK_10_EN",
        de: "ASIN_BOOK_10_DE",
        es: "ASIN_BOOK_10_ES",
        it: "ASIN_BOOK_10_IT",
        ptbr: "ASIN_BOOK_10_PTBR"
      }
    },
    {
      id: "book_11",
      titleKey: "ui.book_11_title",
      asins: {
        fr: "ASIN_BOOK_11_FR",
        en: "ASIN_BOOK_11_EN",
        de: "ASIN_BOOK_11_DE",
        es: "ASIN_BOOK_11_ES",
        it: "ASIN_BOOK_11_IT",
        ptbr: "ASIN_BOOK_11_PTBR"
      }
    },
    {
      id: "book_12",
      titleKey: "ui.book_12_title",
      asins: {
        fr: "B0GYG3CQHZ",
        en: "B0GYS49PNJ",
        de: "B0GYQPX3BP",
        es: "ASIN_BOOK_12_ES",
        it: "ASIN_BOOK_12_IT",
        ptbr: "ASIN_BOOK_12_PTBR"
      }
    }
  ];

  function t(key, fallback, vars) {
    let out = "";

    try {
      if (window.VRI18n && typeof window.VRI18n.t === "function") {
        out = window.VRI18n.t(key, fallback || "", vars || undefined);
      }
    } catch (_) {}

    out = typeof out === "string" && out ? out : fallback || "";

    if (vars && out) {
      Object.keys(vars).forEach((k) => {
        out = out.split("{" + k + "}").join(String(vars[k]));
      });
    }

    return out;
  }

  function getCurrentAppLang() {
    try {
      const direct = window.VRI18n?.getLang?.();
      if (direct) return String(direct).trim().toLowerCase();
    } catch (_) {}

    try {
      const stored =
        localStorage.getItem("vchoice_lang") ||
        localStorage.getItem("vr_lang") ||
        localStorage.getItem("app_lang") ||
        localStorage.getItem("lang");

      if (stored) return String(stored).trim().toLowerCase();
    } catch (_) {}

    try {
      const nav = String(navigator.language || "").trim().toLowerCase();

      if (nav.startsWith("fr")) return "fr";
      if (nav.startsWith("en")) return "en";
      if (nav.startsWith("de")) return "de";
      if (nav.startsWith("es")) return "es";
      if (nav.startsWith("it")) return "it";
      if (nav.startsWith("pt")) return "ptbr";
      if (nav.startsWith("ja")) return "ja";
      if (nav.startsWith("ko")) return "ko";
      if (nav.startsWith("id")) return "id";
    } catch (_) {}

    return "";
  }

  function getBookLangForCurrentUser() {
    const appLang = getCurrentAppLang();

    if (appLang === "fr" || appLang === "fr-fr") return "fr";
    if (appLang === "en" || appLang === "en-us" || appLang === "en-gb") return "en";
    if (appLang === "de" || appLang === "de-de") return "de";
    if (appLang === "it" || appLang === "it-it") return "it";

    if (appLang === "es" || appLang === "es-es" || appLang === "eslatam" || appLang === "es-419") return "es";
    if (appLang === "pt" || appLang === "ptbr" || appLang === "pt-br") return "ptbr";

    return "";
  }

  function getAmazonDomainForBookLang(bookLang) {
    if (bookLang === "fr") return "amazon.fr";
    if (bookLang === "en") return "amazon.com";
    if (bookLang === "de") return "amazon.de";
    if (bookLang === "es") return "amazon.es";
    if (bookLang === "it") return "amazon.it";
    if (bookLang === "ptbr") return "amazon.com.br";

    return "";
  }

  function isPlaceholderAsin(asin) {
    const safe = String(asin || "").trim();
    return !safe || safe.includes("ASIN_BOOK_");
  }

  function normalizeRemoteBooksConfig(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || "").trim(),
        titleKey: String(item.titleKey || "").trim(),
        asins: {
          fr: String(item.asins?.fr || "").trim(),
          en: String(item.asins?.en || "").trim(),
          de: String(item.asins?.de || "").trim(),
          es: String(item.asins?.es || "").trim(),
          it: String(item.asins?.it || "").trim(),
          ptbr: String(item.asins?.ptbr || "").trim()
        }
      }))
      .filter((item) => item.id && item.titleKey);
  }

  function loadCachedBooksConfig() {
    try {
      const raw = localStorage.getItem(BOOKS_CONFIG_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const normalized = normalizeRemoteBooksConfig(parsed);

      return normalized.length ? normalized : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchRemoteBooksConfig() {
    const url = String(BOOKS_CONFIG_URL || "").trim();
    if (!url || url.includes("COLLE_ICI")) return null;

    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}v=${Date.now()}`, {
        method: "GET",
        cache: "no-store"
      });

      if (!res.ok) return null;

      const json = await res.json();
      const normalized = normalizeRemoteBooksConfig(json);

      return normalized.length ? normalized : null;
    } catch (_) {
      return null;
    }
  }

  async function loadBooks() {
    const remote = await fetchRemoteBooksConfig();

    if (remote && remote.length) {
      try {
        localStorage.setItem(BOOKS_CONFIG_CACHE_KEY, JSON.stringify(remote));
      } catch (_) {}
      return remote;
    }

    const cached = loadCachedBooksConfig();
    if (cached && cached.length) return cached;

    return FALLBACK_BOOKS;
  }

  function getBookById(books, bookId) {
    return books.find((book) => String(book.id || "") === String(bookId)) || null;
  }

  function buildAmazonUrl(book) {
    const bookLang = getBookLangForCurrentUser();

    if (!bookLang) return "";

    const asin = String(book?.asins?.[bookLang] || "").trim();

    if (isPlaceholderAsin(asin)) return "";

    const domain = getAmazonDomainForBookLang(bookLang);

    if (!domain) return "";

    return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
  }

  function openUrl(url) {
    const safeUrl = String(url || "").trim();
    if (!safeUrl) return;

    try {
      const Browser = window.Capacitor?.Plugins?.Browser;
      if (Browser && typeof Browser.open === "function") {
        Browser.open({ url: safeUrl });
        return;
      }
    } catch (_) {}

    try {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
    } catch (_) {
      try {
        window.location.href = safeUrl;
      } catch (_) {}
    }
  }

  function ensureStyles() {
    if (document.getElementById("vchoice-book-end-offer-style")) return;

    const style = document.createElement("style");
    style.id = "vchoice-book-end-offer-style";
    style.textContent = `
      .vchoice-book-end-offer{
        position:fixed;
        inset:0;
        z-index:9999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:22px;
        background:rgba(5,8,18,.58);
        backdrop-filter:blur(10px);
      }

      .vchoice-book-end-offer__card{
        width:min(430px,100%);
        border:1px solid rgba(255,255,255,.16);
        border-radius:26px;
        padding:22px;
        background:linear-gradient(180deg,rgba(36,31,55,.98),rgba(16,18,34,.98));
        color:#fff;
        box-shadow:0 26px 80px rgba(0,0,0,.42);
        text-align:center;
      }

      .vchoice-book-end-offer__kicker{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:30px;
        padding:6px 12px;
        border-radius:999px;
        background:rgba(255,214,129,.14);
        color:#ffd681;
        font-weight:900;
        font-size:.78rem;
        letter-spacing:.04em;
        text-transform:uppercase;
      }

      .vchoice-book-end-offer__title{
        margin:16px 0 8px;
        font-size:1.35rem;
        line-height:1.15;
        font-weight:950;
      }

      .vchoice-book-end-offer__body{
        margin:0;
        color:rgba(255,255,255,.82);
        font-size:.96rem;
        line-height:1.48;
      }

      .vchoice-book-end-offer__book{
        margin:14px auto 0;
        padding:12px 14px;
        border-radius:18px;
        background:rgba(255,255,255,.08);
        color:#fff;
        font-weight:900;
      }

      .vchoice-book-end-offer__actions{
        display:grid;
        grid-template-columns:1fr;
        gap:10px;
        margin-top:18px;
      }

      .vchoice-book-end-offer__btn{
        border:0;
        border-radius:18px;
        min-height:48px;
        padding:12px 16px;
        font-weight:950;
        cursor:pointer;
        color:#161019;
        background:linear-gradient(180deg,#ffd681,#ffad45);
        box-shadow:0 12px 32px rgba(255,173,69,.24);
      }

      .vchoice-book-end-offer__btn--secondary{
        color:#fff;
        background:rgba(255,255,255,.09);
        box-shadow:none;
      }
    `;
    document.head.appendChild(style);
  }

  function markShownAndClear(scenarioId) {
    try {
      localStorage.setItem(SHOWN_PREFIX + scenarioId, "1");
      localStorage.removeItem(PENDING_SCENARIO_KEY);
    } catch (_) {}
  }

  function showPopup(scenarioId, book, url) {
    ensureStyles();

    const modal = document.createElement("div");
    modal.className = "vchoice-book-end-offer";

    const card = document.createElement("div");
    card.className = "vchoice-book-end-offer__card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const kicker = document.createElement("div");
    kicker.className = "vchoice-book-end-offer__kicker";
    kicker.textContent = t("ui.book_end_offer_kicker", "Version longue");

    const title = document.createElement("div");
    title.className = "vchoice-book-end-offer__title";
    title.textContent = t("ui.book_end_offer_title", "Découvre le roman complet");

    const body = document.createElement("p");
    body.className = "vchoice-book-end-offer__body";
    body.textContent = t(
      "ui.book_end_offer_body",
      "Tu viens de terminer ce scénario. Sa version longue existe en roman, avec plus de détails, d’ambiance et de scènes."
    );

    const bookName = document.createElement("div");
    bookName.className = "vchoice-book-end-offer__book";
    bookName.textContent = t(book.titleKey, book.id);

    const actions = document.createElement("div");
    actions.className = "vchoice-book-end-offer__actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "vchoice-book-end-offer__btn";
    openBtn.textContent = t("ui.book_buy_amazon", "Acheter sur Amazon");
    openBtn.addEventListener("click", () => {
      markShownAndClear(scenarioId);
      modal.remove();
      openUrl(url);
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "vchoice-book-end-offer__btn vchoice-book-end-offer__btn--secondary";
    closeBtn.textContent = t("ui.book_end_offer_close", "Pas maintenant");
    closeBtn.addEventListener("click", () => {
      markShownAndClear(scenarioId);
      modal.remove();
    });

    actions.appendChild(openBtn);
    actions.appendChild(closeBtn);

    card.appendChild(kicker);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(bookName);
    card.appendChild(actions);

    modal.appendChild(card);
    document.body.appendChild(modal);
  }

  async function maybeShow() {
    let scenarioId = "";

    try {
      scenarioId = String(localStorage.getItem(PENDING_SCENARIO_KEY) || "").trim().toLowerCase();
    } catch (_) {
      scenarioId = "";
    }

    if (!scenarioId) return false;

    try {
      if (localStorage.getItem(SHOWN_PREFIX + scenarioId) === "1") {
        localStorage.removeItem(PENDING_SCENARIO_KEY);
        return false;
      }
    } catch (_) {}

    const bookId = SCENARIO_TO_BOOK_ID[scenarioId];

    if (!bookId) {
      try {
        localStorage.removeItem(PENDING_SCENARIO_KEY);
      } catch (_) {}
      return false;
    }

    const books = await loadBooks();
    const book = getBookById(books, bookId);

    if (!book) return false;

    const url = buildAmazonUrl(book);

    if (!url) {
      return false;
    }

    setTimeout(() => {
      try {
        showPopup(scenarioId, book, url);
      } catch (_) {}
    }, 650);

    return true;
  }

  window.VCBookEndOffer = {
    maybeShow
  };
})();
