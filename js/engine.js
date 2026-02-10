/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const DEFAULT_LANG = "fr";

// Langues supportées par l'app (UI + potentiel scénarios)
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

// Scenario progress saved per scenario_id
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
  const parts = path.split(".");
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

/* =========================
   LANGUAGE RESOLUTION
========================= */
function normalizeLang(raw){
  if(!raw) return null;
  const s = String(raw).trim().toLowerCase();
  // "fr-FR" -> "fr"
  const base = s.split("-")[0];
  return base || null;
}

function detectDeviceLang(){
  // navigator.languages est souvent le plus fiable
  const list = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];

  for(const candidate of list){
    const base = normalizeLang(candidate);
    if(base && SUPPORTED_LANGS.includes(base)) return base;
  }
  return DEFAULT_LANG;
}

// setLang = point unique pour changer la langue partout
async function setLang(newLang, opts = {}){
  const {
    persistLocal = true,
    persistRemote = false, // Supabase (via userData) si dispo
    rerender = true
  } = opts;

  const base = normalizeLang(newLang);
  const safe = (base && SUPPORTED_LANGS.includes(base)) ? base : DEFAULT_LANG;

  if(LANG === safe) return;

  LANG = safe;

  // Recharge UI (toujours)
  await reloadUI();

  // Sauvegarde locale (immédiate)
  if(persistLocal) save();

  // Sauvegarde remote (si userData est branché)
  if(persistRemote && window.userData && typeof window.userData.setLanguage === "function"){
    try{ await window.userData.setLanguage(LANG); }catch(e){ /* ne bloque pas */ }
  }

  // Si on est en jeu, recharge scenario text dans la langue
  if(hasGamePage() && currentScenarioId){
    await openScenario(currentScenarioId);
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
  const v = deepGet(TEXT, key) ?? `[${key}]`;
  return params ? format(v, params) : v;
}

function getScenarioInfo(scenarioId){
  // Source voulu : data/ui/ui_<lang>.json
  // (pas dans text_<lang>.json)
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
   SAVE/LOAD
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

/* =========================
   INIT
========================= */
function hasMenuPage(){
  return !!$("menuGrid");
}
function hasGamePage(){
  return !!$("sceneTitle");
}

async function reloadUI(){
  UI = await fetchJSON(PATHS.ui(LANG));
  // sync select
  const sel = $("langSelect");
  if(sel){
    sel.value = LANG;
  }
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog);
}

async function boot(){
  load();

  // Lang initiale : localStorage > userData > device > default
  let initialLang = LANG;

  // userData (Supabase) si dispo
  if(window.userData && typeof window.userData.getLanguage === "function"){
    try{
      const remoteLang = await window.userData.getLanguage();
      const base = normalizeLang(remoteLang);
      if(base && SUPPORTED_LANGS.includes(base)) initialLang = base;
    }catch(e){
      // ignore
    }
  }else{
    // device
    const device = detectDeviceLang();
    initialLang = device;
  }

  LANG = initialLang;

  await reloadUI();
  await loadCatalog();

  bindTopbar();

  if(hasMenuPage()){
    await renderMenu();
  }

  if(hasGamePage()){
    // game.html : lecture scenarioId depuis query
    const u = new URL(location.href);
    const scenarioId = u.searchParams.get("scenario");
    if(scenarioId){
      await openScenario(scenarioId);
      renderScene();
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
   MENU (index.html)
========================= */
async function loadScenarioMeta(scenarioId){
  // On lit seulement meta depuis le text_xx.json (si nécessaire)
  const txt = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  return txt.meta || {};
}

function goToScenario(scenarioId){
  // Redirige vers game.html avec param scenario
  location.href = `game.html?scenario=${encodeURIComponent(scenarioId)}`;
}

async function renderMenu(){
  // Topbar UI
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
async function openScenario(scenarioId){
  currentScenarioId = scenarioId;

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));
  TEXT  = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));

  // init state if missing
  if(!scenarioStates[scenarioId]){
    scenarioStates[scenarioId] = {
      scene: LOGIC.start_scene,
      flags: {},
      clues: [],
    };
  }

  // Ensure required fields
  scenarioStates[scenarioId].flags ??= {};
  scenarioStates[scenarioId].clues ??= [];

  save();
}

function getCurrentScene(){
  const st = scenarioStates[currentScenarioId];
  if(!st) return null;
  const sceneId = st.scene;
  return LOGIC.scenes[sceneId] ? { id: sceneId, ...LOGIC.scenes[sceneId] } : null;
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

function renderScene(){
  renderTopbar();
  bindHintModal();

  const st = scenarioStates[currentScenarioId];
  if(!st) return;

  const scene = getCurrentScene();
  if(!scene) return;

  const titleEl = $("sceneTitle");
  const bodyEl  = $("sceneBody");
  const imgEl   = $("scene_img") || $("sceneImg");
  const imgSourceEl = $("scene_img_source");
  const choicesEl = $("choices");
  const hintBtn = $("btnHint");

  if(titleEl) titleEl.textContent = tS(scene.title_key);
  if(bodyEl) bodyEl.textContent = tS(scene.body_key);

  if(imgEl){
    const image = LOGIC.images?.[scene.image_id];
    const imageFile = image ? image.file : "";
    if(imgSourceEl) imgSourceEl.srcset = imageFile;
    imgEl.src = imageFile;
    imgEl.alt = image ? (image.alt || "") : "";
  }

  // hint
  if(hintBtn){
    const hintKey = scene.hint_key;
    hintBtn.onclick = () => {
      const title = tUI("hint_title");
      const body = hintKey ? tS(hintKey) : "";
      showHintModal(title, body);
    };
  }

  // choices
  if(choicesEl){
    choicesEl.innerHTML = "";
    for(const ch of (scene.choices || [])){
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

        // set/clear flags
        if(Array.isArray(ch.set_flags)){
          for(const f of ch.set_flags) setFlag(f);
        }
        if(Array.isArray(ch.clear_flags)){
          for(const f of ch.clear_flags) clearFlag(f);
        }

        // clue
        if(ch.add_clue) addClue(ch.add_clue);

        // next scene
        if(ch.next){
          st.scene = ch.next;
          save();
          renderScene();
        }
      };

      choicesEl.appendChild(btn);
    }
  }
}

/* =========================
   RUN
========================= */
document.addEventListener("DOMContentLoaded", boot);
