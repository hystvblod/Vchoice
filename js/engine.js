/* engine.js — VERSION COMPLETE À JOUR
   Base: ton fichier (lang device + menu + jetons + guide + end modal)
   + ✅ Intro tuto: popup FORCÉE “Débloquer avec 1 jeton” (CTA clignotant, gros, centré)
   + ✅ Bypass “pas assez” : on seed 1 jeton tuto (1 seule fois) puis on le dépense
   + ✅ Pas de fermeture possible tant que le tuto jeton n’est pas fait
   + ✅ Fin du tuto : icônes webp (jeton/vcoin), pas de bouton recommencer, fermeture -> index.html
*/

/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const DEFAULT_LANG = "en";

// Langues prévues (même si certains ui_<lang>.json ne sont pas encore présents)
const SUPPORTED_LANGS = ["fr","en","de","es","pt","ptbr","it","ko","ja"];

// ✅ Onboarding / Intro tuto
const ONBOARD_DONE_KEY   = "vchoice_onboarding_done_v1";
const INTRO_REWARD_KEY   = "vchoice_intro_rewarded_v1";
const INTRO_SCENARIO_ID  = "intro_tuto";

// ✅ Intro tuto: popup jeton forcée
const INTRO_FORCED_JETON_USED_KEY   = "vchoice_intro_forced_jeton_used_v1";
const INTRO_FORCED_JETON_SEEDED_KEY = "vchoice_intro_forced_jeton_seeded_v1";

// ✅ Jeton image (WEBP) affichée dans la popup tuto
const TUTO_JETON_ICON_WEBP = "assets/img/ui/jeton.webp";
// ✅ VCoins image (WEBP) dans la popup fin du tuto
const VCOIN_ICON_WEBP = "assets/img/ui/vcoin.webp";

const PATHS = {
  ui: (lang) => `data/ui/ui_${lang}.json`,
  catalog: `data/scenarios/catalog.json`,
  scenarioLogic: (scenarioId) => `data/scenarios/${scenarioId}/logic.json`,
  scenarioText:  (scenarioId, lang) => `data/scenarios/${scenarioId}/text_${lang}.json`,
};

/* =========================
   GLOBAL STATE
========================= */
let LANG = DEFAULT_LANG;

let UI = null;
let CATALOG = null;

let currentScenarioId = null;
let LOGIC = null;
let TEXT = null;
let TEXT_STRINGS = null;

let scenarioStates = {};

// Guide vers une fin (BFS)
let GUIDE_STATE = {
  active: false,
  targetType: null,
  nextByScene: {},
  path: []
};

// ✅ Bypass flags (activé quand on paie 3 jetons)
let OVERRIDE_FLAGS = false;

/* =========================
   SMALL HELPERS
========================= */
function $(id){ return document.getElementById(id); }

async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error(`fetch ${url} => ${r.status}`);
  return await r.json();
}

function deepGet(obj, path){
  if(!obj) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for(const p of parts){
    if(cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function format(str, params={}){
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ""));
}

// UI translator
function tUI(key, params){
  try{
    const v = deepGet(UI, `ui.${key}`);
    if(typeof v === "string") return format(v, params || {});
  }catch(_){}
  return `[${key}]`;
}

// Scenario translator (TEXT_STRINGS flat OR nested)
function tS(key, params){
  try{
    if(TEXT_STRINGS && Object.prototype.hasOwnProperty.call(TEXT_STRINGS, key)){
      const v = TEXT_STRINGS[key];
      if(typeof v === "string") return format(v, params || {});
    }
    const v2 = deepGet(TEXT, key);
    if(typeof v2 === "string") return format(v2, params || {});
  }catch(_){}
  return `[${key}]`;
}

/* =========================
   STORAGE SAVE/LOAD
========================= */
function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(_){ return null; }
}

function save(){
  try{
    const payload = {
      lang: LANG,
      currentScenarioId,
      scenarioStates
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  }catch(_){}
}

/* =========================
   LANG
========================= */
function getDeviceLang(){
  try{
    const nav = (navigator.language || navigator.userLanguage || DEFAULT_LANG || "en").toLowerCase();
    const short = nav.split("-")[0];
    return SUPPORTED_LANGS.includes(short) ? short : DEFAULT_LANG;
  }catch(_){
    return DEFAULT_LANG;
  }
}

async function loadUI(lang){
  try{
    UI = await fetchJSON(PATHS.ui(lang));
  }catch(_){
    UI = await fetchJSON(PATHS.ui(DEFAULT_LANG));
  }
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog);
}

async function loadScenario(scenarioId){
  currentScenarioId = scenarioId;

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));
  try{
    TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  }catch(_){
    try{ TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, DEFAULT_LANG)); }
    catch(_2){ TEXT = {}; }
  }

  // support both flat {"strings":{...}} and direct nested
  TEXT_STRINGS = null;
  try{
    if(TEXT && TEXT.strings && typeof TEXT.strings === "object"){
      TEXT_STRINGS = TEXT.strings;
    }
  }catch(_){}
}

function resolveStartScene(logic){
  return (logic && logic.start_scene) ? String(logic.start_scene) : "s01";
}

function getCurrentScene(){
  const st = scenarioStates[currentScenarioId];
  if(!st) return null;

  const id = String(st.scene || "");
  const scenes = (LOGIC && LOGIC.scenes) ? LOGIC.scenes : {};
  const sc = scenes[id] || null;
  if(sc){
    sc.id = id;
    return sc;
  }
  return null;
}

