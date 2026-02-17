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
  const title = (typeof info.title === 'string') ? info.title : 'Infos';
  const body  = (typeof info.body  === 'string') ? info.body  : '';
  if(!body && !title) return null;
  return { title, body };
}

function isChoiceAvailable(choice){
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
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog);
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

function bindJetonHud(){
  const btn = $("btnJetonBack");
  if(btn){
    btn.onclick = async () => {
      await goBackWithJeton();
    };
  }

  // Si ton userData émet un event profil après RPC, on resync le HUD
  window.addEventListener("vr:profile", updateHudJetons);
  window.addEventListener("vc:profile", updateHudJetons);

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
  bindJetonHud(); // ✅ AJOUT

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
      help.title = "Infos";
      help.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showHintModal(info.title || "Infos", info.body || "");
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
  // Si ton HTML a déjà le modal, on ne recrée rien.
  let modal = $("resumeModal");
  if(modal) return;

  modal = document.createElement("div");
  modal.id = "resumeModal";
  modal.className = "modal hidden";
  modal.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("div");
  backdrop.id = "resumeBackdrop";
  backdrop.className = "modal__backdrop";

  const panel = document.createElement("div");
  panel.className = "modal__content";

  const head = document.createElement("div");
  head.className = "modal__header";

  const title = document.createElement("div");
  title.id = "resumeTitle";
  title.className = "modal__title";

  const close = document.createElement("button");
  close.type = "button";
  close.id = "resumeClose";
  close.className = "modal__close";
  close.textContent = tUI("common.cancel") || "Annuler";

  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement("div");
  body.id = "resumeBody";
  body.className = "modal__body";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.marginTop = "14px";

  // ⚠️ IDs "resumeContinue/resumeRestart" uniquement si on génère le modal nous-mêmes.
  const btnContinue = document.createElement("button");
  btnContinue.type = "button";
  btnContinue.id = "resumeContinue";
  btnContinue.className = "btn";
  btnContinue.textContent = tUI("btn_continue");

  const btnRestart = document.createElement("button");
  btnRestart.type = "button";
  btnRestart.id = "resumeRestart";
  btnRestart.className = "btn btn--ghost";
  btnRestart.textContent = tUI("btn_restart");

  actions.appendChild(btnContinue);
  actions.appendChild(btnRestart);

  body.appendChild(actions);

  panel.appendChild(head);
  panel.appendChild(body);

  modal.appendChild(backdrop);
  modal.appendChild(panel);

  document.body.appendChild(modal);

  close.onclick = () => hideResumeModal();
  backdrop.onclick = () => hideResumeModal();
}

function showResumeModal(onContinue, onRestart){
  ensureResumeModal();

  const modal = $("resumeModal");
  const title = $("resumeTitle");
  const body  = $("resumeBody");

  // ✅ Supporte les 2 variantes :
  // - HTML: btnResumeContinue / btnResumeRestart (ton game.html)
  // - JS-generated: resumeContinue / resumeRestart
  const btnC = $("btnResumeContinue") || $("resumeContinue");
  const btnR = $("btnResumeRestart")  || $("resumeRestart");

  // ✅ Binder aussi close/backdrop si le modal vient du HTML
  const close = $("resumeClose");
  const back  = $("resumeBackdrop");
  if(close) close.onclick = hideResumeModal;
  if(back)  back.onclick  = hideResumeModal;

  if(title) title.textContent = tUI("resume_title");

  // ✅ description stable (pas d’empilement)
  if(body){
    let desc = $("resumeDesc");
    if(!desc){
      desc = document.createElement("div");
      desc.id = "resumeDesc";
      desc.style.marginBottom = "10px";
      body.insertBefore(desc, body.firstChild);
    }
    desc.textContent = tUI("resume_desc");
  }

  if(btnC){
    btnC.textContent = tUI("btn_continue");
    btnC.onclick = () => { hideResumeModal(); onContinue && onContinue(); };
  }
  if(btnR){
    btnR.textContent = tUI("btn_restart");
    btnR.onclick = () => { hideResumeModal(); onRestart && onRestart(); };
  }

  if(modal){
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }
}

function hideResumeModal(){
  const modal = $("resumeModal");
  if(!modal) return;

  const desc = $("resumeDesc");
  if(desc && desc.parentNode) desc.parentNode.removeChild(desc);

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function openScenario(scenarioId, opts = {}){
  const { skipResumePrompt = false } = opts;

  currentScenarioId = scenarioId;

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));
  TEXT  = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));

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
   HINT MODAL + LOCKED MODAL
