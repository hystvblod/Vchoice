/* engine.js — VERSION COMPLETE À JOUR
   Base: ton fichier (lang device + menu + jetons + guide + end modal)
   + ✅ Intro tuto: popup FORCÉE “Débloquer avec 1 jeton” (jeton WEBP non clignotant à gauche, bouton centré avec gros cartouche qui clignote)
   + ✅ Bypass “pas assez” : on seed 1 jeton tuto (1 seule fois) puis on le dépense
   + ✅ Pas de fermeture possible tant que le tuto jeton n’est pas fait
   + ✅ FIN INTRO: pas de “Recommencer”, bouton “Fermer” -> index, rewards avec icônes WEBP (pas de texte “VCoins/Jetons”)
   + ✅ FIN INTRO: texte long (comme ta capture) MAIS sans mots “Jetons/VCoins” -> on affiche les WEBP
   + ✅ FIN INTRO: icônes plus grandes + “Récompense” (pas “Récompense du tuto”) + en-tête centré + suppression du “x1” en bas
   + ✅ iOS ONLY: mini popup “Entrer” au tout début du scénario -> autorise la musique, puis lance VCAudio.play()
   + ✅ FINS NORMALES: plus de popup fin ; image de fin conservée, texte final inline, bonus pub = +200 avec icône vcoin
   + ✅ 0 texte visible utilisateur en dur dans le JS : tout passe par i18n
*/