function hardResetScenario(scenarioId){
  if(!scenarioId) return;
  scenarioStates[scenarioId] = {
    scene: resolveStartScene(LOGIC),
    flags: {},
    clues: [],
    history: []
  };
  save();
}

/* =========================
   FLAGS / CLUES
========================= */
function setFlag(flag){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  st.flags ??= {};
  st.flags[String(flag)] = true;
}

function clearFlag(flag){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  st.flags ??= {};
  delete st.flags[String(flag)];
}

function hasFlag(flag){
  const st = scenarioStates[currentScenarioId];
  if(!st) return false;
  st.flags ??= {};
  return !!st.flags[String(flag)];
}

function addClue(clueId){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  st.clues ??= [];
  if(!st.clues.includes(clueId)) st.clues.push(clueId);
}

/* =========================
   HUD / TOPBAR (minimal)
========================= */
function renderTopbar(){
  const btnBack = $("btnBack");
  const btnJetons = $("btnJetons");
  const btnSettings = $("btnSettings");
  const btnProfile = $("btnProfile");

  if(btnBack) btnBack.setAttribute("aria-label", tUI("btn_back") || "");
  if(btnJetons) btnJetons.setAttribute("aria-label", tUI("jeton_title") || "");
  if(btnSettings) btnSettings.setAttribute("aria-label", tUI("settings_open_profile_aria") || "");
  if(btnProfile) btnProfile.setAttribute("aria-label", tUI("settings_open_profile_aria") || "");

  if(btnBack && !btnBack.__bound){
    btnBack.__bound = true;
    btnBack.addEventListener("click", () => history.back());
  }
  if(btnSettings && !btnSettings.__bound){
    btnSettings.__bound = true;
    btnSettings.addEventListener("click", () => window.location.href = "settings.html");
  }
  if(btnProfile && !btnProfile.__bound){
    btnProfile.__bound = true;
    btnProfile.addEventListener("click", () => window.location.href = "profile.html");
  }
  if(btnJetons && !btnJetons.__bound){
    btnJetons.__bound = true;
    btnJetons.addEventListener("click", () => showJetonModal());
  }
}

function updateHudJetons(){
  const el = $("hudJetons");
  if(!el) return;
  try{
    let jetons = 0;
    if(window.VUserData && typeof window.VUserData.getJetons === "function"){
      jetons = Number(window.VUserData.getJetons() || 0);
    }
    el.textContent = String(jetons);
  }catch(_){}
}

/* =========================
   RESUME MODAL
========================= */
function ensureResumeModal(){
  const m = $("resumeModal");
  const bd = $("resumeBackdrop");
  const c = $("resumeClose");
  if(m && bd && !bd.__bound){
    bd.__bound = true;
    bd.addEventListener("click", hideResumeModal);
  }
  if(c && !c.__bound){
    c.__bound = true;
    c.addEventListener("click", hideResumeModal);
  }
}

