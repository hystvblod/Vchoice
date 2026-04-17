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
    bootReferral
  };
})();