========================= */
function showHintModal(title, body){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

  t.textContent = title || tUI("hint_title");
  b.textContent = ""; // reset
  b.textContent = body || "";

  // nettoie actions si présentes
  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function showHintModalWithActions(title, bodyLines, actions){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

  t.textContent = title || tUI("hint_title");

  // reset body
  b.textContent = "";
  const txt = Array.isArray(bodyLines) ? bodyLines.join("\n") : String(bodyLines || "");
  b.textContent = txt;

  // remove previous actions
  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);

  // add actions
  const wrap = document.createElement("div");
  wrap.id = "hintActions";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "10px";
  wrap.style.marginTop = "14px";

  for(const act of (actions || [])){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = act.className || "btn";
    btn.textContent = act.label || "OK";
    btn.onclick = async () => { try{ await (act.onClick && act.onClick()); }catch(e){} };
    wrap.appendChild(btn);
  }

  b.parentNode.appendChild(wrap);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function hideHintModal(){
  const modal = $("hintModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");

  const old = $("hintActions");
  if(old && old.parentNode) old.parentNode.removeChild(old);
}

function bindHintModal(){
  const close = $("hintClose");
  const back = $("hintBackdrop");
  if(close) close.onclick = hideHintModal;
  if(back) back.onclick = hideHintModal;
}

function prettyFlagTitle(flag){
  const key = `hf.clue.${flag}.title`;
  const v = (TEXT_STRINGS && Object.prototype.hasOwnProperty.call(TEXT_STRINGS, key)) ? TEXT_STRINGS[key] : deepGet(TEXT, key);
  return v || flag;
}

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
    showHintModal(tUI("hint_title"), tUI("locked_no_back") || "Aucun retour possible ici.");
    return;
  }

  const res = await spendJetons(1);
  if(!res?.ok){
    showHintModal(tUI("hint_title"), tUI("jeton_not_enough") || "Pas assez de jetons.");
    return;
  }

  st.scene = st.history.pop();
  save();
  updateHudJetons(); // ✅ AJOUT
  hideHintModal();
  renderScene();
}

async function restartWithJeton(){
  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  const res = await spendJetons(1);
  if(!res?.ok){
    showHintModal(tUI("hint_title"), tUI("jeton_not_enough") || "Pas assez de jetons.");
    return;
  }

  hardResetScenario(currentScenarioId);
  updateHudJetons(); // ✅ AJOUT
  hideHintModal();
  renderScene();
}

function showLockedChoiceModal(choice){
  const { missingAll, missingAny } = getMissingFlagsForChoice(choice);

  const lines = [];
  lines.push(tUI("locked_body") || "Tu as raté des éléments nécessaires pour débloquer cette voie.");

  if(missingAll.length){
    lines.push("");
    lines.push(tUI("locked_missing") || "Il te manque :");
    for(const f of missingAll){
      lines.push(`• ${prettyFlagTitle(f)}`);
    }
  }

  if(missingAny.length){
    lines.push("");
    lines.push(tUI("locked_missing_any") || "Il te faut au moins un élément parmi :");
    for(const f of missingAny){
      lines.push(`• ${prettyFlagTitle(f)}`);
    }
  }

  lines.push("");
  lines.push(tUI("locked_tip") || "Astuce : explore plus, certains objets servent de preuve.");

  showHintModalWithActions(
    tUI("locked_title") || "Choix bloqué",
    lines,
    [
      {
        label: tUI("locked_back_jeton") || "Revenir en arrière (1 jeton)",
        className: "btn",
        onClick: goBackWithJeton
      },
      {
        label: tUI("locked_restart_jeton") || "Revenir au début (1 jeton)",
        className: "btn btn--ghost",
        onClick: restartWithJeton
      },
      {
        label: tUI("locked_close") || "Fermer",
        className: "btn btn--ghost",
        onClick: () => hideHintModal()
      }
    ]
  );
}

/* =========================
   ENDINGS
========================= */
async function handleEnding(ending){
  const e = String(ending || "").trim().toLowerCase();
  if(!["good","bad","secret"].includes(e)){
    showHintModal(tUI("hint_title"), "Ending invalide.");
    return;
  }

  hardResetScenario(currentScenarioId);

  let reward = 300;
  let newVcoins = null;

  if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
    const res = await window.VUserData.completeScenario(currentScenarioId, e);
    if(res?.ok && res?.data){
      reward = Number(res.data.reward ?? 300);
      newVcoins = (typeof res.data.vcoins === "number") ? res.data.vcoins : null;
    }
  }

  const title = tUI("ending_title");
  const desc  = tUI("ending_desc");
  const toast = tUI("reward_toast", { reward: String(reward) });

  const extra = (typeof newVcoins === "number")
    ? `\n\n${toast}\nVCoins: ${newVcoins}`
    : `\n\n${toast}`;

  showHintModal(title, `${desc}\n\n(${e.toUpperCase()})${extra}`);

  renderScene();
}

/* =========================
   RENDER
========================= */
function renderScene(){
  renderTopbar();
  bindHintModal();
  updateHudJetons(); // ✅ AJOUT (safe)

  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  const scene = getCurrentScene();
  if(!scene){
    st.scene = resolveStartScene(LOGIC);
    save();
    return renderScene();
  }

  // ✅ Fin au niveau scène
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
      btn.textContent = label;

      const available = isChoiceAvailable(ch);

      // ✅ NOUVEAU : pas de disabled, on garde cliquable
      if(!available){
        btn.classList.add("is_locked");
        btn.title = tUI("locked_choice") || "Indisponible pour le moment";
      }

      btn.onclick = async () => {
        if(!available){
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

        // ✅ Fin au niveau choix
        if(ch.ending){
          save();
          await handleEnding(ch.ending);
          return;
        }

        // next scene
        if(ch.next){
          // ✅ history
          st.history ??= [];
          st.history.push(st.scene);

          st.scene = ch.next;
          save();
          renderScene();
          return;
        }

        showHintModal(
          tUI("hint_title") || "Info",
          tUI("no_next_scene") || "Ce choix ne mène nulle part pour l’instant."
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