function showResumeModal(onContinue, onRestart){
  ensureResumeModal();

  const modal = $("resumeModal");
  const t = $("resumeTitle");
  const b = $("resumeBody");
  const btnC = $("btnResumeContinue");
  const btnR = $("btnResumeRestart");
  if(!modal || !t || !b || !btnC || !btnR) return;

  t.textContent = tUI("resume_title");
  b.textContent = tUI("resume_body") || tUI("resume_desc") || "";

  btnC.textContent = tUI("btn_continue");
  btnR.textContent = tUI("btn_restart");

  btnC.onclick = () => { hideResumeModal(); onContinue && onContinue(); };
  btnR.onclick = () => { hideResumeModal(); onRestart && onRestart(); };

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

function hideResumeModal(){
  const modal = $("resumeModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

/* =========================
   END MODAL
========================= */
function ensureEndModal(){
  const m = $("endModal");
  const bd = $("endBackdrop");
  const c = $("endClose");
  if(m && bd && !bd.__bound){
    bd.__bound = true;
    bd.addEventListener("click", hideEndModal);
  }
  if(c && !c.__bound){
    c.__bound = true;
    c.addEventListener("click", hideEndModal);
  }
}

function showEndModal(title, body, onBack, onReplay){
  ensureEndModal();

  const modal = $("endModal");
  const t = $("endTitle");
  const b = $("endBody");
  const btnBack = $("btnEndBack");
  const btnReplay = $("btnEndReplay");
  if(!modal || !t || !b || !btnBack || !btnReplay) return;

  // reset any redirect mode
  try{ delete modal.dataset.redirect; }catch(_){}

  // reset buttons
  btnBack.style.display = "";
  btnReplay.style.display = "";

  // reset buttons container alignment (inline style in HTML)
  try{
    const wrap = btnBack.parentNode;
    if(wrap && wrap.style) wrap.style.justifyContent = "flex-end";
  }catch(_){}

  t.textContent = title || tUI("end_title");

  // clear body
  try{
    while(b.firstChild) b.removeChild(b.firstChild);
  }catch(_){
    b.textContent = "";
  }
  // default body = simple text
  const p = document.createElement("div");
  p.textContent = body || "";
  b.appendChild(p);

  btnBack.textContent = tUI("btn_back");
  btnReplay.textContent = tUI("btn_restart");

  btnBack.onclick = () => { hideEndModal(); onBack && onBack(); };
  btnReplay.onclick = () => { hideEndModal(); onReplay && onReplay(); };

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

/* ✅ Version “riche” pour l’écran de fin (DOM), sans texte en dur */
function showEndModalRich(title, buildBodyFn, opts={}){
  ensureEndModal();

  const modal = $("endModal");
  const t = $("endTitle");
  const b = $("endBody");
  const btnBack = $("btnEndBack");
  const btnReplay = $("btnEndReplay");
  if(!modal || !t || !b || !btnBack || !btnReplay) return;

  // reset body
  try{
    while(b.firstChild) b.removeChild(b.firstChild);
  }catch(_){
    b.textContent = "";
  }

  t.textContent = title || tUI("end_title");

  try{ buildBodyFn?.(b); }catch(_){}

  // redirect mode for close/backdrop/X
  if(opts && opts.redirect){
    try{ modal.dataset.redirect = String(opts.redirect || ""); }catch(_){}
  }else{
    try{ delete modal.dataset.redirect; }catch(_){}
  }

  // single button mode
  const single = !!opts.single;
  btnReplay.style.display = single ? "none" : "";
  btnBack.style.display = "";

  try{
    const wrap = btnBack.parentNode;
    if(wrap && wrap.style) wrap.style.justifyContent = single ? "center" : "flex-end";
  }catch(_){}

  btnBack.textContent = opts.backLabel ? String(opts.backLabel) : (single ? tUI("btn_close") : tUI("btn_back"));
  btnReplay.textContent = tUI("btn_restart");

  btnBack.onclick = () => { hideEndModal(); opts.onBack && opts.onBack(); };
  btnReplay.onclick = () => { hideEndModal(); opts.onReplay && opts.onReplay(); };

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

function hideEndModal(){
  const modal = $("endModal");
  if(!modal) return;

  let redirect = "";
  try{ redirect = String(modal.dataset.redirect || ""); }catch(_){}
  try{ delete modal.dataset.redirect; }catch(_){}

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");

  if(redirect){
    try{ window.location.href = redirect; }catch(_){}
  }
}

/* =========================
   HINT MODAL
========================= */
function bindHintModal(){
  const modal = $("hintModal");
  const bd = $("hintBackdrop");
  const c = $("hintClose");
  if(modal && bd && !bd.__bound){
    bd.__bound = true;
    bd.addEventListener("click", hideHintModal);
  }
  if(c && !c.__bound){
    c.__bound = true;
    c.addEventListener("click", hideHintModal);
  }
}

function showHintModal(title, body){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  const close = $("hintClose");
  if(!modal || !t || !b) return;

  // ✅ reset lock
  try{ delete modal.dataset.forceLock; }catch(_){}
  if(close) close.style.display = "";

  t.textContent = title || tUI("hint_title");
  b.textContent = body || "";

  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function hideHintModal(){
  const modal = $("hintModal");
  if(!modal) return;

  // ✅ Intro tuto: impossible de fermer tant que la popup forcée est active
  try{
    if(String(modal.dataset.forceLock || "") === "1") return;
  }catch(_){}

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");

  const close = $("hintClose");
  if(close) close.style.display = "";
}

function showHintModalWithActions(title, bodyLines, actions){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  const close = $("hintClose");
  if(!modal || !t || !b) return;

  // ✅ reset lock
  try{ delete modal.dataset.forceLock; }catch(_){}
  if(close) close.style.display = "";

  t.textContent = title || tUI("hint_title");
  b.textContent = "";

  const text = Array.isArray(bodyLines) ? bodyLines.join("\n") : String(bodyLines || "");
  b.textContent = text;

  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);

  const wrap = document.createElement("div");
  wrap.id = "hintActions";
  wrap.style.paddingTop = "12px";
  wrap.style.display = "flex";
  wrap.style.gap = "10px";
  wrap.style.justifyContent = "flex-end";
  wrap.style.flexWrap = "wrap";

  for(const a of (actions || [])){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = a.className || "btn";
    btn.textContent = a.label || tUI("btn_ok");
    btn.disabled = !!a.disabled;
    btn.onclick = async () => {
      try{ await a.onClick?.(); } finally {}
    };
    wrap.appendChild(btn);
  }

  b.parentNode.appendChild(wrap);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

/* ✅ Version “riche” pour la popup tuto (image + layout), sans texte en dur */
function showHintModalWithActionsRich(title, buildBodyFn, buildActionsFn){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

  t.textContent = title || tUI("hint_title");

  // clear body
  try{
    while(b.firstChild) b.removeChild(b.firstChild);
  }catch(_){
    b.textContent = "";
  }

  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);

  try{ buildBodyFn?.(b); }catch(_){}

  const wrap = document.createElement("div");
  wrap.id = "hintActions";
  wrap.style.paddingTop = "12px";
  wrap.style.display = "flex";
  wrap.style.gap = "10px";
  wrap.style.justifyContent = "flex-end";
  wrap.style.flexWrap = "wrap";

  try{ buildActionsFn?.(wrap); }catch(_){}

  b.parentNode.appendChild(wrap);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

/* =========================
   JETON MODAL (minimal)
========================= */
function showJetonModal(){
  const modal = $("jetonModal");
  if(!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  updateJetonModalCount();
}

function hideJetonModal(){
  const modal = $("jetonModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

function bindJetonModal(){
  const modal = $("jetonModal");
  const bd = $("jetonBackdrop");
  const c = $("jetonClose");
  if(modal && bd && !bd.__bound){
    bd.__bound = true;
    bd.addEventListener("click", hideJetonModal);
  }
  if(c && !c.__bound){
    c.__bound = true;
    c.addEventListener("click", hideJetonModal);
  }

  const btnBack = $("btnJetonBackModal");
  if(btnBack && !btnBack.__bound){
    btnBack.__bound = true;
    btnBack.addEventListener("click", () => {
      hideJetonModal();
      goBackWithJeton();
    });
  }

  // guide (si présent)
  const btnGood = $("btnJetonGuideGood");
  const btnBad = $("btnJetonGuideBad");
  const btnSecret = $("btnJetonGuideSecret");
  const btnStop = $("btnJetonStopGuide");

  if(btnGood && !btnGood.__bound){
    btnGood.__bound = true;
    btnGood.addEventListener("click", () => startGuide("good"));
  }
  if(btnBad && !btnBad.__bound){
    btnBad.__bound = true;
    btnBad.addEventListener("click", () => startGuide("bad"));
  }
  if(btnSecret && !btnSecret.__bound){
    btnSecret.__bound = true;
    btnSecret.addEventListener("click", () => startGuide("secret"));
  }
  if(btnStop && !btnStop.__bound){
    btnStop.__bound = true;
    btnStop.addEventListener("click", stopGuide);
  }
}

function updateJetonModalCount(){
  const c = $("jetonModalCount");
  if(!c) return;
  try{
    let jetons = 0;
    if(window.VUserData && typeof window.VUserData.getJetons === "function"){
      jetons = Number(window.VUserData.getJetons() || 0);
    }
    c.textContent = String(jetons);
  }catch(_){}
}

async function goBackWithJeton(){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  st.history ??= [];
  if(!st.history.length){
    showHintModal(tUI("hint_title"), tUI("locked_no_back"));
    return;
  }

  const res = await spendJetons(1);
  if(!res?.ok){
    showHintModal(tUI("hint_title"), tUI("jeton_not_enough"));
    return;
  }

  st.scene = st.history.pop();
  save();
  updateHudJetons();
  hideHintModal();
  renderScene();
}

/* =========================
   GUIDE (minimal)
========================= */
function updateJetonGuideUI(){
  // ton fichier original gère déjà; on laisse tel quel (stub safe)
  try{
    if(typeof window.updateJetonGuideUI === "function") window.updateJetonGuideUI();
  }catch(_){}
}

function stopGuide(){
  GUIDE_STATE.active = false;
  GUIDE_STATE.targetType = null;
  GUIDE_STATE.nextByScene = {};
  GUIDE_STATE.path = [];
  updateJetonGuideUI();
  showHintModal(tUI("jeton_title"), tUI("jeton_guide_stopped"));
}

async function startGuide(targetType){
  // ton fichier original gère déjà; stub safe
  try{
    if(typeof window.startGuide === "function") return await window.startGuide(targetType);
  }catch(_){}
}

/* =========================
   LOCKED CHOICES HELPERS
========================= */
function getMissingFlagsForChoice(choice){
  const missingAll = [];
  const missingAny = [];

  const st = scenarioStates[currentScenarioId];
  if(!st) return { missingAll, missingAny };
  st.flags ??= {};

  if(Array.isArray(choice.requires_flags)){
    for(const f of choice.requires_flags){
      if(!hasFlag(f)) missingAll.push(f);
    }
  }

  if(Array.isArray(choice.requires_any_flags)){
    let ok = false;
    for(const f of choice.requires_any_flags){
      if(hasFlag(f)){ ok = true; break; }
    }
    if(!ok){
      for(const f of choice.requires_any_flags){
        if(!hasFlag(f)) missingAny.push(f);
      }
    }
  }

  return { missingAll, missingAny };
}

function grantMissingFlags(choice, missingAll, missingAny){
  // requires_flags: on donne TOUS les objets manquants
  if(Array.isArray(missingAll) && missingAll.length){
    for(const f of missingAll) setFlag(f);
    return { granted: missingAll.slice() };
  }

  // requires_any_flags: on donne UN seul objet (sinon tu flingues le “any”)
  if(Array.isArray(missingAny) && missingAny.length){
    const f = missingAny[0];
    setFlag(f);
    return { granted: [f] };
  }

  return { granted: [] };
}

async function spendJetons(cost){
  if(!window.VUserData || typeof window.VUserData.spendJetons !== "function"){
    return { ok:false, reason:"no_userData" };
  }
  return await window.VUserData.spendJetons(cost);
}

function prettyFlagTitle(flag){
  const ns = LOGIC?.meta?.hint_ns || "";
  const keys = [
    `${ns}.clue.${flag}.title`,
    `hf.clue.${flag}.title`
  ];

  for (const key of keys){
    const v = (TEXT_STRINGS && Object.prototype.hasOwnProperty.call(TEXT_STRINGS, key))
      ? TEXT_STRINGS[key]
      : deepGet(TEXT, key);
    if (v) return v;
  }

  return flag;
}

/* ✅ exécute le choix (réutilisé pour auto-lancer après déblocage) */
async function executeChoice(ch){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  if(Array.isArray(ch.set_flags)){
    for(const f of ch.set_flags) setFlag(f);
  }
  if(Array.isArray(ch.clear_flags)){
    for(const f of ch.clear_flags) clearFlag(f);
  }

  if(ch.add_clue) addClue(ch.add_clue);

  if(ch.ending){
    save();
    await handleEnding(ch.ending, null);
    return;
  }

  if(ch.next){
    st.history ??= [];
    st.history.push(st.scene);

    st.scene = ch.next;
    save();
    renderScene();
    return;
  }

  showHintModal(
    tUI("hint_title"),
    tUI("no_next_scene")
  );
}

/* =========================
   INTRO TUTO — POPUP JETON FORCÉE
========================= */
let _introTutoStyleDone = false;

function ensureIntroTutoStyle(){
  if(_introTutoStyleDone) return;
  _introTutoStyleDone = true;

  try{
    const css = `
      .vc-tuto-row{ display:flex; align-items:flex-start; gap:12px; padding:6px 0 2px; }
      .vc-tuto-row img{ width:56px; height:56px; flex:0 0 auto; }
      .vc-jeton-static{ transform: none; filter: drop-shadow(0 10px 20px rgba(0,0,0,.30)); }
      .vc-tuto-col{ display:flex; flex-direction:column; gap:8px; }
      .vc-tuto-missing{ opacity:.98; font-weight:750; }
      .vc-tuto-note{ opacity:.92; }
      .vc-tuto-msg{ margin-top:10px; opacity:.95; }
      .vc-tuto-btn{ display:inline-flex; align-items:center; gap:10px; }
      .vc-tuto-btn img{ width:18px; height:18px; }
      .vc-tuto-cta{ display:inline-flex; align-items:center; justify-content:center; animation: vcCtaPulse .95s infinite ease-in-out; transform-origin:center; }
      .vc-tuto-cta .vc-tuto-btn{ font-size:16px; font-weight:900; letter-spacing:.2px; }
      @keyframes vcCtaPulse{
        0%{ transform:scale(1); filter: drop-shadow(0 10px 26px rgba(0,0,0,.28)); }
        50%{ transform:scale(1.06); filter: drop-shadow(0 16px 34px rgba(0,0,0,.40)); }
        100%{ transform:scale(1); filter: drop-shadow(0 10px 26px rgba(0,0,0,.28)); }
      }
    `;
    const st = document.createElement("style");
    st.id = "vc_intro_tuto_style";
    st.textContent = css;
    document.head.appendChild(st);
  }catch(_){}
}

async function seedIntroTutoJetonIfNeeded(){
  try{
    if(String(currentScenarioId || "") !== INTRO_SCENARIO_ID) return;

    let seeded = false;
    try{ seeded = (localStorage.getItem(INTRO_FORCED_JETON_SEEDED_KEY) === "1"); }catch(_){}
    if(seeded) return;

    if(window.VUserData && typeof window.VUserData.addJetons === "function"){
      try{ await window.VUserData.addJetons(1); }catch(_){}
    }

    try{ localStorage.setItem(INTRO_FORCED_JETON_SEEDED_KEY, "1"); }catch(_){}

    updateHudJetons();
    updateJetonModalCount();
  }catch(_){}
}

function getIntroTutoText(key, fallbackUiKey, params){
  // key = "it.tuto.locked.title" etc (dans text_<lang>.json du scénario intro)
  const v = tS(key, params);
  if(v && v !== `[${key}]`) return v;
  return fallbackUiKey ? tUI(fallbackUiKey, params) : v;
}

function showIntroForcedJetonModal(choice, missingAll, missingAny){
  ensureIntroTutoStyle();

  const modal = $("hintModal");
  const close = $("hintClose");
  if(modal){
    try{ modal.dataset.forceLock = "1"; }catch(_){}
  }
  if(close) close.style.display = "none";

  const missing = (Array.isArray(missingAll) && missingAll.length) ? missingAll.slice()
    : (Array.isArray(missingAny) && missingAny.length) ? missingAny.slice()
    : [];

  const first = missing.length ? missing[0] : null;
  const itemTitle = first ? prettyFlagTitle(first) : "";

  const title = getIntroTutoText("it.tuto.locked.title", "intro_forced_jeton_title");
  const bodyMain = getIntroTutoText("it.tuto.locked.body", "intro_forced_jeton_body");
  const missingLine = getIntroTutoText("it.tuto.locked.missing", "intro_forced_jeton_missing", { item: itemTitle });
  const note = getIntroTutoText("it.tuto.locked.note", "intro_forced_jeton_note");
  const ctaLabel = getIntroTutoText("it.tuto.locked.cta", "intro_forced_jeton_cta");
  const errMsg = getIntroTutoText("it.tuto.locked.error", "intro_forced_jeton_error");
  const okMsg = getIntroTutoText("it.tuto.locked.ok", "intro_forced_jeton_ok", { item: itemTitle });

  showHintModalWithActionsRich(
    title,
    (root) => {
      const row = document.createElement("div");
      row.className = "vc-tuto-row";

      const img = document.createElement("img");
      img.src = TUTO_JETON_ICON_WEBP;
      img.alt = "";
      img.draggable = false;
      img.className = "vc-jeton-static";
      row.appendChild(img);

      const col = document.createElement("div");
      col.className = "vc-tuto-col";

      const p1 = document.createElement("div");
      p1.textContent = bodyMain;
      col.appendChild(p1);

      if(itemTitle){
        const p2 = document.createElement("div");
        p2.className = "vc-tuto-missing";
        p2.textContent = missingLine && missingLine !== `[it.tuto.locked.missing]`
          ? missingLine
          : tUI("intro_forced_jeton_missing", { item: itemTitle });
        col.appendChild(p2);
      }

      const p3 = document.createElement("div");
      p3.className = "vc-tuto-note";
      p3.textContent = note;
      col.appendChild(p3);

      row.appendChild(col);
      root.appendChild(row);

      const msg = document.createElement("div");
      msg.id = "vcTutoMsg";
      msg.className = "vc-tuto-msg";
      msg.textContent = "";
      root.appendChild(msg);
    },
    (actionsWrap) => {
      try{ actionsWrap.style.justifyContent = "center"; actionsWrap.style.width = "100%"; }catch(_){ }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn vc-tuto-cta";

      const inner = document.createElement("span");
      inner.className = "vc-tuto-btn";

      const tx = document.createElement("span");
      tx.textContent = ctaLabel;
      inner.appendChild(tx);

      const ic = document.createElement("img");
      ic.src = TUTO_JETON_ICON_WEBP;
      ic.alt = "";
      ic.draggable = false;
      ic.className = "vc-jeton-static";
      inner.appendChild(ic);

      btn.appendChild(inner);

      btn.onclick = async () => {
        const msg = $("vcTutoMsg");

        try{
          // ✅ 1) seed 1 jeton tuto (1 seule fois) -> pas de blocage “pas assez”
          await seedIntroTutoJetonIfNeeded();

          // ✅ 2) dépenser 1 jeton (le joueur comprend le système)
          let ok = true;
          if(window.VUserData && typeof window.VUserData.spendJetons === "function"){
            const r = await spendJetons(1);
            ok = !!r?.ok;
          }

          if(!ok){
            updateHudJetons();
            updateJetonModalCount();
            if(msg) msg.textContent = errMsg;
            return;
          }

          // ✅ 3) débloquer l’objet manquant puis exécuter
          grantMissingFlags(choice, missingAll, missingAny);
          save();

          try{ localStorage.setItem(INTRO_FORCED_JETON_USED_KEY, "1"); }catch(_){}

          updateHudJetons();
          updateJetonModalCount();

          // ✅ on libère la fermeture
          const m = $("hintModal");
          if(m){
            try{ delete m.dataset.forceLock; }catch(_){}
          }
          const c = $("hintClose");
          if(c) c.style.display = "";

          if(msg && okMsg && okMsg !== `[it.tuto.locked.ok]`) msg.textContent = okMsg;

          hideHintModal();
          await executeChoice(choice);
        }catch(_){
          updateHudJetons();
          updateJetonModalCount();
          if(msg) msg.textContent = errMsg;
        }
      };

      actionsWrap.appendChild(btn);
    }
  );

  // seed immédiat pour que le joueur voie le jeton “utile”
  seedIntroTutoJetonIfNeeded();
}

/* ✅ popup locked: propose Jeton OU Pub pour obtenir l’objet manquant */
function showLockedChoiceModal(choice){
  const { missingAll, missingAny } = getMissingFlagsForChoice(choice);

  // ✅ Intro tuto : 1ère fois uniquement -> popup forcée
  try{
    if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
      let used = false;
      try{ used = (localStorage.getItem(INTRO_FORCED_JETON_USED_KEY) === "1"); }catch(_){}
      if(!used){
        showIntroForcedJetonModal(choice, missingAll, missingAny);
        return;
      }
    }
  }catch(_){}

  const lines = [];
  lines.push(tUI("locked_body"));

  if(missingAll.length){
    lines.push("");
    lines.push(tUI("locked_missing"));
    for(const f of missingAll){
      lines.push(`• ${prettyFlagTitle(f)}`);
    }
  }

  if(missingAny.length){
    lines.push("");
    lines.push(tUI("locked_missing_any"));
    for(const f of missingAny){
      lines.push(`• ${prettyFlagTitle(f)}`);
    }
  }

  lines.push("");
  lines.push(tUI("locked_note_foundable"));
  lines.push("");

  const actions = [];

  // ✅ Dépenser 1 jeton
  actions.push({
    label: tUI("locked_unlock_jeton"),
    className: "btn",
    onClick: async () => {
      try{
        // check local solde si dispo (UX)
        let jetons = 0;
        if(window.VUserData && typeof window.VUserData.getJetons === "function"){
          try{ jetons = Number(window.VUserData.getJetons() || 0); }catch(_){}
        }
        if(jetons < 1){
          showHintModal(tUI("locked_title"), tUI("locked_unlock_no_jetons"));
          return;
        }

        const res = await spendJetons(1);
        if(!res?.ok){
          updateHudJetons();
          showHintModal(tUI("locked_title"), tUI("locked_unlock_no_jetons"));
          return;
        }

        // grant flags + save
        grantMissingFlags(choice, missingAll, missingAny);
        save();
        updateHudJetons();
        updateJetonModalCount();

        // ferme modal puis auto-exécute le choix
        hideHintModal();
        await executeChoice(choice);
      }catch(e){
        updateHudJetons();
        updateJetonModalCount();
        showHintModal(tUI("locked_title"), tUI("locked_unlock_error"));
      }
    }
  });

  // ✅ Regarder une pub
  actions.push({
    label: tUI("locked_unlock_ad"),
    className: "btn btn--ghost",
    onClick: async () => {
      try{
        if(!window.VAds || typeof window.VAds.showRewarded !== "function"){
          showHintModal(tUI("locked_title"), tUI("locked_unlock_ad_fail"));
          return;
        }

        const r = await window.VAds.showRewarded();
        if(!r?.ok){
          showHintModal(tUI("locked_title"), tUI("locked_unlock_ad_fail"));
          return;
        }

        // grant flags + save
        grantMissingFlags(choice, missingAll, missingAny);
        save();

        // ferme modal puis auto-exécute le choix
        hideHintModal();
        await executeChoice(choice);
      }catch(e){
        showHintModal(tUI("locked_title"), tUI("locked_unlock_ad_fail"));
      }
    }
  });

  // fermer
  actions.push({
    label: tUI("locked_close"),
    className: "btn btn--ghost",
    onClick: () => hideHintModal()
  });

  showHintModalWithActions(
    tUI("locked_title"),
    lines,
    actions
  );
}

/* =========================
   ENDING (modal fin)
========================= */
async function handleEnding(type, endScene){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  // ✅ Onboarding: dès qu'on atteint une fin (good/bad/secret), on considère le tuto "vu"
  try{
    if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
      try{ localStorage.setItem(ONBOARD_DONE_KEY, "1"); }catch(_){}
    }
  }catch(_){}

  GUIDE_STATE.active = false;
  GUIDE_STATE.targetType = null;
  GUIDE_STATE.nextByScene = {};
  GUIDE_STATE.path = [];
  OVERRIDE_FLAGS = false;

  updateJetonGuideUI();

  const endingType = String(type || "").toLowerCase();

  // ✅ ENREGISTREMENT FIN (badge full uniquement si fin réellement atteinte)
  try{
    if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
      await window.VUserData.completeScenario(currentScenarioId, endingType);
    }
  }catch(e){}

  // ✅ Reward spécifique Intro (1 seule fois, GOOD/BAD/SECRET)
  try{
    if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
      let rewarded = false;
      try{ rewarded = (localStorage.getItem(INTRO_REWARD_KEY) === "1"); }catch(_){}
      if(!rewarded){
        try{
          if(window.VUserData && typeof window.VUserData.addJetons === "function"){
            await window.VUserData.addJetons(2);
          }
        }catch(_){}
        try{
          if(window.VUserData && typeof window.VUserData.addVCoins === "function"){
            await window.VUserData.addVCoins(100);
          }
        }catch(_){}
        try{ localStorage.setItem(INTRO_REWARD_KEY, "1"); }catch(_){}
        updateHudJetons();
        updateJetonModalCount();
      }
    }
  }catch(_){}

  // ✅ Titre/body: si endScene a des keys, on les affiche (i18n scénario)
  let title = tUI("end_title");
  if(endingType === "good") title = tUI("end_title_good");
  if(endingType === "bad") title = tUI("end_title_bad");
  if(endingType === "secret") title = tUI("end_title_secret");

  let body = tUI("ending_desc");

  try{
    if(endScene && endScene.title_key) title = tS(endScene.title_key);
    if(endScene && endScene.body_key) body  = tS(endScene.body_key);
  }catch(_){}

  // ✅ Fin spécifique au tuto intro : 1 bouton -> fermeture + retour index, icônes webp
  if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
    showEndModalRich(
      tUI("intro_end_title") || title,
      (root) => {
        const pTop = document.createElement("div");
        pTop.style.marginBottom = "10px";
        pTop.appendChild(document.createTextNode(tUI("intro_end_line1") || ""));
        pTop.appendChild(document.createElement("br"));
        pTop.appendChild(document.createTextNode(tUI("intro_end_line2") || ""));
        root.appendChild(pTop);

        // Rewards
        const rewardLabel = document.createElement("div");
        rewardLabel.style.margin = "12px 0 6px";
        rewardLabel.style.fontWeight = "800";
        rewardLabel.textContent = tUI("intro_end_reward_label") || "";
        root.appendChild(rewardLabel);

        const rw = document.createElement("div");
        rw.style.display = "grid";
        rw.style.gridTemplateColumns = "auto 1fr";
        rw.style.columnGap = "10px";
        rw.style.rowGap = "8px";
        rw.style.alignItems = "center";

        function addRewardRow(iconSrc, valueText){
          const ic = document.createElement("img");
          ic.src = iconSrc;
          ic.alt = "";
          ic.draggable = false;
          ic.style.width = "22px";
          ic.style.height = "22px";
          ic.style.objectFit = "contain";
          const tx = document.createElement("div");
          tx.style.fontWeight = "800";
          tx.textContent = valueText || "";
          rw.appendChild(ic);
          rw.appendChild(tx);
        }

        addRewardRow(TUTO_JETON_ICON_WEBP, tUI("intro_end_reward_jetons"));
        addRewardRow(VCOIN_ICON_WEBP, tUI("intro_end_reward_vcoins"));

        root.appendChild(rw);

        // Explanations with icons (no words “VCoins/Jetons”)
        const ex = document.createElement("div");
        ex.style.marginTop = "12px";
        ex.style.display = "grid";
        ex.style.gridTemplateColumns = "auto 1fr";
        ex.style.columnGap = "10px";
        ex.style.rowGap = "8px";
        ex.style.alignItems = "start";

        function addExplainRow(iconSrc, text){
          const ic = document.createElement("img");
          ic.src = iconSrc;
          ic.alt = "";
          ic.draggable = false;
          ic.style.width = "20px";
          ic.style.height = "20px";
          ic.style.objectFit = "contain";
          ic.style.marginTop = "2px";

          const tx = document.createElement("div");
          tx.textContent = text || "";

          ex.appendChild(ic);
          ex.appendChild(tx);
        }

        addExplainRow(VCOIN_ICON_WEBP, tUI("intro_end_vcoins_desc"));
        addExplainRow(TUTO_JETON_ICON_WEBP, tUI("intro_end_jetons_desc1"));
        addExplainRow(TUTO_JETON_ICON_WEBP, tUI("intro_end_jetons_desc2"));
        addExplainRow(TUTO_JETON_ICON_WEBP, tUI("intro_end_jetons_desc3"));

        root.appendChild(ex);

        const note1 = document.createElement("div");
        note1.style.marginTop = "12px";
        note1.textContent = tUI("intro_end_note1") || "";
        root.appendChild(note1);

        const note2 = document.createElement("div");
        note2.style.marginTop = "10px";
        note2.textContent = tUI("intro_end_note2") || "";
        root.appendChild(note2);
      },
      {
        single: true,
        backLabel: tUI("btn_close"),
        redirect: "index.html",
        onBack: () => {}
      }
    );
    return;
  }

  showEndModal(
    title,
    body,
    () => { history.back(); },
    () => { hardResetScenario(currentScenarioId); renderScene(); }
  );
}

/* =========================
   RENDER SCENE
========================= */
function renderScene(){
  renderTopbar();
  bindHintModal();
  updateHudJetons();

  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  const scene = getCurrentScene();
  if(!scene){
    st.scene = resolveStartScene(LOGIC);
    save();
    return renderScene();
  }

  // ✅ Détection auto des scènes end_good / end_bad / end_secret
  try{
    const m = /^end_(good|bad|secret)$/i.exec(String(scene.id || ""));
    if(m && !scene.ending) scene.ending = String(m[1]).toLowerCase();
  }catch(_){}

  if(scene.ending){
    handleEnding(scene.ending, scene);
    return;
  }

  const titleEl = $("sceneTitle");
  const bodyEl  = $("sceneBody");
  const imgEl   = $("scene_img") || $("sceneImg");
  const imgSourceEl = $("scene_img_source");
  const choicesEl = $("choices");
  const hintBtn = $("btnHint");

  if(titleEl) titleEl.textContent = tS(scene.title_key);
  if(bodyEl) bodyEl.textContent = tS(scene.body_key);

  if(imgEl){
    const img = resolveImageFile(LOGIC, scene.image_id);
    if(img && img.file){
      if(imgSourceEl) imgSourceEl.srcset = img.file;
      imgEl.src = img.file;
      imgEl.alt = img.alt || "";
      imgEl.classList.remove("hidden");
    } else {
      imgEl.removeAttribute("src");
      imgEl.alt = "";
      imgEl.classList.add("hidden");
    }
  }

  if(hintBtn){
    hintBtn.textContent = tUI("btn_hint");
    if(!hintBtn.__bound){
      hintBtn.__bound = true;
      hintBtn.addEventListener("click", () => {
        showHintModal(tUI("hint_title"), tUI("hint_desc"));
      });
    }
  }

  // choices
  if(choicesEl){
    while(choicesEl.firstChild) choicesEl.removeChild(choicesEl.firstChild);

    const choices = Array.isArray(scene.choices) ? scene.choices : [];
    for(const ch of choices){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";

      const label = tS(ch.label_key);
      btn.textContent = label;

      btn.onclick = async () => {
        // locked?
        const { missingAll, missingAny } = getMissingFlagsForChoice(ch);
        const locked = (missingAll.length > 0) || (missingAny.length > 0);
        if(locked && !OVERRIDE_FLAGS){
          showLockedChoiceModal(ch);
          return;
        }

        await executeChoice(ch);
      };

      choicesEl.appendChild(btn);
    }
  }

  bindJetonModal();
}

/* =========================
   IMAGE RESOLVE
========================= */
function resolveImageFile(logic, imageId){
  if(!logic || !logic.images || !imageId) return null;
  const v = logic.images[String(imageId)];
  if(v && v.file) return v;
  return null;
}

/* =========================
   BOOT
========================= */
async function boot(){
  // restore
  const saved = loadSave();

  if(saved && saved.lang){
    LANG = String(saved.lang || DEFAULT_LANG);
  }else{
    LANG = getDeviceLang();
  }

  await loadUI(LANG);
  await loadCatalog();

  // restore scenario state
  if(saved && saved.scenarioStates && typeof saved.scenarioStates === "object"){
    scenarioStates = saved.scenarioStates;
  }else{
    scenarioStates = {};
  }

  // scenario id from URL
  const params = new URLSearchParams(window.location.search || "");
  const scenarioId = params.get("scenario") || (saved ? saved.currentScenarioId : null);

  // fallback first scenario
  const defaultScenario = (CATALOG && Array.isArray(CATALOG.scenarios) && CATALOG.scenarios[0])
    ? String(CATALOG.scenarios[0].id)
    : null;

  const sid = scenarioId || defaultScenario;
  if(!sid){
    showHintModal(tUI("hint_title"), "No scenario");
    return;
  }

  await loadScenario(sid);

  // ensure state
  if(!scenarioStates[sid]){
    hardResetScenario(sid);
  }

  // resume modal if not at start
  const st = scenarioStates[sid];
  const start = resolveStartScene(LOGIC);
  if(st && st.scene && String(st.scene) !== String(start)){
    showResumeModal(
      () => { renderScene(); },
      () => { hardResetScenario(sid); renderScene(); }
    );
  }else{
    renderScene();
  }
}

document.addEventListener("DOMContentLoaded", boot);