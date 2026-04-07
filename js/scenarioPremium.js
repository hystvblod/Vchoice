(function(){
  "use strict";

  const SECRET_STORAGE_KEY = "vchoice_secret_angelique_revealed_v1";

  const REMOTE_SCENARIOS = {
    foret_relais: {
      id: "foret_relais",
      remoteImages: true
    },
    village_brume_noire: {
      id: "village_brume_noire",
      remoteImages: true
    },
    marais_sans_sepulture: {
      id: "marais_sans_sepulture",
      remoteImages: true
    }
  };

  function normalizeScenarioId(v){
    return String(v || "").trim().toLowerCase();
  }

  function normalizeSecretInput(v){
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .trim();
  }

  function isRemoteScenario(id){
    return !!REMOTE_SCENARIOS[normalizeScenarioId(id)];
  }

  function isPremiumScenario(id){
    return isRemoteScenario(id);
  }

  function usesRemoteImages(id){
    return isRemoteScenario(id);
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
    if (normalizeSecretInput(v) !== "angelique") return false;
    revealAngelique();
    return true;
  }

  function getProfileScenarioIds(baseIds){
    const out = Array.isArray(baseIds) ? baseIds.slice() : [];

    if (!out.includes("village_brume_noire")) out.push("village_brume_noire");
    if (!out.includes("marais_sans_sepulture")) out.push("marais_sans_sepulture");

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
    return "settings.html#faq-remote-scenarios";
  }

  window.VCScenarioPremium = {
    SECRET_STORAGE_KEY,
    REMOTE_SCENARIOS,
    normalizeSecretInput,
    isRemoteScenario,
    isPremiumScenario,
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
