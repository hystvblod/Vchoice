(function () {
  "use strict";

  const STORAGE_KEY = "vchoice_crosspromo_state";
  const SESSION_POPUP_KEY = "vchoice_crosspromo_session_shown";
  const CONTEXT_KEY = "vc_crosspromo_context";
  const REWARD_AMOUNT = 600;
  const MAX_DISMISS_PER_GAME = 2;

  const APPS = {
    vblocks: {
      id: "vblocks",
      packageName: "com.vboldstudio.VBlocks",
      iosScheme: "vblocks://",
      storeUrlAndroid: "https://play.google.com/store/apps/details?id=com.vboldstudio.VBlocks",
      storeUrlIOS: "https://apps.apple.com/app/idXXXXXXXXXX",
      cover: "assets/img/crosspromo/vblocks_cover.webp",
      shots: [
        "assets/img/crosspromo/vblocks_01.webp",
        "assets/img/crosspromo/vblocks_02.webp",
        "assets/img/crosspromo/vblocks_03.webp"
      ],
      titleKey: "crosspromo.apps.vblocks.name",
      titleFallback: "VBlocks",
      descKey: "crosspromo.apps.vblocks.store_desc",
      descFallback: "Un jeu rapide, nerveux et satisfaisant. Installe-le et gagne ta récompense.",
      popup1TitleKey: "crosspromo.apps.vblocks.popup1.title",
      popup1TitleFallback: "Envie d’un autre défi",
      popup1BodyKey: "crosspromo.apps.vblocks.popup1.body",
      popup1BodyFallback: "Installe VBlocks et récupère tes VCoins bonus dans VChronicles.",
      popup2TitleKey: "crosspromo.apps.vblocks.popup2.title",
      popup2TitleFallback: "Tu peux tenter autre chose",
      popup2BodyKey: "crosspromo.apps.vblocks.popup2.body",
      popup2BodyFallback: "Change d’ambiance avec VBlocks et débloque ta récompense.",
      popup3TitleKey: "crosspromo.apps.vblocks.popup3.title",
      popup3TitleFallback: "Une récompense t’attend",
      popup3BodyKey: "crosspromo.apps.vblocks.popup3.body",
      popup3BodyFallback: "Installe VBlocks puis reviens dans l’app pour récupérer tes VCoins."
    },

    vuniverse: {
      id: "vuniverse",
      packageName: "com.vboldstudio.vuniverse",
      iosScheme: "vuniverse://",
      storeUrlAndroid: "https://play.google.com/store/apps/details?id=com.vboldstudio.vuniverse",
      storeUrlIOS: "https://apps.apple.com/app/idYYYYYYYYYY",
      cover: "assets/img/crosspromo/vuniverse_cover.webp",
      shots: [
        "assets/img/crosspromo/vuniverse_01.webp",
        "assets/img/crosspromo/vuniverse_02.webp",
        "assets/img/crosspromo/vuniverse_03.webp"
      ],
      titleKey: "crosspromo.apps.vuniverse.name",
      titleFallback: "VUniverse",
      descKey: "crosspromo.apps.vuniverse.store_desc",
      descFallback: "Entre dans un autre univers du studio et récupère ta récompense dans VChronicles.",
      popup1TitleKey: "crosspromo.apps.vuniverse.popup1.title",
      popup1TitleFallback: "Découvre VUniverse",
      popup1BodyKey: "crosspromo.apps.vuniverse.popup1.body",
      popup1BodyFallback: "Installe VUniverse puis reviens ici pour récupérer tes VCoins bonus.",
      popup2TitleKey: "crosspromo.apps.vuniverse.popup2.title",
      popup2TitleFallback: "Une autre aventure t’attend",
      popup2BodyKey: "crosspromo.apps.vuniverse.popup2.body",
      popup2BodyFallback: "Passe sur VUniverse et récupère ta récompense dans VChronicles.",
      popup3TitleKey: "crosspromo.apps.vuniverse.popup3.title",
      popup3TitleFallback: "Bonus disponible",
      popup3BodyKey: "crosspromo.apps.vuniverse.popup3.body",
      popup3BodyFallback: "Installe VUniverse, rouvre VChronicles et tes VCoins seront crédités."
    }
  };

  function t(key, fallback, vars) {
    let out = "";
    try {
      if (window.VRI18n && typeof window.VRI18n.t === "function") {
        out = window.VRI18n.t(key) || "";
      }
    } catch (_) {}

    if (!out) out = fallback || "";

    if (vars && out) {
      Object.keys(vars).forEach((k) => {
        out = out.split("{" + k + "}").join(String(vars[k]));
      });
    }

    return out;
  }

  function isNativeApp() {
    try {
      return !!(
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === "function" &&
        window.Capacitor.isNativePlatform()
      );
    } catch (_) {
      return false;
    }
  }

  function getPlatform() {
    try {
      if (!window.Capacitor || !window.Capacitor.getPlatform) return "web";
      return window.Capacitor.getPlatform();
    } catch (_) {
      return "web";
    }
  }

  function isAndroid() {
    return getPlatform() === "android";
  }

  function isIOS() {
    return getPlatform() === "ios";
  }

  function getTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function defaultGameState() {
    return {
      dismissedCount: 0,
      rewardClaimed: false,
      installedDetected: false,
      clickedStore: false,
      pendingInstallCheck: false,
      lastShownDayKey: "",
      dailyShowCount: 0
    };
  }

  function defaultState() {
    return {
      lowVcoinsNextApp: "vblocks",
      apps: {
        vblocks: defaultGameState(),
        vuniverse: defaultGameState()
      }
    };
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function normalizeGameState(src) {
    const s = src && typeof src === "object" ? src : {};
    return {
      dismissedCount: Math.max(0, Number(s.dismissedCount || 0) || 0),
      rewardClaimed: !!s.rewardClaimed,
      installedDetected: !!s.installedDetected,
      clickedStore: !!s.clickedStore,
      pendingInstallCheck: !!s.pendingInstallCheck,
      lastShownDayKey: String(s.lastShownDayKey || ""),
      dailyShowCount: Math.max(0, Number(s.dailyShowCount || 0) || 0)
    };
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();

      const parsed = safeParse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();

      return {
        lowVcoinsNextApp: parsed.lowVcoinsNextApp === "vuniverse" ? "vuniverse" : "vblocks",
        apps: {
          vblocks: normalizeGameState(parsed.apps?.vblocks),
          vuniverse: normalizeGameState(parsed.apps?.vuniverse)
        }
      };
    } catch (_) {
      return defaultState();
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function hasSessionPopupShown() {
    try {
      return sessionStorage.getItem(SESSION_POPUP_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function markSessionPopupShown() {
    try {
      sessionStorage.setItem(SESSION_POPUP_KEY, "1");
    } catch (_) {}
  }

  function syncDailyWindow(row) {
    const today = getTodayKey();
    if (row.lastShownDayKey !== today) {
      row.lastShownDayKey = today;
      row.dailyShowCount = 0;
    }
  }

  function canStillShowForGame(row) {
    syncDailyWindow(row);

    if (row.rewardClaimed) return false;
    if (row.installedDetected) return false;
    if (row.dismissedCount >= MAX_DISMISS_PER_GAME) return false;
    if (row.dailyShowCount >= 1) return false;

    return true;
  }

  async function canOpenTargetApp(app) {
    if (!isNativeApp()) return false;

    try {
      const AppLauncher = window.Capacitor?.Plugins?.AppLauncher;
      if (!AppLauncher || typeof AppLauncher.canOpenUrl !== "function") return false;

      if (isAndroid()) {
        const res = await AppLauncher.canOpenUrl({ url: app.packageName });
        return !!res?.value;
      }

      if (isIOS()) {
        const res = await AppLauncher.canOpenUrl({ url: app.iosScheme });
        return !!res?.value;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  async function refreshInstalledStatus(appId) {
    const app = APPS[appId];
    if (!app) return false;

    const state = readState();
    const installed = await canOpenTargetApp(app);

    state.apps[appId].installedDetected = installed;
    writeState(state);

    return installed;
  }

  function getStoreUrl(app) {
    if (isIOS()) return app.storeUrlIOS;
    return app.storeUrlAndroid;
  }

  async function openStore(app) {
    const url = String(getStoreUrl(app) || "").trim();
    if (!url) return false;

    try {
      const Browser = window.Capacitor?.Plugins?.Browser;
      if (Browser && typeof Browser.open === "function") {
        await Browser.open({ url: url });
        return true;
      }
    } catch (_) {}

    try {
      window.location.href = url;
      return true;
    } catch (_) {}

    try {
      window.open(url, "_blank");
      return true;
    } catch (_) {
      return false;
    }
  }

async function claimRewardIfEligible(appId) {
  const state = readState();
  const row = state.apps[appId];
  if (!row) return false;
  if (row.rewardClaimed) return false;
  if (!row.pendingInstallCheck) return false;
  if (!row.installedDetected) return false;

  try {
    if (!window.VUserData?.addVCoins) return false;

    await window.VUserData.addVCoins(REWARD_AMOUNT);

    if (window.VUserData?.refresh) {
      await window.VUserData.refresh();
    }

    row.rewardClaimed = true;
    row.pendingInstallCheck = false;
    row.clickedStore = false;
    writeState(state);

    showRewardToast(appId);
    return true;
  } catch (_) {
    return false;
  }
}

  function showRewardToast(appId) {
    const app = APPS[appId];
    const appName = t(app.titleKey, app.titleFallback);
    const msg = t(
      "crosspromo.reward_granted",
      "Récompense reçue : {amount} VCoins pour l’installation de {app}.",
      { app: appName, amount: REWARD_AMOUNT }
    );

    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:24px",
      "transform:translateX(-50%)",
      "z-index:200000",
      "padding:12px 16px",
      "border-radius:16px",
      "background:rgba(12,18,30,.94)",
      "border:1px solid rgba(255,255,255,.14)",
      "color:#fff",
      "font-weight:900",
      "font-size:14px",
      "box-shadow:0 14px 30px rgba(0,0,0,.34)"
    ].join(";");

    el.textContent = msg;
    document.body.appendChild(el);

    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
    }, 2800);
  }

  function setPendingStoreClick(appId) {
    const state = readState();
    const row = state.apps[appId];
    if (!row) return;

    row.clickedStore = true;
    row.pendingInstallCheck = true;
    writeState(state);
  }

  function registerDismiss(appId) {
    const state = readState();
    const row = state.apps[appId];
    if (!row) return;

    row.dismissedCount += 1;
    writeState(state);
  }

  function registerShown(appId) {
    const state = readState();
    const row = state.apps[appId];
    if (!row) return;

    syncDailyWindow(row);
    row.dailyShowCount += 1;
    row.lastShownDayKey = getTodayKey();
    writeState(state);
    markSessionPopupShown();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getValidShots(app) {
    return (Array.isArray(app.shots) ? app.shots : [])
      .filter(Boolean)
      .slice(0, 3);
  }

  function buildShotsHtml(app) {
    const shots = getValidShots(app);
    return shots.map((src) => {
      return '<button class="vc-crosspromo-shot" type="button" data-shot-open="' + escapeHtml(src) + '" aria-label="Ouvrir l’image"><img src="' + escapeHtml(src) + '" alt="" draggable="false" /></button>';
    }).join("");
  }

  function buildPopupRoot() {
    let root = document.getElementById("vc-crosspromo-popup");
    if (root) return root;

    root = document.createElement("div");
    root.id = "vc-crosspromo-popup";
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "padding:18px",
      "z-index:200000",
      "background:rgba(0,0,0,.56)",
      "backdrop-filter:blur(6px)",
      "-webkit-backdrop-filter:blur(6px)"
    ].join(";");

    root.innerHTML = [
      '<div style="position:relative;width:min(520px, calc(100vw - 32px));padding:16px;border-radius:22px;background:rgba(10,16,28,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 40px rgba(0,0,0,.3);">',
      '  <button id="vc-crosspromo-close" type="button" style="position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-size:20px;font-weight:900;" aria-label="close">×</button>',
      '  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">',
      '    <img id="vc-crosspromo-cover" src="" alt="" style="width:72px;height:72px;border-radius:18px;object-fit:cover;border:1px solid rgba(255,255,255,.14);" />',
      '    <div>',
      '      <div id="vc-crosspromo-appname" style="font-size:13px;font-weight:900;opacity:.86;color:#fff;"></div>',
      '      <div id="vc-crosspromo-title" style="margin-top:4px;font-size:20px;line-height:1.1;font-weight:950;color:#fff;"></div>',
      '    </div>',
      '  </div>',
      '  <div id="vc-crosspromo-body" style="font-size:14px;line-height:1.42;color:rgba(255,255,255,.92);margin-bottom:14px;"></div>',
      '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);width:max-content;">',
      '    <span id="vc-crosspromo-reward-prefix" style="font-size:13px;font-weight:900;color:#fff;"></span>',
      '    <img src="assets/img/ui/vcoin.webp" alt="" style="width:28px;height:28px;object-fit:contain;" />',
      '    <span id="vc-crosspromo-reward-value" style="font-size:13px;font-weight:900;color:#fff;"></span>',
      '  </div>',
      '  <div style="display:grid;grid-template-columns:1fr;gap:10px;">',
      '    <button id="vc-crosspromo-primary" type="button" style="min-height:52px;border-radius:16px;border:1px solid rgba(255,59,59,.34);background:rgba(255,59,59,.24);color:#fff;font-weight:900;"></button>',
      '    <button id="vc-crosspromo-secondary" type="button" style="min-height:50px;border-radius:16px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-weight:900;"></button>',
      '  </div>',
      '</div>'
    ].join("");

    document.body.appendChild(root);
    return root;
  }

  function getPopupText(app, popupIndex) {
    if (popupIndex === 1) {
      return {
        title: t(app.popup1TitleKey, app.popup1TitleFallback),
        body: t(app.popup1BodyKey, app.popup1BodyFallback)
      };
    }
    if (popupIndex === 2) {
      return {
        title: t(app.popup2TitleKey, app.popup2TitleFallback),
        body: t(app.popup2BodyKey, app.popup2BodyFallback)
      };
    }
    return {
      title: t(app.popup3TitleKey, app.popup3TitleFallback),
      body: t(app.popup3BodyKey, app.popup3BodyFallback)
    };
  }

  async function openPromoPopup(appId, popupIndex) {
    const app = APPS[appId];
    if (!app) return false;

    const state = readState();
    const row = state.apps[appId];

    if (!canStillShowForGame(row)) return false;
    if (hasSessionPopupShown()) return false;

    const isInstalled = await refreshInstalledStatus(appId);
    if (isInstalled) return false;

    const popupText = getPopupText(app, popupIndex);
    registerShown(appId);

    const root = buildPopupRoot();
    const cover = document.getElementById("vc-crosspromo-cover");
    const appName = document.getElementById("vc-crosspromo-appname");
    const title = document.getElementById("vc-crosspromo-title");
    const body = document.getElementById("vc-crosspromo-body");
    const rewardPrefix = document.getElementById("vc-crosspromo-reward-prefix");
    const rewardValue = document.getElementById("vc-crosspromo-reward-value");
    const primary = document.getElementById("vc-crosspromo-primary");
    const secondary = document.getElementById("vc-crosspromo-secondary");
    const closeBtn = document.getElementById("vc-crosspromo-close");

    cover.src = app.cover;
    appName.textContent = t(app.titleKey, app.titleFallback);
    title.textContent = popupText.title;
    body.textContent = popupText.body;
    rewardPrefix.textContent = t("crosspromo.reward_prefix", "Récompense");
    rewardValue.textContent = String(REWARD_AMOUNT);
    primary.textContent = t("crosspromo.cta_install", "Installer");
    secondary.textContent = t("crosspromo.cta_later", "Plus tard");

    function closePopup() {
      root.style.display = "none";
    }

    primary.onclick = async function () {
      setPendingStoreClick(appId);
      closePopup();
      await openStore(app);
    };

    secondary.onclick = function () {
      registerDismiss(appId);
      closePopup();
    };

    closeBtn.onclick = function () {
      registerDismiss(appId);
      closePopup();
    };

    root.onclick = function (e) {
      if (e.target === root) {
        registerDismiss(appId);
        closePopup();
      }
    };

    root.style.display = "flex";
    return true;
  }

  function getOtherAppId(appId) {
    return appId === "vblocks" ? "vuniverse" : "vblocks";
  }

  function chooseLowVcoinsOffer() {
    const state = readState();
    const firstChoice = state.lowVcoinsNextApp === "vuniverse" ? "vuniverse" : "vblocks";
    const secondChoice = getOtherAppId(firstChoice);

    const firstRow = state.apps[firstChoice];
    const secondRow = state.apps[secondChoice];

    if (canStillShowForGame(firstRow)) {
      state.lowVcoinsNextApp = secondChoice;
      writeState(state);
      return { appId: firstChoice, popupIndex: 1 };
    }

    if (canStillShowForGame(secondRow)) {
      state.lowVcoinsNextApp = firstChoice;
      writeState(state);
      return { appId: secondChoice, popupIndex: 1 };
    }

    return null;
  }

  async function maybeShowPopupFromContext(context) {
    if (!context) return false;

    if (context === "low_vcoins") {
      const offer = chooseLowVcoinsOffer();
      if (!offer) return false;
      return openPromoPopup(offer.appId, offer.popupIndex);
    }

    if (context === "offer_vblocks_after_loss") {
      return openPromoPopup("vblocks", 2);
    }

    if (context === "offer_vuniverse_after_story") {
      return openPromoPopup("vuniverse", 2);
    }

    return false;
  }

  async function bootRewardChecks() {
    await refreshInstalledStatus("vblocks");
    await refreshInstalledStatus("vuniverse");

    await claimRewardIfEligible("vblocks");
    await claimRewardIfEligible("vuniverse");
  }

  function bindShotViewer(host) {
    const viewer = document.getElementById("vc-shot-viewer");
    const viewerImg = document.getElementById("vc-shot-viewer-img");
    const viewerClose = document.getElementById("vc-shot-viewer-close");

    if (!viewer || !viewerImg || !viewerClose || !host) return;

    function closeViewer() {
      viewer.classList.remove("is-open");
      viewer.setAttribute("aria-hidden", "true");
      viewerImg.src = "";
    }

    host.querySelectorAll("[data-shot-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.getAttribute("data-shot-open") || "";
        if (!src) return;
        viewerImg.src = src;
        viewer.classList.add("is-open");
        viewer.setAttribute("aria-hidden", "false");
      });
    });

    viewerClose.onclick = closeViewer;

    viewer.onclick = function (e) {
      if (e.target === viewer) {
        closeViewer();
      }
    };

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && viewer.classList.contains("is-open")) {
        closeViewer();
      }
    });
  }

  async function renderStorePage() {
    const host = document.getElementById("vc-crosspromo-grid");
    if (!host) return;

    const ids = ["vuniverse", "vblocks"];
    const rows = [];

    for (const id of ids) {
      const app = APPS[id];
      const actionLabel = t("crosspromo.cta_install", "Installer");

      rows.push([
        '<article class="vc-crosspromo-card">',
        '  <div class="vc-crosspromo-hero">',
        '    <img src="' + escapeHtml(app.cover) + '" alt="" draggable="false" />',
        '  </div>',
        '  <div class="vc-crosspromo-content">',
        '    <div class="vc-crosspromo-head">',
        '      <div class="vc-crosspromo-reward">',
        '        <span class="vc-crosspromo-reward-label">' + escapeHtml(t("crosspromo.reward_prefix", "Récompense")) + '</span>',
        '        <img src="assets/img/ui/vcoin.webp" alt="" draggable="false" />',
        '        <span class="vc-crosspromo-reward-value">' + escapeHtml(String(REWARD_AMOUNT)) + '</span>',
        '      </div>',
        '    </div>',
        '    <p class="vc-crosspromo-desc">' + escapeHtml(t(app.descKey, app.descFallback)) + '</p>',
        '    <div class="vc-crosspromo-gallery">',
               buildShotsHtml(app),
        '    </div>',
        '    <div class="vc-crosspromo-actions">',
        '      <button class="vc-crosspromo-btn primary" type="button" data-crosspromo-action="' + escapeHtml(id) + '">' + escapeHtml(actionLabel) + '</button>',
        '    </div>',
        '  </div>',
        '</article>'
      ].join(""));
    }

    host.innerHTML = rows.join("");

    bindShotViewer(host);

    host.querySelectorAll("[data-crosspromo-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-crosspromo-action");
        const app = APPS[id];
        if (!app) return;

        setPendingStoreClick(id);
        await openStore(app);
      });
    });
  }

  async function bootIndexPopupFlow() {
    let context = "";
    try {
      context = sessionStorage.getItem(CONTEXT_KEY) || "";
    } catch (_) {}

    if (!context) return;

    try {
      sessionStorage.removeItem(CONTEXT_KEY);
    } catch (_) {}

    await maybeShowPopupFromContext(context);
  }

  function exposeApi() {
    window.VCCrossPromo = {
      maybeShowPopupFromContext,
      refreshInstalledStatus,
      claimRewardIfEligible,

      async openOrInstall(appId) {
        const app = APPS[appId];
        if (!app) return false;

        setPendingStoreClick(appId);
        await openStore(app);
        return true;
      },

      setContext(context) {
        try {
          sessionStorage.setItem(CONTEXT_KEY, String(context || ""));
        } catch (_) {}
      }
    };
  }

  document.addEventListener("DOMContentLoaded", async function () {
    exposeApi();

    try {
      const lang = window.VUserData?.getLang?.() || "fr";
      if (window.VRI18n && typeof window.VRI18n.initI18n === "function") {
        await window.VRI18n.initI18n(lang);
      }
    } catch (_) {}

    await bootRewardChecks();
    await renderStorePage();

    const pathname = String(window.location.pathname || "");
    const isIndex =
      pathname.endsWith("/index.html") ||
      pathname.endsWith("index.html") ||
      pathname === "/" ||
      pathname === "";

    if (isIndex) {
      await bootIndexPopupFlow();
    }
  });
})();