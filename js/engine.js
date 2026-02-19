/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const DEFAULT_LANG = "fr";

const SUPPORTED_LANGS = ["fr", "en"];

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

/* =========================
   LANGUAGE RESOLUTION
========================= */
function normalizeLang(raw){
  if(!raw) return null;
  const s = String(raw).trim().toLowerCase();
  const base = s.split("-")[0];
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

  if(persistRemote && window.VUserData && typeof window.VUserData.getLang === "function"){
    // optionnel
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
   UI TEXT HELPERS
========================= */
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

/* =========================
   FLAGS LOCKING (avec override)
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

/* =========================
   GUIDE (BFS vers une fin)
========================= */
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

  // fallback: toute scène sans choix = ending
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

  // BFS: ignore flags
  const q = [String(fromSceneId)];
  const visited = new Set(q);
  const prev = {}; // node -> prev node
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
   SAVE/LOAD (LOCAL)
========================= */
function load(){
  try{
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
  UI = await fetchJSON(PATHS.ui(LANG));
  const sel = $("langSelect");
  if(sel) sel.value = LANG;

  // ✅ applique i18n sur les textes statiques HTML
  applyStaticI18n();
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog);
}

/* =========================
   STATIC i18n (game.html)
========================= */
function applyStaticI18n(){
  const btnJeton = $("btnJetonBack");
  if(btnJeton) btnJeton.title = tUI("jeton_title");

  const jmTitle = $("jetonModalTitle");
  if(jmTitle) jmTitle.textContent = tUI("jeton_title");

  const bal = $("jetonBalanceLabel");
  if(bal) bal.textContent = tUI("jeton_balance_label");

  const bBack = $("btnJetonBackModal");
  if(bBack) bBack.textContent = tUI("jeton_back_btn");

  const bGuide = $("btnJetonGuide");
  if(bGuide) bGuide.textContent = tUI("jeton_guide_btn");

  const bGood = $("btnJetonGuideGood");
  if(bGood) bGood.textContent = tUI("jeton_guide_good");

  const bBad = $("btnJetonGuideBad");
  if(bBad) bBad.textContent = tUI("jeton_guide_bad");

  const bSecret = $("btnJetonGuideSecret");
  if(bSecret) bSecret.textContent = tUI("jeton_guide_secret");

  const bStop = $("btnJetonGuideStop");
  if(bStop) bStop.textContent = tUI("jeton_guide_stop");

  const hintClose = $("hintClose");
  if(hintClose){
    hintClose.setAttribute("aria-label", tUI("hint_close_aria"));
    hintClose.textContent = tUI("symbol_close");
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
   HUD JETONS (game.html)
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

function showJetonModal(){
  const modal = $("jetonModal");
  if(!modal) return;
  updateJetonModalCount();
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

  const guideBtn = $("btnJetonGuide");
  const targetsBox = $("jetonGuideTargets");
  if(guideBtn && targetsBox){
    guideBtn.addEventListener("click", () => {
      targetsBox.classList.remove("hidden");
    });
  }

  if(targetsBox){
    targetsBox.addEventListener("click", async (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest("button[data-target]") : null;
      if(!b) return;
      const targetType = b.getAttribute("data-target"); // good|bad|secret

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

  let initialLang = LANG;

  if(window.VUserData && typeof window.VUserData.getLang === "function"){
    try{
      const l = normalizeLang(window.VUserData.getLang());
      if(l && SUPPORTED_LANGS.includes(l)) initialLang = l;
    }catch(e){}
  }else{
    initialLang = detectDeviceLang();
  }

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
      await setLang(e.target.value, { persistLocal:true, persistRemote:false, rerender:true });
    });
  }
}

/* =========================
   MENU (index.html)
========================= */
async function loadScenarioMeta(scenarioId){
  const txt = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  return (txt && typeof txt === "object" && txt.meta) ? txt.meta : {};
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
   GAME (game.html)
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

function showEndModal(title, body, onBack, onReplay){
  ensureEndModal();

  const modal = $("endModal");
  const t = $("endTitle");
  const b = $("endBody");
  const btnBack = $("btnEndBack");
  const btnReplay = $("btnEndReplay");
  if(!modal || !t || !b || !btnBack || !btnReplay) return;

  t.textContent = title || tUI("end_title");
  b.textContent = body || "";

  btnBack.textContent = tUI("btn_back");
  btnReplay.textContent = tUI("btn_restart");

  btnBack.onclick = () => { hideEndModal(); onBack && onBack(); };
  btnReplay.onclick = () => { hideEndModal(); onReplay && onReplay(); };

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

function hideEndModal(){
  const modal = $("endModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

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
  if(!modal || !t || !b) return;

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
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

function showHintModalWithActions(title, bodyLines, actions){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

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

  for(const a of (actions || [])){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = a.className || "btn";
    btn.textContent = a.label || tUI("btn_ok");
    btn.onclick = async () => {
      try{ await a.onClick?.(); } finally {}
    };
    wrap.appendChild(btn);
  }

  b.parentNode.appendChild(wrap);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}

/* =========================
   SCENARIO OPEN
========================= */
async function openScenario(scenarioId, opts = {}){
  const { skipResumePrompt = false } = opts;

  currentScenarioId = scenarioId;

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));
  TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));

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
   JETONS UTILS
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

function showLockedChoiceModal(choice){
  const { missingAll, missingAny } = getMissingFlagsForChoice(choice);

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

  showHintModalWithActions(
    tUI("locked_title"),
    lines,
    [
      { label: tUI("locked_close"), className:"btn btn--ghost", onClick: () => hideHintModal() }
    ]
  );
}

/* =========================
   ENDING (modal fin)
========================= */
async function handleEnding(type){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  GUIDE_STATE.active = false;
  GUIDE_STATE.targetType = null;
  GUIDE_STATE.nextByScene = {};
  GUIDE_STATE.path = [];
  OVERRIDE_FLAGS = false;

  const endingType = String(type || "").toLowerCase();
  let title = tUI("end_title");
  if(endingType === "good") title = tUI("end_title_good");
  if(endingType === "bad") title = tUI("end_title_bad");
  if(endingType === "secret") title = tUI("end_title_secret");

  const body = tUI("ending_desc");

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

  if(scene.ending){
    handleEnding(scene.ending);
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
      if(imgSourceEl) imgSourceEl.removeAttribute("srcset");
    }
  }

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

        if(Array.isArray(ch.set_flags)){
          for(const f of ch.set_flags) setFlag(f);
        }
        if(Array.isArray(ch.clear_flags)){
          for(const f of ch.clear_flags) clearFlag(f);
        }

        if(ch.add_clue) addClue(ch.add_clue);

        if(ch.ending){
          save();
          await handleEnding(ch.ending);
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
      };

      choicesEl.appendChild(btn);
    }
  }
}

/* =========================
   RUN
========================= */
document.addEventListener("DOMContentLoaded", boot);
