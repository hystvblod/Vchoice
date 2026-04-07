(function(){
  "use strict";

  const SECRET_STORAGE_KEY = "vchoice_secret_angelique_revealed_v1";

  const PREMIUM_SCENARIOS = {
    village_brume_noire: {
      id: "village_brume_noire",
      secret: false,
      remoteImages: true
    },
    marais_sans_sepulture: {
      id: "marais_sans_sepulture",
      secret: false,
      remoteImages: true
    },
    grotte_angelique: {
      id: "grotte_angelique",
      secret: true,
      remoteImages: true
    }
  };

  function normalizeScenarioId(v){
    return String(v || "").trim().toLowerCase();
  }

  function normalizeSecretInput(v){
    return String(v || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .trim();
  }

  function isPremiumScenario(id){
    return !!PREMIUM_SCENARIOS[normalizeScenarioId(id)];
  }

  function isSecretScenario(id){
    const sid = normalizeScenarioId(id);
    return !!PREMIUM_SCENARIOS[sid]?.secret;
  }

  function usesRemoteImages(id){
    const sid = normalizeScenarioId(id);
    return !!PREMIUM_SCENARIOS[sid]?.remoteImages;
  }

  function isAngeliqueRevealed(){
    try {
      return localStorage.getItem(SECRET_STORAGE_KEY) === "1";
    } catch(_) {
      return false;
    }
  }

  function revealAngelique(){
    const already = isAngeliqueRevealed();

    try {
      localStorage.setItem(SECRET_STORAGE_KEY, "1");
    } catch(_) {}

    if (!already){
      try {
        window.dispatchEvent(new CustomEvent("vc:secret_scenario_revealed", {
          detail: { scenarioId: "grotte_angelique" }
        }));
      } catch(_) {}
    }

    return true;
  }

  function checkAndRevealFromPseudo(v){
    const normalized = normalizeSecretInput(v);

    if (normalized !== "angelique" && normalized !== "baudelaire") return false;

    revealAngelique();
    return true;
  }

  function getProfileScenarioIds(baseIds){
    const out = Array.isArray(baseIds) ? baseIds.slice() : [];

    ["village_brume_noire", "marais_sans_sepulture"].forEach((id) => {
      if (!out.includes(id)) out.push(id);
    });

    if (isAngeliqueRevealed() && !out.includes("grotte_angelique")){
      out.push("grotte_angelique");
    }

    return out;
  }

  function buildSecretScenarioCardHtml(){
    return `
      <button class="vc-card" data-scenario="grotte_angelique" type="button">
        <div class="vc-card-bg" style="background-image:url('assets/scenarios/grotte_angelique/img/cover.webp');"></div>
        <div class="vc-card-content">
          <div class="vc-line">
            <h3 class="vc-title" data-i18n="scenarios.grotte_angelique.title"></h3>
            <span
              class="vc-info"
              role="button"
              tabindex="0"
              data-i18n-tip="scenarios.grotte_angelique.desc"
              data-i18n="ui.symbol_help"></span>
          </div>
        </div>
      </button>
    `;
  }

  function injectSecretScenarioCard(slot){
    const host = (typeof slot === "string") ? document.querySelector(slot) : slot;
    if (!host) return;

    if (!isAngeliqueRevealed()){
      host.innerHTML = "";
      return;
    }

    host.innerHTML = buildSecretScenarioCardHtml();

    try {
      window.VRI18n?.applyI18n?.(host);
    } catch(_) {}
  }

  function getFaqUrl(){
    return "faq.html";
  }

  window.VCScenarioPremium = {
    SECRET_STORAGE_KEY,
    PREMIUM_SCENARIOS,
    normalizeSecretInput,
    isPremiumScenario,
    isSecretScenario,
    usesRemoteImages,
    isAngeliqueRevealed,
    revealAngelique,
    checkAndRevealFromPseudo,
    getProfileScenarioIds,
    buildSecretScenarioCardHtml,
    injectSecretScenarioCard,
    getFaqUrl
  };
})();