(function(){
"use strict";

/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const DEFAULT_LANG = "en";
const ENDING_AD_BONUS_AMOUNT = 200;

const INTERSTITIAL_EVERY_N_CHOICES = 12;
const INTERSTITIAL_COUNTER_PREFIX = "vchoice_inter_count_";

// Langues prévues
const SUPPORTED_LANGS = ["fr","en","de","es","pt","ptbr","it","ko","ja"];

// Onboarding / Intro tuto
const ONBOARD_DONE_KEY   = "vchoice_onboarding_done_v1";
const INTRO_REWARD_KEY   = "vchoice_intro_rewarded_v1";
const INTRO_SCENARIO_ID  = "intro_tuto";

// Intro tuto: popup jeton forcée
const INTRO_FORCED_JETON_USED_KEY   = "vchoice_intro_forced_jeton_used_v1";
const INTRO_FORCED_JETON_SEEDED_KEY = "vchoice_intro_forced_jeton_seeded_v1";

// Assets UI
const TUTO_JETON_ICON_WEBP = "assets/img/ui/jeton.webp";
const UI_VCOINS_ICON_WEBP  = "assets/img/ui/vcoin.webp";
const UI_JETON_ICON_WEBP   = "assets/img/ui/jeton.webp";

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

let GUIDE_STATE = {
  active: false,
  targetType: null,
  nextByScene: {},
  path: []
};

let OVERRIDE_FLAGS = false;

let ENDING_STATE = {
  key: "",
  reward: 300,
  adBonusClaimed: false,
  busy: false
};

/* =========================
   HELPERS
========================= */
function $(id){ return document.getElementById(id); }

const IMAGE_PRELOAD_CACHE = new Map();
let SCENE_IMAGE_REQ = 0;

async function fetchJSON(url){
  const r = await fetch(url, { cache: "default" });
  if(!r.ok) throw new Error(`fetch ${url} => ${r.status}`);
  return await r.json();
}

function showSceneLoading(show){
  const el = $("sceneLoadingOverlay");
  if(!el) return;
  el.classList.toggle("hidden", !show);
}

function preloadImage(url){
  if(!url) return Promise.resolve(null);

  const cached = IMAGE_PRELOAD_CACHE.get(url);
  if(cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(url);
    img.onerror = () => {
      IMAGE_PRELOAD_CACHE.delete(url);
      reject(new Error(`image preload failed: ${url}`));
    };

    img.src = url;
  });

  IMAGE_PRELOAD_CACHE.set(url, promise);
  return promise;
}

function setSceneImage(file, alt = ""){
  const imgEl = $("scene_img") || $("sceneImg");
  const imgSourceEl = $("scene_img_source");
  const pictureEl = $("scene_picture");

  if(!imgEl) return;

  const reqId = ++SCENE_IMAGE_REQ;

  imgEl.onload = null;
  imgEl.onerror = null;

  if(!file){
    if(imgSourceEl) imgSourceEl.removeAttribute("srcset");
    imgEl.removeAttribute("src");
    imgEl.alt = "";
    imgEl.classList.remove("is-ready");
    imgEl.classList.add("hidden");
    if(pictureEl) pictureEl.classList.add("hidden");
    showSceneLoading(false);
    return;
  }

  showSceneLoading(true);

  imgEl.classList.remove("is-ready");
  imgEl.classList.add("hidden");
  if(pictureEl) pictureEl.classList.remove("hidden");

  if(imgSourceEl) imgSourceEl.srcset = file;
  imgEl.alt = alt || "";

  imgEl.onload = () => {
    if(reqId !== SCENE_IMAGE_REQ) return;

    imgEl.classList.remove("hidden");

    requestAnimationFrame(() => {
      if(reqId !== SCENE_IMAGE_REQ) return;
      imgEl.classList.add("is-ready");
      showSceneLoading(false);
    });
  };

  imgEl.onerror = () => {
    if(reqId !== SCENE_IMAGE_REQ) return;

    console.warn("[scene image load failed]", file);

    if(imgSourceEl) imgSourceEl.removeAttribute("srcset");
    imgEl.removeAttribute("src");
    imgEl.alt = "";
    imgEl.classList.remove("is-ready");
    imgEl.classList.add("hidden");
    if(pictureEl) pictureEl.classList.add("hidden");
    showSceneLoading(false);
  };

  imgEl.src = file;

  if(imgEl.complete && imgEl.naturalWidth > 0){
    imgEl.onload();
  }

  preloadImage(file).catch(() => {});
}

function preloadNextSceneImages(sceneId){
  try{
    const scene = resolveSceneObject(LOGIC, sceneId);
    const choices = Array.isArray(scene?.choices) ? scene.choices : [];

    for(const choice of choices){
      const nextId = String(choice?.next || "").trim();
      if(!nextId) continue;

      const nextScene = resolveSceneObject(LOGIC, nextId);
      if(!nextScene) continue;

      const img = resolveImageFile(LOGIC, nextScene.image_id || nextId);
      if(img?.file) preloadImage(img.file).catch(() => {});
    }
  }catch(err){
    console.warn("[preloadNextSceneImages]", err);
  }
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

function format(str, params = {}){
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

function safeFirstSceneId(logic){
  const scenes = logic && logic.scenes;
  if(!scenes || typeof scenes !== "object") return null;
  const keys = Object.keys(scenes);
  return keys.length ? keys[0] : null;
}

function resolveStartScene(logic){
  const root = logic?.start_scene;
  const meta = logic?.meta?.start_scene;
  return root || meta || safeFirstSceneId(logic);
}

function resolveSceneObject(logic, sceneId){
  if(!logic?.scenes || !sceneId) return null;
  const base = logic.scenes[sceneId];
  if(!base) return null;
  return { id: sceneId, ...base };
}

function resolveImageFile(logic, imageId){
  if(!imageId) return null;
  const img = logic?.images?.[imageId];
  if(!img) return null;
  if(typeof img === "string") return { file: img, alt: "" };
  if(typeof img === "object" && img.file) return { file: img.file, alt: img.alt || "" };
  return null;
}

function sanitizeJetonLabel(s){
  if(s == null) return "";
  return String(s)
    .replace(/_/g, " ")
    .replace(/\bjetons?\b/gi, "")
    .replace(/\s*[—–-]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clearNode(el){
  if(!el) return;
  while(el.firstChild) el.removeChild(el.firstChild);
}

function setLabelWithTrailingIcon(el, labelText, iconSrc){
  if(!el) return;
  clearNode(el);

  const wrap = document.createElement("span");
  wrap.className = "vc-choice-inline";

  const text = document.createElement("span");
  text.textContent = sanitizeJetonLabel(labelText);

  const icon = document.createElement("img");
  icon.src = iconSrc;
  icon.alt = "";
  icon.draggable = false;

  wrap.appendChild(text);
  wrap.appendChild(icon);
  el.appendChild(wrap);
}

function tUI(key, params){
  const v = deepGet(UI, `ui.${key}`) ?? `[ui.${key}]`;
  return params ? format(v, params) : v;
}

function tS(key, params){
  let v;

  if(TEXT_STRINGS && Object.prototype.hasOwnProperty.call(TEXT_STRINGS, key)){
    v = TEXT_STRINGS[key];
  } else {
    v = deepGet(TEXT, key);
  }

  if(v == null) v = `[${key}]`;
  return params ? format(v, params) : v;
}

function getScenarioInfo(scenarioId){
  const info = deepGet(UI, `scenario_info.${scenarioId}`) || {};
  const title = (typeof info.title === "string") ? info.title : tUI("hint_title");
  const body  = (typeof info.body  === "string") ? info.body  : "";
  if(!body && !title) return null;
  return { title, body };
}

function getEndingLabel(type){
  const t = String(type || "").toLowerCase();
  if(t === "good") return tUI("ending_label_good");
  if(t === "bad") return tUI("ending_label_bad");
  if(t === "secret") return tUI("ending_label_secret");
  return tUI("end_title");
}

function getEndingRewardAmount(payload){
  const candidates = [
    payload?.reward_vcoins,
    payload?.reward,
    payload?.granted_vcoins,
    payload?.delta_vcoins,
    payload?.vcoins_reward
  ];

  for(const raw of candidates){
    const n = Number(raw);
    if(Number.isFinite(n) && n > 0) return n;
  }

  return 300;
}

function setChoiceButtonContentWithIcon(btn, iconSrc, labelText){
  clearNode(btn);

  const wrap = document.createElement("span");
  wrap.className = "vc-choice-inline";

  const icon = document.createElement("img");
  icon.src = iconSrc;
  icon.alt = "";
  icon.draggable = false;

  const text = document.createElement("span");
  text.textContent = labelText;

  wrap.appendChild(icon);
  wrap.appendChild(text);
  btn.appendChild(wrap);
}

function getInterstitialCounterKey(scenarioId){
  const sid = String(scenarioId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${INTERSTITIAL_COUNTER_PREFIX}${sid}`;
}

function readScenarioInterstitialCount(scenarioId){
  try{
    const key = getInterstitialCounterKey(scenarioId);
    const v = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }catch(_){
    return 0;
  }
}

function writeScenarioInterstitialCount(scenarioId, value){
  try{
    const key = getInterstitialCounterKey(scenarioId);
    const n = Math.max(0, Number(value || 0) || 0);
    localStorage.setItem(key, String(n));
  }catch(_){}
}

async function maybeShowInterstitialAfterChoice(){
  const scenarioId = String(currentScenarioId || "").trim();
  if(!scenarioId) return false;

  if(scenarioId === INTRO_SCENARIO_ID) return false;

  let count = readScenarioInterstitialCount(scenarioId);
  count += 1;

  if(count < INTERSTITIAL_EVERY_N_CHOICES){
    writeScenarioInterstitialCount(scenarioId, count);
    return false;
  }

  writeScenarioInterstitialCount(scenarioId, 0);

  try{
    if(!window.VAds || typeof window.VAds.showInterstitial !== "function"){
      return false;
    }

    if(typeof window.VAds.isInterstitialAllowed === "function" && !window.VAds.isInterstitialAllowed()){
      return false;
    }

    const res = await window.VAds.showInterstitial();
    return !!res?.ok;
  }catch(_){
    return false;
  }
}

/* =========================
   iOS AUDIO GATE
========================= */
let _iosGateDone = false;

function isIOS(){
  try{
    if (window.Capacitor && typeof window.Capacitor.getPlatform === "function"){
      return window.Capacitor.getPlatform() === "ios";
    }
  }catch(_){}

  const ua = String(navigator.userAgent || "");
  const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus = ua.includes("Macintosh") && ("ontouchend" in document);
  return isAppleMobile || isIPadOS13Plus;
}

function showIOSAudioGate(){
  return new Promise((resolve) => {
    if(_iosGateDone) return resolve();

    try{
      if(window.VCAudio && typeof window.VCAudio.isEnabled === "function"){
        if(!window.VCAudio.isEnabled()) return resolve();
      }
    }catch(_){}

    const gate = $("iosGate");
    const title = $("iosGateTitle");
    const body = $("iosGateBody");
    const btn = $("iosGateBtn");

    if(!gate || !title || !body || !btn){
      return resolve();
    }

    title.textContent = tUI("ios_enter_title");
    body.textContent = tUI("ios_enter_body");
    btn.textContent = tUI("ios_enter_btn");

    btn.onclick = async () => {
      if(_iosGateDone) return;

      try{
        if(window.VCAudio && typeof window.VCAudio.unlock === "function"){
          await window.VCAudio.unlock();
        }
        if(window.VCAudio && typeof window.VCAudio.play === "function"){
          window.VCAudio.play();
        }
      }catch(_){}

      _iosGateDone = true;
      gate.classList.add("hidden");
      gate.setAttribute("aria-hidden","true");
      resolve();
    };

    gate.classList.remove("hidden");
    gate.setAttribute("aria-hidden","false");

    try{ btn.focus(); }catch(_){}
  });
}

/* =========================
   LANGUAGE RESOLUTION
========================= */
function normalizeLang(raw){
  if(!raw) return null;
  const s = String(raw).trim().toLowerCase();

  const map = {
    "pt-br": "ptbr",
    "pt_br": "ptbr",
    "pt-pt": "pt",
    "pt_pt": "pt",
    "jp": "ja",
    "ja-jp": "ja",
    "kr": "ko",
    "ko-kr": "ko"
  };
  if(map[s]) return map[s];

  const base = s.split(/[-_]/)[0];
  if(base === "pt" && (s.includes("br") || s.includes("ptbr"))) return "ptbr";
  if(base === "ja") return "ja";
  if(base === "ko") return "ko";
  return base || null;
}

function detectDeviceLang(){
  const list = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];

  for(const candidate of list){
    const base = normalizeLang(candidate);
    if(base && SUPPORTED_LANGS.includes(base)) return base;
  }
  return DEFAULT_LANG;
}

function getStoredLang(){
  try{
    const vc = normalizeLang(localStorage.getItem("vchoice_lang"));
    if(vc && SUPPORTED_LANGS.includes(vc)) return vc;
  }catch(_){}
  try{
    const gl = normalizeLang(localStorage.getItem("VREALMS_LANG"));
    if(gl && SUPPORTED_LANGS.includes(gl)) return gl;
  }catch(_){}
  return null;
}

async function setLang(newLang, opts = {}){
  const {
    persistLocal = true,
    persistRemote = false,
    rerender = true
  } = opts;

  const base = normalizeLang(newLang);
  const safe = (base && SUPPORTED_LANGS.includes(base)) ? base : DEFAULT_LANG;

  if(LANG === safe) return;

  LANG = safe;

  await reloadUI();

  if(persistLocal) save();

  if(persistRemote && window.VUserData && typeof window.VUserData.setLang === "function"){
    try{ await window.VUserData.setLang(LANG); }catch(e){}
  }

  if(hasGamePage() && currentScenarioId){
    await openScenario(currentScenarioId, { skipResumePrompt:true });
  }

  if(rerender){
    if(hasMenuPage()) await renderMenu();
    if(hasGamePage()) renderScene();
    renderTopbar();
  }
}

/* =========================
   SAVE/LOAD
========================= */
function load(){
  try{
    const stored = getStoredLang();
    if(stored) LANG = stored;

    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);

    if(data && typeof data === "object"){
      scenarioStates = data.scenarioStates || {};
      const savedLang = normalizeLang(data.lang);
      if(savedLang && SUPPORTED_LANGS.includes(savedLang)) LANG = savedLang;
    }
  }catch(e){
    console.warn("load failed", e);
  }
}

function save(){
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      lang: LANG,
      scenarioStates
    }));

    try{ localStorage.setItem("vchoice_lang", LANG); }catch(e){}
    try{ localStorage.setItem("VREALMS_LANG", LANG); }catch(e){}
  }catch(e){
    console.warn("save failed", e);
  }
}

function hasLocalRun(scenarioId){
  const st = scenarioStates?.[scenarioId];
  if(!st || typeof st !== "object") return false;
  const start = resolveStartScene(LOGIC);
  const cur = String(st.scene || "");
  const hasFlags = st.flags && typeof st.flags === "object" && Object.keys(st.flags).length > 0;
  const hasClues = Array.isArray(st.clues) && st.clues.length > 0;
  return (start && cur && cur !== start) || hasFlags || hasClues;
}

function hardResetScenario(scenarioId){
  if(!scenarioId) return;
  const start = resolveStartScene(LOGIC);
  scenarioStates[scenarioId] = {
    scene: start,
    flags: {},
    clues: [],
    history: []
  };
  save();
}

/* =========================
   INIT
========================= */
function hasMenuPage(){ return !!$("menuGrid"); }
function hasGamePage(){ return !!$("sceneTitle"); }

async function reloadUI(){
  try{ UI = await fetchJSON(PATHS.ui(LANG)); }
  catch(e){
    LANG = DEFAULT_LANG;
    UI = await fetchJSON(PATHS.ui(LANG));
  }

  const sel = $("langSelect");
  if(sel) sel.value = LANG;

  applyStaticI18n();
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog);
}

/* =========================
   STATIC i18n
========================= */
function applyStaticI18n(){
  const btnJeton = $("btnJetonBack");
  if(btnJeton) btnJeton.title = tUI("jeton_title");

  const jmTitle = $("jetonModalTitle");
  if(jmTitle) jmTitle.textContent = tUI("jeton_title");

  const bal = $("jetonBalanceLabel");
  if(bal) bal.textContent = tUI("jeton_balance_label");

  const bBack = $("btnJetonBackModal");
  if(bBack) setLabelWithTrailingIcon(bBack, tUI("jeton_back_btn"), UI_JETON_ICON_WEBP);

  const guideLabel = $("jetonGuideLabel");
  if(guideLabel) setLabelWithTrailingIcon(guideLabel, tUI("jeton_guide_btn"), UI_JETON_ICON_WEBP);

  const bGood = $("btnJetonGuideGood");
  if(bGood) bGood.textContent = sanitizeJetonLabel(tUI("jeton_guide_good"));

  const bBad = $("btnJetonGuideBad");
  if(bBad) bBad.textContent = sanitizeJetonLabel(tUI("jeton_guide_bad"));

  const bSecret = $("btnJetonGuideSecret");
  if(bSecret) bSecret.textContent = sanitizeJetonLabel(tUI("jeton_guide_secret"));

  const bStop = $("btnJetonGuideStop");
  if(bStop) bStop.textContent = sanitizeJetonLabel(tUI("jeton_guide_stop"));

  const hintClose = $("hintClose");
  if(hintClose){
    hintClose.setAttribute("aria-label", tUI("hint_close_aria"));
    hintClose.textContent = tUI("symbol_close");
    hintClose.style.display = "";
  }

  const resumeClose = $("resumeClose");
  if(resumeClose){
    resumeClose.setAttribute("aria-label", tUI("hint_close_aria"));
    resumeClose.textContent = tUI("symbol_close");
  }

  const endClose = $("endClose");
  if(endClose){
    endClose.setAttribute("aria-label", tUI("hint_close_aria"));
    endClose.textContent = tUI("symbol_close");
  }

  const jetonClose = $("jetonClose");
  if(jetonClose){
    jetonClose.setAttribute("aria-label", tUI("hint_close_aria"));
    jetonClose.textContent = tUI("symbol_close");
  }
}

/* =========================
   HUD JETONS
========================= */
function updateHudJetons(){
  const el = $("hudJetonCount");
  if(!el) return;

  let jetons = 0;
  if(window.VUserData && typeof window.VUserData.getJetons === "function"){
    try{ jetons = Number(window.VUserData.getJetons() || 0); }catch(e){}
  }
  el.textContent = String(jetons);
}

function updateJetonModalCount(){
  const el = $("jetonModalCount");
  if(!el) return;
  let jetons = 0;
  if(window.VUserData && typeof window.VUserData.getJetons === "function"){
    try{ jetons = Number(window.VUserData.getJetons() || 0); }catch(e){}
  }
  el.textContent = String(jetons);
}

function updateJetonGuideUI(){
  const stopBtn = $("btnJetonGuideStop");
  if(stopBtn){
    stopBtn.style.display = (GUIDE_STATE && GUIDE_STATE.active) ? "" : "none";
  }
}

function showJetonModal(){
  const modal = $("jetonModal");
  if(!modal) return;
  updateJetonModalCount();
  updateJetonGuideUI();

  const msg = $("jetonModalMsg");
  if(msg) msg.textContent = "";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

function hideJetonModal(){
  const modal = $("jetonModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

function bindJetonHud(){
  const btn = $("btnJetonBack");
  if(btn){
    btn.onclick = () => { showJetonModal(); };
  }

  const bd = $("jetonBackdrop");
  if(bd) bd.addEventListener("click", hideJetonModal);
  const close = $("jetonClose");
  if(close) close.addEventListener("click", hideJetonModal);

  const backBtn = $("btnJetonBackModal");
  if(backBtn){
    backBtn.addEventListener("click", async () => {
      await goBackWithJeton();
      hideJetonModal();
    });
  }

  const targetsBox = $("jetonGuideTargets");
  if(targetsBox){
    targetsBox.addEventListener("click", async (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest("button[data-target]") : null;
      if(!b) return;

      const targetType = b.getAttribute("data-target");
      const msg = $("jetonModalMsg");

      try{
        if(msg) msg.textContent = "";

        const st = scenarioStates[currentScenarioId];
        const curId = st?.scene;
        const plan = computeGuidePlan(curId, targetType);

        if(!plan || !plan.nextByScene || !Object.keys(plan.nextByScene).length){
          if(msg) msg.textContent = tUI("jeton_guide_no_path");
          return;
        }

        if(GUIDE_STATE.active){
          GUIDE_STATE.active = true;
          GUIDE_STATE.targetType = targetType;
          GUIDE_STATE.nextByScene = plan.nextByScene;
          GUIDE_STATE.path = plan.path || [];
          OVERRIDE_FLAGS = true;

          updateJetonGuideUI();
          hideJetonModal();
          renderScene();
          return;
        }

        const res = await spendJetons(3);
        if(!res?.ok){
          if(msg) msg.textContent = tUI("jeton_not_enough");
          updateHudJetons();
          updateJetonModalCount();
          return;
        }

        GUIDE_STATE.active = true;
        GUIDE_STATE.targetType = targetType;
        GUIDE_STATE.nextByScene = plan.nextByScene;
        GUIDE_STATE.path = plan.path || [];

        OVERRIDE_FLAGS = true;

        updateHudJetons();
        updateJetonModalCount();
        updateJetonGuideUI();
        hideJetonModal();
        renderScene();
      }catch(e){
        if(msg) msg.textContent = tUI("jeton_guide_error");
      }
    });
  }

  const stopBtn = $("btnJetonGuideStop");
  if(stopBtn){
    stopBtn.addEventListener("click", () => {
      GUIDE_STATE.active = false;
      GUIDE_STATE.targetType = null;
      GUIDE_STATE.nextByScene = {};
      GUIDE_STATE.path = [];
      OVERRIDE_FLAGS = false;

      updateJetonGuideUI();
      renderScene();

      const msg = $("jetonModalMsg");
      if(msg) msg.textContent = tUI("jeton_guide_stopped");
    });
  }

  window.addEventListener("vr:profile", () => { updateHudJetons(); updateJetonModalCount(); });
  window.addEventListener("vc:profile", () => { updateHudJetons(); updateJetonModalCount(); });

  updateHudJetons();
}

async function boot(){
  load();

  try{
    if(window.VUserData && typeof window.VUserData.init === "function"){
      await window.VUserData.init();
    }
  }catch(_){}

  let initialLang = LANG;

  const stored = getStoredLang();
  if(stored) initialLang = stored;

  if(window.VUserData && typeof window.VUserData.getLang === "function"){
    try{
      const l = normalizeLang(window.VUserData.getLang());
      if(l && SUPPORTED_LANGS.includes(l)) initialLang = l;
    }catch(e){}
  }

  if(!initialLang) initialLang = detectDeviceLang();

  LANG = initialLang;

  await reloadUI();
  await loadCatalog();

  bindTopbar();
  bindJetonHud();

  if(hasMenuPage()){
    await renderMenu();
  }

  if(hasGamePage()){
    const u = new URL(location.href);
    const scenarioId = u.searchParams.get("scenario");
    if(scenarioId){
      await openScenario(scenarioId, { skipResumePrompt:false });
    }
  }
}

function bindTopbar(){
  const sel = $("langSelect");
  if(sel){
    sel.addEventListener("change", async (e) => {
      await setLang(e.target.value, { persistLocal:true, persistRemote:true, rerender:true });
    });
  }
}

/* =========================
   MENU
========================= */
async function loadScenarioMeta(scenarioId){
  try{
    const txt = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
    return (txt && typeof txt === "object" && txt.meta) ? txt.meta : {};
  }catch(_){
    try{
      const txt = await fetchJSON(PATHS.scenarioText(scenarioId, DEFAULT_LANG));
      return (txt && typeof txt === "object" && txt.meta) ? txt.meta : {};
    }catch(__){
      return {};
    }
  }
}

function goToScenario(scenarioId){
  location.href = `game.html?scenario=${encodeURIComponent(scenarioId)}`;
}

async function renderMenu(){
  renderTopbar();

  const grid = $("menuGrid");
  if(!grid) return;

  grid.innerHTML = "";

  const list = (CATALOG && Array.isArray(CATALOG.scenarios)) ? CATALOG.scenarios : [];

  for(const entry of list){
    const scenarioId = entry.id;

    const meta = entry.meta || await loadScenarioMeta(scenarioId);
    const titleText = meta.title || scenarioId;
    const subText = meta.tagline || "";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "menu_card";
    card.onclick = () => goToScenario(scenarioId);

    const cover = document.createElement("div");
    cover.className = "menu_cover";
    cover.style.backgroundImage = `url('${entry.cover}')`;

    const metaBox = document.createElement("div");
    metaBox.className = "menu_meta";

    const title = document.createElement("div");
    title.className = "menu_title";
    title.textContent = titleText;

    const sub = document.createElement("div");
    sub.className = "menu_sub";
    sub.textContent = subText;

    card.appendChild(cover);
    metaBox.appendChild(title);
    metaBox.appendChild(sub);
    card.appendChild(metaBox);

    const info = getScenarioInfo(scenarioId);
    if(info && info.body){
      const help = document.createElement("button");
      help.type = "button";
      help.className = "menu_help";
      help.textContent = "?";
      help.title = tUI("hint_title");
      help.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showHintModal(info.title || tUI("hint_title"), info.body || "");
      });
      card.appendChild(help);
    }

    grid.appendChild(card);
  }
}

function renderTopbar(){
  const t1 = $("ui_app_title");
  if(t1) t1.textContent = tUI("app_title");
  const t2 = $("ui_app_subtitle");
  if(t2) t2.textContent = tUI("app_subtitle");

  const i1 = $("ui_index_title");
  if(i1) i1.textContent = tUI("index_title");
  const i2 = $("ui_index_subtitle");
  if(i2) i2.textContent = tUI("index_subtitle");
}

/* =========================
   GAME / RESUME / END MODAL
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

function _setEndBodyText(text){
  const b = $("endBody");
  if(!b) return;
  b.textContent = text || "";
}

function _setEndBodyRich(buildFn){
  const b = $("endBody");
  if(!b) return;

  try{
    while(b.firstChild) b.removeChild(b.firstChild);
  }catch(_){
    b.textContent = "";
  }

  try{ buildFn?.(b); }catch(_){}
}

function showEndModal(title, bodyOrBuilder, onBack, onReplay){
  ensureEndModal();

  const modal = $("endModal");
  const t = $("endTitle");
  const btnBack = $("btnEndBack");
  const btnReplay = $("btnEndReplay");
  if(!modal || !t || !btnBack || !btnReplay) return;

  t.textContent = title || tUI("end_title");

  btnBack.textContent = tUI("btn_back");
  btnReplay.textContent = tUI("btn_restart");
  btnReplay.style.display = "";
  btnBack.onclick = () => { hideEndModal(); onBack && onBack(); };
  btnReplay.onclick = () => { hideEndModal(); onReplay && onReplay(); };

  if(typeof bodyOrBuilder === "function"){
    _setEndBodyRich(bodyOrBuilder);
  } else {
    _setEndBodyText(bodyOrBuilder || "");
  }

  if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
    btnReplay.style.display = "none";
    btnBack.textContent = tUI("btn_close");
    btnBack.onclick = () => {
      hideEndModal();
      location.href = "index.html";
    };
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

function hideEndModal(){
  const modal = $("endModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
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

  try{
    if(String(modal.dataset.forceLock || "") === "1") return;
  }catch(_){}

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");

  const close = $("hintClose");
  if(close) close.style.display = "";
}

function showHintModalWithActionsRich(title, buildBodyFn, buildActionsFn){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

  t.textContent = title || tUI("hint_title");

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
  wrap.className = "modal__actions modal__actions--center";

  try{ buildActionsFn?.(wrap); }catch(_){}

  b.parentNode.appendChild(wrap);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

/* =========================
   FLAGS / GUIDE
========================= */
function isChoiceAvailable(choice){
  if(OVERRIDE_FLAGS) return true;

  const flags = scenarioStates[currentScenarioId]?.flags || {};
  const all = Array.isArray(choice.requires_all_flags) ? choice.requires_all_flags : null;
  const any = Array.isArray(choice.requires_any_flags) ? choice.requires_any_flags : null;

  if(all && all.length){
    for(const f of all){
      if(!flags[f]) return false;
    }
  }
  if(any && any.length){
    let ok = false;
    for(const f of any){
      if(flags[f]){ ok = true; break; }
    }
    if(!ok) return false;
  }
  return true;
}

function _findEndingTargets(logic, type){
  const scenes = logic?.scenes || {};
  const direct = `end_${type}`;
  if (Object.prototype.hasOwnProperty.call(scenes, direct)) return [direct];

  const keys = Object.keys(scenes);
  const out = [];
  const needle = String(type || "").toLowerCase();

  for(const k of keys){
    const lk = k.toLowerCase();
    if(lk.includes("end_" + needle) || lk.includes("fin_" + needle) || lk.includes("ending_" + needle)){
      out.push(k);
    }
  }

  if(!out.length){
    for(const k of keys){
      const sc = scenes[k];
      const ch = Array.isArray(sc?.choices) ? sc.choices : [];
      if(ch.length === 0) out.push(k);
    }
  }
  return out;
}

function computeGuidePlan(fromSceneId, targetType){
  if(!LOGIC?.scenes || !fromSceneId) return null;

  const targets = new Set(_findEndingTargets(LOGIC, targetType));
  if(!targets.size) return null;

  const q = [String(fromSceneId)];
  const visited = new Set(q);
  const prev = {};
  let found = null;

  while(q.length){
    const cur = q.shift();
    if(targets.has(cur)){ found = cur; break; }

    const sc = resolveSceneObject(LOGIC, cur);
    const choices = Array.isArray(sc?.choices) ? sc.choices : [];

    for(const ch of choices){
      if(!ch?.next) continue;
      const nxt = String(ch.next);
      if(visited.has(nxt)) continue;
      if(!LOGIC.scenes[nxt]) continue;

      visited.add(nxt);
      prev[nxt] = cur;
      q.push(nxt);
    }
  }

  if(!found) return null;

  const path = [];
  let cur = found;
  while(cur){
    path.push(cur);
    if(cur === String(fromSceneId)) break;
    cur = prev[cur];
  }
  path.reverse();

  if(path.length < 2) return { path, nextByScene: {} };

  const nextByScene = {};
  for(let i=0;i<path.length-1;i++){
    nextByScene[path[i]] = path[i+1];
  }

  return { path, nextByScene };
}

/* =========================
   SCENARIO OPEN
========================= */
async function openScenario(scenarioId, opts = {}){
  const { skipResumePrompt = false } = opts;

  currentScenarioId = scenarioId;

  const logicPromise = fetchJSON(PATHS.scenarioLogic(scenarioId));
  const textPromise = fetchJSON(PATHS.scenarioText(scenarioId, LANG))
    .catch(() => fetchJSON(PATHS.scenarioText(scenarioId, DEFAULT_LANG)));

  LOGIC = await logicPromise;
  try{
    const uni = (LOGIC?.meta?.universe || scenarioId || "").trim();
    if (uni && window.VCAudio?.setUniverse) window.VCAudio.setUniverse(uni);
  } catch(_){}

  TEXT = await textPromise;

  TEXT_STRINGS = (TEXT && typeof TEXT === "object" && TEXT.strings && typeof TEXT.strings === "object")
    ? TEXT.strings
    : null;

  if(!scenarioStates[scenarioId]){
    const start = resolveStartScene(LOGIC);
    scenarioStates[scenarioId] = {
      scene: start,
      flags: {},
      clues: [],
      history: []
    };
    save();
  } else {
    if(!scenarioStates[scenarioId].scene){
      scenarioStates[scenarioId].scene = resolveStartScene(LOGIC);
      save();
    }
  }

  scenarioStates[scenarioId].flags ??= {};
  scenarioStates[scenarioId].clues ??= [];
  scenarioStates[scenarioId].history ??= [];

  if (isIOS() && !_iosGateDone && window.VCAudio) {
    await showIOSAudioGate();
  }

  if(!skipResumePrompt && hasLocalRun(scenarioId)){
    showResumeModal(
      () => { renderScene(); },
      () => { hardResetScenario(scenarioId); renderScene(); }
    );
  } else {
    renderScene();
  }
}

function getCurrentScene(){
  const st = scenarioStates[currentScenarioId];
  if(!st) return null;
  return resolveSceneObject(LOGIC, st.scene);
}

function addClue(clueId){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  if(!st.clues.includes(clueId)) st.clues.push(clueId);
}

function setFlag(flag){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  st.flags[flag] = true;
}

function clearFlag(flag){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;
  delete st.flags[flag];
}

/* =========================
   JETONS
========================= */
function getMissingFlagsForChoice(choice){
  const flags = scenarioStates[currentScenarioId]?.flags || {};
  const all = Array.isArray(choice.requires_all_flags) ? choice.requires_all_flags : [];
  const any = Array.isArray(choice.requires_any_flags) ? choice.requires_any_flags : [];

  const missingAll = all.filter(f => !flags[f]);

  let missingAny = [];
  if(any.length){
    const hasOne = any.some(f => !!flags[f]);
    if(!hasOne) missingAny = any.slice(0);
  }

  return { missingAll, missingAny };
}

function grantMissingFlags(choice, missingAll, missingAny){
  if(Array.isArray(missingAll) && missingAll.length){
    for(const f of missingAll) setFlag(f);
    return { granted: missingAll.slice() };
  }

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
    await maybeShowInterstitialAfterChoice();
    await handleEnding(ch.ending, null);
    return;
  }

  if(ch.next){
    st.history ??= [];
    st.history.push(st.scene);

    st.scene = ch.next;
    save();

    await maybeShowInterstitialAfterChoice();

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

function showIntroForcedJetonModal(choice, missingAll, missingAny){
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

  const title   = tUI("intro_forced_jeton_title");
  const body    = tUI("intro_forced_jeton_body", { item: itemTitle });
  const note    = tUI("intro_forced_jeton_note");
  const cta     = tUI("intro_forced_jeton_cta");
  const errMsg  = tUI("intro_forced_jeton_error");
  const okMsg   = tUI("intro_forced_jeton_ok", { item: itemTitle });

  showHintModalWithActionsRich(
    title,
    (root) => {
      const row = document.createElement("div");
      row.className = "vc-tuto-row";

      const img = document.createElement("img");
      img.src = TUTO_JETON_ICON_WEBP;
      img.alt = "";
      img.draggable = false;
      img.className = "vc-tuto-side";
      row.appendChild(img);

      const col = document.createElement("div");
      col.className = "vc-tuto-col";

      const p1 = document.createElement("div");
      p1.className = "vc-tuto-body";
      p1.textContent = body;
      col.appendChild(p1);

      const p2 = document.createElement("div");
      p2.className = "vc-tuto-note";
      p2.textContent = note;
      col.appendChild(p2);

      row.appendChild(col);
      root.appendChild(row);

      const msg = document.createElement("div");
      msg.id = "vcTutoMsg";
      msg.className = "vc-tuto-msg";
      msg.textContent = "";
      root.appendChild(msg);
    },
    (actionsWrap) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";

      const inner = document.createElement("span");
      inner.className = "vc-tuto-btn vc-jeton-cta";

      const tx = document.createElement("span");
      tx.textContent = cta;
      inner.appendChild(tx);

      const ic = document.createElement("img");
      ic.src = TUTO_JETON_ICON_WEBP;
      ic.alt = "";
      ic.draggable = false;
      ic.className = "vc-jeton-cta-big";
      inner.appendChild(ic);

      const q = document.createElement("b");
      q.textContent = tUI("shop_reward_jeton_x1");
      inner.appendChild(q);

      btn.appendChild(inner);

      btn.onclick = async () => {
        const msg = $("vcTutoMsg");

        try{
          await seedIntroTutoJetonIfNeeded();

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

          grantMissingFlags(choice, missingAll, missingAny);
          save();

          try{ localStorage.setItem(INTRO_FORCED_JETON_USED_KEY, "1"); }catch(_){}

          updateHudJetons();
          updateJetonModalCount();

          const m = $("hintModal");
          if(m){
            try{ delete m.dataset.forceLock; }catch(_){}
          }
          const c = $("hintClose");
          if(c) c.style.display = "";

          if(msg) msg.textContent = okMsg;

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

  seedIntroTutoJetonIfNeeded();
}

/* =========================
   LOCKED CHOICE MODAL
========================= */
function showLockedChoiceModal(choice){
  const { missingAll, missingAny } = getMissingFlagsForChoice(choice);

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

  actions.push({
    label: tUI("locked_unlock_jeton"),
    className: "btn",
    onClick: async () => {
      try{
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

        grantMissingFlags(choice, missingAll, missingAny);
        save();
        updateHudJetons();
        updateJetonModalCount();

        hideHintModal();
        await executeChoice(choice);
      }catch(e){
        updateHudJetons();
        updateJetonModalCount();
        showHintModal(tUI("locked_title"), tUI("locked_unlock_error"));
      }
    }
  });

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

        grantMissingFlags(choice, missingAll, missingAny);
        save();

        hideHintModal();
        await executeChoice(choice);
      }catch(e){
        showHintModal(tUI("locked_title"), tUI("locked_unlock_ad_fail"));
      }
    }
  });

  actions.push({
    label: tUI("locked_close"),
    className: "btn btn--ghost",
    onClick: () => hideHintModal()
  });

  const modalTitle = tUI("locked_title");
  const modalBody = Array.isArray(lines) ? lines.join("\n") : String(lines || "");

  showHintModalWithActionsRich(
    modalTitle,
    (root) => {
      const p = document.createElement("div");
      p.className = "vc-modal-prewrap";
      p.textContent = modalBody;
      root.appendChild(p);

      const msg = document.createElement("div");
      msg.id = "vcLockedMsg";
      msg.className = "vc-lock-msg";
      msg.textContent = "";
      root.appendChild(msg);
    },
    (actionsWrap) => {
      for(const a of actions){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = a.className || "btn";
        btn.textContent = a.label || tUI("btn_ok");
        btn.onclick = async () => { await a.onClick?.(); };
        actionsWrap.appendChild(btn);
      }
    }
  );
}

/* =========================
   ENDING
========================= */
async function handleEnding(type, endScene){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

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

  if(String(currentScenarioId || "") === INTRO_SCENARIO_ID){
    try{
      if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
        await window.VUserData.completeScenario(currentScenarioId, endingType);
      }
    }catch(e){}

    let introRewardJetons = 0;
    let introRewardVCoins = 0;

    try{
      let rewarded = false;
      try{ rewarded = (localStorage.getItem(INTRO_REWARD_KEY) === "1"); }catch(_){}
      if(!rewarded){
        introRewardJetons = 2;
        introRewardVCoins = 100;

        try{
          if(window.VUserData && typeof window.VUserData.addJetons === "function"){
            await window.VUserData.addJetons(introRewardJetons);
          }
        }catch(_){}
        try{
          if(window.VUserData && typeof window.VUserData.addVCoins === "function"){
            await window.VUserData.addVCoins(introRewardVCoins);
          }
        }catch(_){}

        try{ localStorage.setItem(INTRO_REWARD_KEY, "1"); }catch(_){}

        updateHudJetons();
        updateJetonModalCount();
      }
    }catch(_){}

    let title = tUI("end_title");
    if(endingType === "good") title = tUI("end_title_good");
    if(endingType === "bad") title = tUI("end_title_bad");
    if(endingType === "secret") title = tUI("end_title_secret");

    let body = tUI("ending_desc");

    try{
      if(endScene && endScene.title_key) title = tS(endScene.title_key);
      if(endScene && endScene.body_key) body  = tS(endScene.body_key);
    }catch(_){}

    const introTitle = tUI("intro_end_title");
    const vcoins = introRewardVCoins || 100;
    const jetons = introRewardJetons || 2;

    const l1 = tUI("intro_end_line1") || tUI("intro_end_silence") || body || "";
    const l2 = tUI("intro_end_line2") || "";

    const check = tUI("symbol_check");
    const rewardLabel = tUI("intro_end_reward_label");

    const les = tUI("intro_end_prefix_les");
    const useV = tUI("intro_end_use_vcoins");
    const useJ = tUI("intro_end_use_jetons");

    const jb1 = tUI("intro_end_jetons_b1");
    const jb2 = tUI("intro_end_jetons_b2");
    const jb3 = tUI("intro_end_jetons_b3");

    const multi = tUI("intro_end_multi_endings");

    showEndModal(
      introTitle,
      (root) => {
        const wrap = document.createElement("div");
        wrap.className = "vc-intro-end";

        const head = document.createElement("div");
        head.className = "vc-intro-head";
        head.textContent = [l1, l2].filter(Boolean).join("\n");
        wrap.appendChild(head);

        const rewardTitle = document.createElement("div");
        rewardTitle.className = "vc-intro-reward-title";

        const ck = document.createElement("span");
        ck.className = "vc-check";
        ck.textContent = check;
        rewardTitle.appendChild(ck);

        const rt = document.createElement("span");
        rt.textContent = rewardLabel;
        rewardTitle.appendChild(rt);

        wrap.appendChild(rewardTitle);

        const ulReward = document.createElement("ul");
        ulReward.className = "vc-intro-ul";

        const liJ = document.createElement("li");
        const rowJ = document.createElement("div");
        rowJ.className = "vc-intro-li";
        const imgJ = document.createElement("img");
        imgJ.src = UI_JETON_ICON_WEBP;
        imgJ.alt = "";
        imgJ.draggable = false;
        const txtJ = document.createElement("span");
        txtJ.textContent = `+${jetons}`;
        rowJ.appendChild(imgJ);
        rowJ.appendChild(txtJ);
        liJ.appendChild(rowJ);
        ulReward.appendChild(liJ);

        const liV = document.createElement("li");
        const rowV = document.createElement("div");
        rowV.className = "vc-intro-li";
        const imgV = document.createElement("img");
        imgV.src = UI_VCOINS_ICON_WEBP;
        imgV.alt = "";
        imgV.draggable = false;
        const txtV = document.createElement("span");
        txtV.textContent = `+${vcoins}`;
        rowV.appendChild(imgV);
        rowV.appendChild(txtV);
        liV.appendChild(rowV);
        ulReward.appendChild(liV);

        wrap.appendChild(ulReward);

        const lineV = document.createElement("div");
        lineV.className = "vc-intro-line";
        const sLesV = document.createElement("span");
        sLesV.textContent = les;
        const iV = document.createElement("img");
        iV.src = UI_VCOINS_ICON_WEBP;
        iV.alt = "";
        iV.draggable = false;
        const sUseV = document.createElement("span");
        sUseV.textContent = useV;
        lineV.appendChild(sLesV);
        lineV.appendChild(iV);
        lineV.appendChild(sUseV);
        wrap.appendChild(lineV);

        const lineJ2 = document.createElement("div");
        lineJ2.className = "vc-intro-line";
        const sLesJ = document.createElement("span");
        sLesJ.textContent = les;
        const iJ2 = document.createElement("img");
        iJ2.src = UI_JETON_ICON_WEBP;
        iJ2.alt = "";
        iJ2.draggable = false;
        const sUseJ = document.createElement("span");
        sUseJ.textContent = useJ;
        lineJ2.appendChild(sLesJ);
        lineJ2.appendChild(iJ2);
        lineJ2.appendChild(sUseJ);
        wrap.appendChild(lineJ2);

        const ulJ = document.createElement("ul");
        ulJ.className = "vc-intro-ul";
        const li1 = document.createElement("li"); li1.textContent = jb1; ulJ.appendChild(li1);
        const li2 = document.createElement("li"); li2.textContent = jb2; ulJ.appendChild(li2);
        const li3 = document.createElement("li"); li3.textContent = jb3; ulJ.appendChild(li3);
        wrap.appendChild(ulJ);

        const pMulti = document.createElement("div");
        pMulti.className = "vc-modal-prewrap";
        pMulti.textContent = multi;
        wrap.appendChild(pMulti);

        root.appendChild(wrap);
      },
      () => { history.back(); },
      () => { hardResetScenario(currentScenarioId); renderScene(); }
    );
    return;
  }

  const endingKey = `${String(currentScenarioId || "")}:${String(endScene?.id || endingType)}`;

  if(ENDING_STATE.key !== endingKey){
    ENDING_STATE = {
      key: endingKey,
      reward: 300,
      adBonusClaimed: false,
      busy: false
    };

    try{
      if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
        const res = await window.VUserData.completeScenario(currentScenarioId, endingType);
        ENDING_STATE.reward = getEndingRewardAmount(res?.data || null);
      }
    }catch(e){}
  }

  const rewardAmount = Number(ENDING_STATE.reward || 300);

  let title = tUI("end_title");
  if(endingType === "good") title = tUI("end_title_good");
  if(endingType === "bad") title = tUI("end_title_bad");
  if(endingType === "secret") title = tUI("end_title_secret");

  let body = tUI("ending_desc");

  try{
    if(endScene && endScene.title_key) title = tS(endScene.title_key);
    if(endScene && endScene.body_key) body = tS(endScene.body_key);
  }catch(_){}

  const titleEl = $("sceneTitle");
  const bodyEl  = $("sceneBody");
  const imgEl   = $("scene_img") || $("sceneImg");
  const choicesEl = $("choices");
  const hintBtn = $("btnHint");

  hideEndModal();

  if(hintBtn){
    hintBtn.disabled = true;
    hintBtn.onclick = null;
  }

  if(titleEl) titleEl.textContent = title;

  if(imgEl){
    const img = resolveImageFile(LOGIC, endScene?.image_id || endScene?.id);
    setSceneImage(img?.file || "", img?.alt || "");
  }

  let rewardValue = null;

  if(bodyEl){
    clearNode(bodyEl);

    const wrap = document.createElement("span");
    wrap.className = "vc-end-wrap";

    const copy = document.createElement("span");
    copy.className = "vc-end-copy";
    copy.textContent = body;

    const unlock = document.createElement("span");
    unlock.className = "vc-end-unlock";
    unlock.textContent = tUI("end_unlock_line", {
      ending: getEndingLabel(endingType)
    });

    const reward = document.createElement("span");
    reward.className = "vc-end-reward-line";

    const rewardIcon = document.createElement("img");
    rewardIcon.src = UI_VCOINS_ICON_WEBP;
    rewardIcon.alt = "";
    rewardIcon.draggable = false;

    rewardValue = document.createElement("span");
    rewardValue.className = "vc-end-reward-value";
    rewardValue.textContent = `+${rewardAmount}`;

    reward.appendChild(rewardIcon);
    reward.appendChild(rewardValue);

    wrap.appendChild(copy);
    wrap.appendChild(unlock);
    wrap.appendChild(reward);

    bodyEl.appendChild(wrap);
  }

  if(choicesEl){
    clearNode(choicesEl);

    const btnBonus = document.createElement("button");
    btnBonus.type = "button";
    btnBonus.className = "choice_btn";

    if(ENDING_STATE.adBonusClaimed){
      setChoiceButtonContentWithIcon(
        btnBonus,
        UI_VCOINS_ICON_WEBP,
        tUI("end_add_bonus_done", { amount: ENDING_AD_BONUS_AMOUNT })
      );
    } else {
      setChoiceButtonContentWithIcon(
        btnBonus,
        UI_VCOINS_ICON_WEBP,
        tUI("end_btn_add_bonus", { amount: ENDING_AD_BONUS_AMOUNT })
      );
    }

    btnBonus.disabled = !!ENDING_STATE.adBonusClaimed || !!ENDING_STATE.busy;

    btnBonus.onclick = async () => {
      if(ENDING_STATE.adBonusClaimed || ENDING_STATE.busy) return;

      ENDING_STATE.busy = true;
      btnBonus.disabled = true;
      setChoiceButtonContentWithIcon(
        btnBonus,
        UI_VCOINS_ICON_WEBP,
        tUI("end_add_bonus_wait", { amount: ENDING_AD_BONUS_AMOUNT })
      );

      let adOk = false;
      try{
        const ad = await window.VAds?.showRewarded?.();
        adOk = !!ad?.ok;
      }catch(_){
        adOk = false;
      }

      if(!adOk){
        ENDING_STATE.busy = false;
        btnBonus.disabled = false;
        setChoiceButtonContentWithIcon(
          btnBonus,
          UI_VCOINS_ICON_WEBP,
          tUI("end_btn_add_bonus", { amount: ENDING_AD_BONUS_AMOUNT })
        );
        showHintModal(tUI("hint_title"), tUI("end_add_bonus_error"));
        return;
      }

      try{
        await window.VUserData?.addVCoins?.(ENDING_AD_BONUS_AMOUNT);
      }catch(_){}

      ENDING_STATE.busy = false;
      ENDING_STATE.adBonusClaimed = true;
      btnBonus.disabled = true;

      setChoiceButtonContentWithIcon(
        btnBonus,
        UI_VCOINS_ICON_WEBP,
        tUI("end_add_bonus_done", { amount: ENDING_AD_BONUS_AMOUNT })
      );

      if(rewardValue){
        rewardValue.textContent = `+${rewardAmount + ENDING_AD_BONUS_AMOUNT}`;
      }
    };

    const btnRestart = document.createElement("button");
    btnRestart.type = "button";
    btnRestart.className = "choice_btn";
    btnRestart.textContent = tUI("btn_restart");
    btnRestart.onclick = () => {
      ENDING_STATE = { key:"", reward:300, adBonusClaimed:false, busy:false };
      hardResetScenario(currentScenarioId);
      renderScene();
    };

    const btnBack = document.createElement("button");
    btnBack.type = "button";
    btnBack.className = "choice_btn";
    btnBack.textContent = tUI("btn_back");
    btnBack.onclick = () => {
      ENDING_STATE = { key:"", reward:300, adBonusClaimed:false, busy:false };
      location.href = "index.html";
    };

    choicesEl.appendChild(btnBonus);
    choicesEl.appendChild(btnRestart);
    choicesEl.appendChild(btnBack);
  }
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

  try{
    const m = /^end_(good|bad|secret)$/i.exec(String(scene.id || ""));
    if(m && !scene.ending) scene.ending = String(m[1]).toLowerCase();
  }catch(_){}

  if(scene.ending){
    handleEnding(scene.ending, scene);
    return;
  }

  ENDING_STATE = { key:"", reward:300, adBonusClaimed:false, busy:false };

  const titleEl = $("sceneTitle");
  const bodyEl  = $("sceneBody");
  const imgEl   = $("scene_img") || $("sceneImg");
  const choicesEl = $("choices");
  const hintBtn = $("btnHint");

  if(titleEl) titleEl.textContent = tS(scene.title_key);
  if(bodyEl) bodyEl.textContent = tS(scene.body_key);

  if(imgEl){
    const img = resolveImageFile(LOGIC, scene.image_id || scene.id);
    setSceneImage(img?.file || "", img?.alt || "");
  }

  preloadNextSceneImages(scene.id);

  if(hintBtn){
    const hintKey = scene.hint_key;
    if(hintKey){
      hintBtn.disabled = false;
      hintBtn.onclick = () => {
        const title = tUI("hint_title");
        const body = tS(hintKey);
        showHintModal(title, body);
      };
    } else {
      hintBtn.disabled = true;
      hintBtn.onclick = null;
    }
  }

  if(choicesEl){
    choicesEl.innerHTML = "";

    const arr = Array.isArray(scene.choices) ? scene.choices : [];

    for(const ch of arr){
      const label = tS(ch.choice_key);
      const btn = document.createElement("button");
      btn.className = "choice_btn";

      if(GUIDE_STATE && GUIDE_STATE.active && GUIDE_STATE.nextByScene && ch && ch.next){
        const wanted = GUIDE_STATE.nextByScene[scene.id];
        if(wanted && String(ch.next) === String(wanted)){
          btn.classList.add("is_guide");
        }
      }

      btn.textContent = label;

      const available = isChoiceAvailable(ch);

      if(!available && !OVERRIDE_FLAGS){
        btn.classList.add("is_locked");
        btn.title = tUI("locked_choice");
      }

      btn.onclick = async () => {
        if(!available && !OVERRIDE_FLAGS){
          showLockedChoiceModal(ch);
          return;
        }
        await executeChoice(ch);
      };

      choicesEl.appendChild(btn);
    }
  }
}

/* =========================
   PUBLIC API
========================= */
window.VLang = {
  get: () => LANG,
  supported: () => SUPPORTED_LANGS.slice(),
  normalize: normalizeLang,
  set: async (lang, opts = {}) => {
    return await setLang(lang, {
      persistLocal: opts.persistLocal !== false,
      persistRemote: opts.persistRemote !== false,
      rerender: opts.rerender !== false
    });
  }
};

/* =========================
   RUN
========================= */
document.addEventListener("DOMContentLoaded", boot);

})();