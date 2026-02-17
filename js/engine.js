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
    // ta VUserData setLang passe par RPC via VCRemoteStore.setLang si tu veux
    // ici on ne force pas, pour éviter de casser si pas branché sur cette page
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
  // “progression” = scène != start OU flags/clues non vides
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
    clues: []
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

async function boot(){
  load();

  let initialLang = LANG;

  // si VUserData existe, on garde son lang local
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

  if(hasMenuPage()){
    await renderMenu();
  }

  if(hasGamePage()){
    const u = new URL(location.href);
    const scenarioId = u.searchParams.get("scenario");
    if(scenarioId){
      await openScenario(scenarioId, { skipResumePrompt:false });
      // renderScene est appelé après la décision reprise/restart
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
  // On réutilise la structure “modal” déjà présente (comme hintModal)
  // Si tu n’as pas ces IDs dans ton HTML, on les crée dynamiquement ici.
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

  // binds
  close.onclick = () => hideResumeModal();
  backdrop.onclick = () => hideResumeModal();
}

function showResumeModal(onContinue, onRestart){
  ensureResumeModal();

  const modal = $("resumeModal");
  const title = $("resumeTitle");
  const body = $("resumeBody");
  const btnC = $("resumeContinue");
  const btnR = $("resumeRestart");

  if(title) title.textContent = tUI("resume_title");
  if(body){
    // texte + actions déjà dedans (buttons)
    const desc = document.createElement("div");
    desc.textContent = tUI("resume_desc");
    desc.style.marginBottom = "10px";
    body.insertBefore(desc, body.firstChild);
  }

  // reset events
  if(btnC) btnC.onclick = () => { hideResumeModal(); onContinue && onContinue(); };
  if(btnR) btnR.onclick = () => { hideResumeModal(); onRestart && onRestart(); };

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function hideResumeModal(){
  const modal = $("resumeModal");
  if(!modal) return;

  // nettoie le texte ajouté en haut (desc)
  const body = $("resumeBody");
  if(body && body.firstChild && body.firstChild.nodeType === 1){
    // supprime seulement si c’est un div desc (best-effort)
    const el = body.firstChild;
    if(el && el.tagName === "DIV") body.removeChild(el);
  }

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

  // init state si absent
  if(!scenarioStates[scenarioId]){
    const start = resolveStartScene(LOGIC);
    scenarioStates[scenarioId] = {
      scene: start,
      flags: {},
      clues: [],
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

  // Popup reprise si progression existe
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

function showHintModal(title, body){
  const modal = $("hintModal");
  const t = $("hintTitle");
  const b = $("hintBody");
  if(!modal || !t || !b) return;

  t.textContent = title || tUI("hint_title");
  b.textContent = body || "";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function hideHintModal(){
  const modal = $("hintModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function bindHintModal(){
  const close = $("hintClose");
  const back = $("hintBackdrop");
  if(close) close.onclick = hideHintModal;
  if(back) back.onclick = hideHintModal;
}

async function handleEnding(ending){
  const e = String(ending || "").trim().toLowerCase();
  if(!["good","bad","secret"].includes(e)){
    showHintModal(tUI("hint_title"), "Ending invalide.");
    return;
  }

  // reset local run
  hardResetScenario(currentScenarioId);

  // RPC server: +300 vcoins + log ending
  let reward = 300;
  let newVcoins = null;

  if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
    const res = await window.VUserData.completeScenario(currentScenarioId, e);
    if(res?.ok && res?.data){
      reward = Number(res.data.reward ?? 300);
      newVcoins = (typeof res.data.vcoins === "number") ? res.data.vcoins : null;
    }
  }

  // petite info (réutilise hint modal)
  const title = tUI("ending_title");
  const desc  = tUI("ending_desc");
  const toast = tUI("reward_toast", { reward: String(reward) });

  const extra = (typeof newVcoins === "number")
    ? `\n\n${toast}\nVCoins: ${newVcoins}`
    : `\n\n${toast}`;

  showHintModal(title, `${desc}\n\n(${e.toUpperCase()})${extra}`);

  // re-render start
  renderScene();
}

function renderScene(){
  renderTopbar();
  bindHintModal();

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
    // on déclenche une seule fois, puis on s’arrête
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
      if(!available){
        btn.classList.add("is_locked");
        btn.disabled = true;
        btn.title = tUI("locked_choice") || "Indisponible pour le moment";
      }

      btn.onclick = async () => {
        if(!available) return;

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
