(function () {
  "use strict";

  const FETCHED_KEY = "vchronicles_install_referrer_fetched_v1";
  const PENDING_INVITER_KEY = "vchronicles_install_referrer_pending_inviter_v1";
  const PENDING_RAW_KEY = "vchronicles_install_referrer_pending_raw_v1";
  const LOCAL_INVITER_CREDITS_KEY = "vchronicles_referral_local_inviter_credits_v1";
  const LOCAL_INVITER_LIMIT = 5;

  const INVITE_BASE_URL = "https://vboldcompany.github.io/VChronicles-invite/invite.html";

  function t(key, fallback) {
    try {
      return window.VRI18n?.t?.(key, fallback) || String(fallback || "");
    } catch (_) {
      return String(fallback || "");
    }
  }

  function isNativeAndroid() {
    try {
      return !!window.Capacitor?.isNativePlatform?.() &&
             window.Capacitor?.getPlatform?.() === "android";
    } catch (_) {
      return false;
    }
  }

  function getInstallReferrerPlugin() {
    try {
      if (window.Capacitor?.registerPlugin) {
        return window.Capacitor.registerPlugin("InstallReferrer");
      }
      return window.Capacitor?.Plugins?.InstallReferrer || null;
    } catch (_) {
      return null;
    }
  }

  function getSharePlugin() {
    try {
      if (window.Capacitor?.registerPlugin) {
        return window.Capacitor.registerPlugin("Share");
      }
      return window.Capacitor?.Plugins?.Share || null;
    } catch (_) {
      return null;
    }
  }

  async function getCurrentUid() {
    try { await window.bootstrapAuthAndProfile?.(); } catch (_) {}

    const sb = window.sb;
    if (!sb?.auth) return "";

    try {
      const s = await sb.auth.getSession();
      const uid = s?.data?.session?.user?.id || "";
      if (uid) return uid;
    } catch (_) {}

    try {
      const r = await sb.auth.getUser();
      return r?.data?.user?.id || "";
    } catch (_) {
      return "";
    }
  }

  function buildInviteUrl(uid) {
    return INVITE_BASE_URL + "?inviter_uuid=" + encodeURIComponent(uid);
  }

  async function shareInvite() {
    const uid = await getCurrentUid();
    if (!uid) return false;

    const url = buildInviteUrl(uid);
    const text = t("referral.share_text", "Télécharge VChronicles ici : {url}")
      .replaceAll("{url}", url);

    try {
      const Share = getSharePlugin();
      if (Share?.share) {
        await Share.share({
          title: t("referral.share_title", "Inviter un ami"),
          text,
          dialogTitle: t("referral.share_title", "Inviter un ami")
        });
        return true;
      }
    } catch (_) {}

    try {
      if (navigator.share) {
        await navigator.share({
          title: t("referral.share_title", "Inviter un ami"),
          text
        });
        return true;
      }
    } catch (_) {}

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        try { window.showToast?.(t("referral.link_copied", "Lien copié")); } catch (_) {}
        return true;
      }
    } catch (_) {}

    return false;
  }

  function parseInviterUuidFromRawReferrer(rawReferrer) {
    const raw = String(rawReferrer || "").trim();
    if (!raw) return "";

    try {
      const params = new URLSearchParams(raw);
      return String(params.get("inviter_uuid") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function getLocalReferralCreditsCount() {
    const raw = localStorage.getItem(LOCAL_INVITER_CREDITS_KEY);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function setLocalReferralCreditsCount(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    localStorage.setItem(LOCAL_INVITER_CREDITS_KEY, String(n));
  }

  function incrementLocalReferralCreditsCount() {
    const next = getLocalReferralCreditsCount() + 1;
    setLocalReferralCreditsCount(next);
    return next;
  }

  function hasReachedLocalReferralLimit() {
    return getLocalReferralCreditsCount() >= LOCAL_INVITER_LIMIT;
  }

  async function fetchReferrerOnceFromNative() {
    if (!isNativeAndroid()) return;
    if (localStorage.getItem(FETCHED_KEY) === "1") return;

    const plugin = getInstallReferrerPlugin();
    if (!plugin?.getInstallReferrer) return;

    try {
      const data = await plugin.getInstallReferrer();

      if (data?.canRetry) return;

      const rawReferrer = String(data?.rawReferrer || "").trim();
      let inviterUuid = String(data?.inviterUuid || "").trim();

      if (!inviterUuid && rawReferrer) {
        inviterUuid = parseInviterUuidFromRawReferrer(rawReferrer);
      }

      localStorage.setItem(FETCHED_KEY, "1");

      if (inviterUuid) {
        localStorage.setItem(PENDING_INVITER_KEY, inviterUuid);
        localStorage.setItem(PENDING_RAW_KEY, rawReferrer);
      }
    } catch (_) {}
  }

  async function claimPendingReferral() {
    const pendingInviter = String(localStorage.getItem(PENDING_INVITER_KEY) || "").trim();
    if (!pendingInviter) return;

    if (hasReachedLocalReferralLimit()) {
      localStorage.removeItem(PENDING_INVITER_KEY);
      localStorage.removeItem(PENDING_RAW_KEY);
      return;
    }

    const pendingRaw = String(localStorage.getItem(PENDING_RAW_KEY) || "").trim();

    try { await window.bootstrapAuthAndProfile?.(); } catch (_) {}

    const sb = window.sb;
    if (!sb?.rpc) return;

    try {
      const { data, error } = await sb.rpc("secure_claim_referral_install", {
        p_inviter: pendingInviter,
        p_raw: pendingRaw || null
      });

      if (error) return;

      const reason = String(data?.reason || "");

      if (data?.ok && (reason === "claimed" || reason === "already_processed")) {
        incrementLocalReferralCreditsCount();
        localStorage.removeItem(PENDING_INVITER_KEY);
        localStorage.removeItem(PENDING_RAW_KEY);

        try { await window.VUserData?.refresh?.(); } catch (_) {}
        return;
      }

      if (
        reason === "self_referral" ||
        reason === "invalid_inviter" ||
        reason === "inviter_limit_reached"
      ) {
        localStorage.removeItem(PENDING_INVITER_KEY);
        localStorage.removeItem(PENDING_RAW_KEY);
      }
    } catch (_) {}
  }

  function showAndroidOnlyInvitePopup() {
    return new Promise((resolve) => {
      let root = document.getElementById("vc-referral-platform-popup");

      if (!root) {
        root = document.createElement("div");
        root.id = "vc-referral-platform-popup";
        root.style.cssText = [
          "position:fixed",
          "inset:0",
          "z-index:99999",
          "display:none",
          "align-items:center",
          "justify-content:center",
          "padding:20px",
          "background:rgba(5,10,20,.66)",
          "backdrop-filter:blur(10px)"
        ].join(";");

        root.innerHTML = `
          <div role="dialog" aria-modal="true" style="width:min(420px,92vw);border-radius:22px;padding:20px 18px;background:linear-gradient(180deg, rgba(24,33,58,.98), rgba(13,20,39,.98));border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 46px rgba(0,0,0,.42);color:#fff;">
            <div id="vc-referral-platform-popup-text" style="font-size:14px;line-height:1.45;color:rgba(255,255,255,.92);margin-bottom:16px;"></div>
            <button id="vc-referral-platform-popup-ok" type="button" style="width:100%;min-height:48px;border:0;border-radius:14px;background:linear-gradient(135deg,#ff6b6b,#ff3b3b);color:#fff;font-weight:900;font-size:14px;cursor:pointer;"></button>
          </div>
        `;

        document.body.appendChild(root);
      }

      const textEl = document.getElementById("vc-referral-platform-popup-text");
      const okBtn = document.getElementById("vc-referral-platform-popup-ok");

      if (textEl) {
        textEl.textContent = t(
          "referral.android_only_popup.text",
          "Seule la version Android est disponible pour le moment."
        );
      }

      if (okBtn) {
        okBtn.textContent = t("common.continue", "Continuer");
      }

      const close = () => {
        root.style.display = "none";
        root.onclick = null;
        if (okBtn) okBtn.onclick = null;
        document.removeEventListener("keydown", onKeyDown);
        resolve(true);
      };

      const onKeyDown = (e) => {
        if (e.key === "Escape") close();
      };

      root.onclick = (e) => {
        if (e.target === root) close();
      };

      if (okBtn) okBtn.onclick = close;

      root.style.display = "flex";
      document.addEventListener("keydown", onKeyDown);
      setTimeout(() => okBtn?.focus?.(), 0);
    });
  }

  function showSharePromptPopup(options = {}) {
    return new Promise((resolve) => {
      let root = document.getElementById("vc-referral-share-popup");

      if (!root) {
        root = document.createElement("div");
        root.id = "vc-referral-share-popup";
        root.style.cssText = [
          "position:fixed",
          "inset:0",
          "z-index:100260",
          "display:none",
          "align-items:center",
          "justify-content:center",
          "padding:18px",
          "background:rgba(5,10,18,.72)",
          "backdrop-filter:blur(10px)"
        ].join(";");

        root.innerHTML = `
          <div role="dialog" aria-modal="true" style="position:relative;width:min(460px,94vw);border-radius:24px;padding:20px 18px;background:linear-gradient(180deg, rgba(22,31,54,.98), rgba(12,18,34,.98));border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 56px rgba(0,0,0,.42);color:#fff;overflow:hidden;">
            <button id="vc-referral-share-popup-close" type="button" style="position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-weight:900;font-size:18px;cursor:pointer;">×</button>

            <div style="padding:0 34px 0 34px;">
              <div id="vc-referral-share-popup-title" style="font-size:24px;font-weight:900;line-height:1.15;margin-bottom:10px;text-align:center;"></div>
              <div id="vc-referral-share-popup-body" style="font-size:14px;line-height:1.5;color:rgba(255,255,255,.9);margin-bottom:14px;text-align:center;"></div>
            </div>

            <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px;text-align:center;flex-wrap:wrap;">
              <span style="font-size:17px;font-weight:900;">${t("referral.invite_and_earn_title", "Inviter et gagner")}</span>
              <img src="assets/img/ui/vcoin.webp" alt="" draggable="false" style="width:22px;height:22px;object-fit:contain;">
              <span style="font-weight:900;font-size:18px;">+200</span>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button id="vc-referral-share-popup-main" type="button" style="flex:1 1 220px;min-height:54px;border:0;border-radius:16px;background:linear-gradient(135deg,#ff8a8a,#ff4b4b);color:#fff;font-weight:900;font-size:18px;letter-spacing:.2px;cursor:pointer;box-shadow:0 12px 26px rgba(255,75,75,.34);">
                ${t("referral.invite_and_earn_btn", "Inviter et gagner")}
              </button>
              <button id="vc-referral-share-popup-later" type="button" style="flex:1 1 120px;min-height:48px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.06);color:#fff;font-weight:800;font-size:14px;cursor:pointer;">
                ${t("common.cancel", "Plus tard")}
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(root);
      }

      const titleEl = document.getElementById("vc-referral-share-popup-title");
      const bodyEl = document.getElementById("vc-referral-share-popup-body");
      const closeBtn = document.getElementById("vc-referral-share-popup-close");
      const mainBtn = document.getElementById("vc-referral-share-popup-main");
      const laterBtn = document.getElementById("vc-referral-share-popup-later");

      if (titleEl) titleEl.textContent = String(options.title || t("referral.last_ending_popup_title", "Bravo, tu as débloqué la dernière fin disponible"));
      if (bodyEl) bodyEl.textContent = String(options.body || t("referral.last_ending_popup_body", "Tu as trouvé toutes les fins disponibles pour ce scénario. Tu penses que tes amis y arriveraient aussi ? Invite-les et gagne des VCoins quand une invitation est validée."));

      const close = () => {
        root.style.display = "none";
        root.onclick = null;
        if (closeBtn) closeBtn.onclick = null;
        if (mainBtn) mainBtn.onclick = null;
        if (laterBtn) laterBtn.onclick = null;
        document.removeEventListener("keydown", onKeyDown);
        resolve(true);
      };

      const onKeyDown = (e) => {
        if (e.key === "Escape") close();
      };

      root.onclick = (e) => {
        if (e.target === root) close();
      };
      if (closeBtn) closeBtn.onclick = close;
      if (laterBtn) laterBtn.onclick = close;

      if (mainBtn) {
        mainBtn.onclick = async () => {
          try {
            await showAndroidOnlyInvitePopup();
            await shareInvite();
          } catch (_) {}
          close();
        };
      }

      root.style.display = "flex";
      document.addEventListener("keydown", onKeyDown);
      setTimeout(() => mainBtn?.focus?.(), 0);
    });
  }

  function bindInviteButtons() {
    const ids = ["pf_invite_btn", "cp_invite_btn"];

    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.referralBound === "1") return;

      btn.dataset.referralBound = "1";
      btn.addEventListener("click", async () => {
        await showAndroidOnlyInvitePopup();
        await shareInvite();
      });
    });
  }

  async function bootReferral() {
    bindInviteButtons();
  }

  document.addEventListener("DOMContentLoaded", () => {
    bootReferral().catch(() => {});
  });

  window.VReferral = {
    shareInvite,
    showSharePromptPopup,
    bootReferral
  };
})();
