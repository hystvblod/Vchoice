// js/adminPopups.js
// Popup admin VChronicles affichée sur index.html.
// Lit public.vchronicles_admin_popups pour l'utilisateur connecté.
// Ne touche pas VBlocks, VMonster, VUniverse.

(function () {
  "use strict";

  const TABLE = "vchronicles_admin_popups";
  let checking = false;
  let alreadyStarted = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeLang(raw) {
    const s = String(raw || "").trim().toLowerCase().replace("_", "-");

    if (!s) return "fr";
    if (s.startsWith("fr")) return "fr";
    if (s.startsWith("en")) return "en";
    if (s === "es-419" || s === "es-latam" || s === "es-mx" || s === "es-us") return "es-419";
    if (s.startsWith("es")) return "es";
    if (s.startsWith("de")) return "de";
    if (s.startsWith("it")) return "it";
    if (s === "ptbr" || s === "pt-br") return "ptbr";
    if (s.startsWith("pt")) return "pt";
    if (s.startsWith("nl")) return "nl";
    if (s.startsWith("ar")) return "ar";
    if (s.startsWith("id")) return "id";
    if (s.startsWith("ja") || s.startsWith("jp")) return "jp";
    if (s.startsWith("ko")) return "ko";

    return s;
  }

  function getCurrentLang() {
    let lang = "";

    try {
      if (window.VUserData && typeof window.VUserData.load === "function") {
        const profile = window.VUserData.load();
        if (profile && profile.lang) lang = profile.lang;
      }
    } catch (_) {}

    if (!lang) {
      try { lang = localStorage.getItem("vchoice_lang") || ""; } catch (_) {}
    }

    if (!lang) {
      try { lang = document.documentElement.lang || ""; } catch (_) {}
    }

    if (!lang) {
      try { lang = navigator.language || ""; } catch (_) {}
    }

    return normalizeLang(lang || "fr");
  }

  function pickText(value, lang, fallback) {
    const l = normalizeLang(lang);

    if (!value) return fallback || "";

    if (typeof value === "string") return value;

    if (typeof value === "object") {
      return (
        value[l] ||
        value[String(l).toLowerCase()] ||
        value[String(l).toUpperCase()] ||
        value.en ||
        value.fr ||
        value.es ||
        value["es-419"] ||
        value.ptbr ||
        value.pt ||
        Object.values(value)[0] ||
        fallback ||
        ""
      );
    }

    return fallback || "";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function getUserId() {
    try {
      if (window.VUserData && typeof window.VUserData.load === "function") {
        const profile = window.VUserData.load();
        if (profile && profile.user_id) return String(profile.user_id);
      }
    } catch (_) {}

    try {
      if (window.VCRemoteStore && typeof window.VCRemoteStore.ensureAuth === "function") {
        const uid = await window.VCRemoteStore.ensureAuth();
        if (uid) return String(uid);
      }
    } catch (_) {}

    try {
      if (window.sb && window.sb.auth) {
        const res = await window.sb.auth.getUser();
        if (res && res.data && res.data.user && res.data.user.id) {
          return String(res.data.user.id);
        }
      }
    } catch (_) {}

    return "";
  }

  async function waitForAppReady() {
    for (let i = 0; i < 40; i++) {
      try {
        if (window.sb && window.sb.auth && window.VUserData) return true;
      } catch (_) {}
      await sleep(250);
    }
    return false;
  }

  async function markShown(popupId) {
    if (!popupId || !window.sb) return;

    try {
      await window.sb
        .from(TABLE)
        .update({ shown_at: new Date().toISOString() })
        .eq("id", popupId);
    } catch (e) {
      console.warn("[VChroniclesAdminPopups] markShown failed", e);
    }
  }

  async function markRead(popupId) {
    if (!popupId || !window.sb) return;

    try {
      await window.sb
        .from(TABLE)
        .update({
          read_at: new Date().toISOString(),
          is_active: false
        })
        .eq("id", popupId);
    } catch (e) {
      console.warn("[VChroniclesAdminPopups] markRead failed", e);
    }
  }

  function ensureStyle() {
    if (document.getElementById("vc-admin-popup-style")) return;

    const style = document.createElement("style");
    style.id = "vc-admin-popup-style";
    style.textContent = `
      #vc-admin-popup-overlay{
        position:fixed;
        inset:0;
        z-index:999999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:22px;
        background:rgba(5,10,25,.72);
        backdrop-filter:blur(8px);
      }
      #vc-admin-popup-card{
        width:min(440px,100%);
        border-radius:24px;
        padding:22px;
        background:linear-gradient(180deg,#ffffff,#f5f3ff);
        color:#111827;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        border:1px solid rgba(255,255,255,.7);
        text-align:center;
        font-family:Arial,Helvetica,sans-serif;
      }
      #vc-admin-popup-card h2{
        margin:0 0 12px;
        font-size:22px;
        line-height:1.2;
        color:#21103f;
      }
      #vc-admin-popup-card p{
        margin:0 0 20px;
        white-space:pre-wrap;
        font-size:16px;
        line-height:1.45;
        color:#374151;
      }
      #vc-admin-popup-card button{
        width:100%;
        border:0;
        border-radius:16px;
        padding:13px 16px;
        background:#7c3aed;
        color:white;
        font-weight:800;
        font-size:16px;
        cursor:pointer;
        box-shadow:0 12px 24px rgba(124,58,237,.25);
      }
      #vc-admin-popup-card button:active{
        transform:translateY(1px);
      }
    `;

    document.head.appendChild(style);
  }

  function showPopup(popup) {
    const old = document.getElementById("vc-admin-popup-overlay");
    if (old) old.remove();

    const payload = popup.payload || {};
    const lang = getCurrentLang();

    const title = pickText(payload.title, lang, "Information");
    const body = pickText(payload.body || payload.message || payload.text, lang, "");
    const cta = pickText(payload.cta, lang, "OK");

    if (!body) return;

    ensureStyle();

    const overlay = document.createElement("div");
    overlay.id = "vc-admin-popup-overlay";

    overlay.innerHTML = `
      <div id="vc-admin-popup-card" role="dialog" aria-modal="true">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        <button id="vc-admin-popup-ok" type="button">${escapeHtml(cta)}</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const btn = document.getElementById("vc-admin-popup-ok");
    if (btn) {
      btn.addEventListener("click", async function () {
        overlay.remove();
        await markRead(popup.id);
      });
    }
  }

  async function check() {
    if (checking) return;

    checking = true;

    try {
      const ready = await waitForAppReady();
      if (!ready) return;

      try {
        if (window.bootstrapAuthAndProfile) {
          await window.bootstrapAuthAndProfile();
        }
      } catch (_) {}

      try {
        if (window.VUserData && typeof window.VUserData.init === "function") {
          await window.VUserData.init();
        }
      } catch (_) {}

      const userId = await getUserId();
      if (!userId || !window.sb) return;

      const res = await window.sb
        .from(TABLE)
        .select("id,user_id,payload,sent_at,shown_at,read_at,is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .is("read_at", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (res.error) {
        console.warn("[VChroniclesAdminPopups] fetch failed", res.error);
        return;
      }

      const popup = res.data;
      if (!popup || !popup.id || !popup.payload) return;

      if (!popup.shown_at) {
        await markShown(popup.id);
      }

      showPopup(popup);
    } catch (e) {
      console.warn("[VChroniclesAdminPopups] check error", e);
    } finally {
      checking = false;
    }
  }

  function start() {
    if (alreadyStarted) return;
    alreadyStarted = true;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        setTimeout(check, 900);
      });
    } else {
      setTimeout(check, 900);
    }

    window.addEventListener("focus", function () {
      setTimeout(check, 600);
    });
  }

  window.VChroniclesAdminPopups = {
    check,
    start
  };

  start();
})();
