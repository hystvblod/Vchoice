/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const DEFAULT_LANG = "fr";

const PATHS = {
  ui: (lang) => `data/ui/ui_${lang}.json`,
  catalog: `data/scenarios/catalog.json`,
  scenarioLogic: (scenarioId) => `data/scenarios/${scenarioId}/logic.json`,
  scenarioText:  (scenarioId, lang) => `data/scenarios/${scenarioId}/text_${lang}.json`,
};

/* =========================
   SMALL HELPERS
========================= */
const $ = (id) => document.getElementById(id);

function deepGet(obj, path){
  const parts = path.split(".");
  let cur = obj;
  for(const p of parts){
    if(cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

function format(str, params){
  return String(str).replace(/\{\{(\w+)\}\}/g, (_,k) => (params?.[k] ?? ""));
}

async function fetchJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error(`Missing ${path}`);
  return await res.json();
}

/* =========================
   STATE
========================= */
let UI = null;
let CATALOG = null;

let LANG = DEFAULT_LANG;

let currentScenarioId = null;
let LOGIC = null;
let TEXT = null;

let scenarioStates = {}; // { [scenarioId]: { scene, step, flags, endings } }

function defaultScenarioState(startScene){
  return {
    scene: startScene,
    step: 1,
    flags: {},  // { flagId:true }
    endings: { good:false, bad:false, secret:false }
  };
}

function normalizeScenarioState(st, startScene){
  if(!st || typeof st !== "object") return defaultScenarioState(startScene);

  const out = {
    scene: (typeof st.scene === "string") ? st.scene : startScene,
    step: (Number.isFinite(st.step) && st.step > 0) ? st.step : 1,
    flags: (st.flags && typeof st.flags === "object") ? st.flags : {},
    endings: (st.endings && typeof st.endings === "object")
      ? { good:!!st.endings.good, bad:!!st.endings.bad, secret:!!st.endings.secret }
      : { good:false, bad:false, secret:false }
  };

  // migration: ignore old "items"
  return out;
}

function loadSave(){
  const raw = localStorage.getItem(SAVE_KEY);
  if(!raw) return;

  try{
    const obj = JSON.parse(raw);
    if(obj.lang) LANG = obj.lang;
    if(obj.scenarioStates) scenarioStates = obj.scenarioStates;
    if(obj.currentScenarioId) currentScenarioId = obj.currentScenarioId;
  }catch{}
}

function save(){
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    lang: LANG,
    currentScenarioId,
    scenarioStates
  }));
}

function tUI(path, params={}){
  const raw = deepGet(UI, path);
  const s = (typeof raw === "string") ? raw : `[${path}]`;
  return format(s, params);
}

function tS(key){
  const raw = TEXT?.strings?.[key];
  return (typeof raw === "string") ? raw : `[${key}]`;
}

function getScenarioState(){
  if(!currentScenarioId) return null;
  return scenarioStates[currentScenarioId] || null;
}

function setScenarioState(st){
  scenarioStates[currentScenarioId] = st;
  save();
}

function countEndings(st){
  return (st.endings.good?1:0) + (st.endings.bad?1:0) + (st.endings.secret?1:0);
}

/* =========================
   PAGE DETECTION
========================= */
function hasMenuPage(){
  return !!$("screen_menu") && !!$("scenario_grid");
}
function hasGamePage(){
  return !!$("screen_game") && !!$("choices");
}

/* =========================
   TOPBAR
========================= */
function renderTopbar(){
  if($("ui_app_title")) $("ui_app_title").textContent = tUI("ui.app_title");
  if($("ui_app_subtitle")) $("ui_app_subtitle").textContent = tUI("ui.app_subtitle");

  if($("btn_restart")) $("btn_restart").textContent = tUI("ui.restart");
  if($("btn_lang")) $("btn_lang").textContent = tUI("ui.lang_label", { lang: LANG.toUpperCase() });
  if($("btn_hint")) $("btn_hint").textContent = tUI("ui.hint_button");
}

/* =========================
   MENU (index.html)
========================= */
async function loadScenarioMeta(scenarioId){
  try{
    const text = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
    return text.meta || { title: scenarioId, tagline: "" };
  }catch{
    const textFr = await fetchJSON(PATHS.scenarioText(scenarioId, "fr"));
    return textFr.meta || { title: scenarioId, tagline: "" };
  }
}

function makeCover(file){
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = file || "";
  img.onerror = () => { img.src = ""; };
  return img;
}

async function renderMenu(){
  renderTopbar();

  if($("ui_menu_title")) $("ui_menu_title").textContent = tUI("menu.title");
  if($("ui_menu_sub")) $("ui_menu_sub").textContent = tUI("menu.subtitle");
  if($("ui_menu_footer")) $("ui_menu_footer").textContent = tUI("menu.footer");

  const grid = $("scenario_grid");
  grid.innerHTML = "";

  for(const entry of CATALOG.scenarios){
    const scenarioId = entry.id;
    const meta = await loadScenarioMeta(scenarioId);

    const stRaw = scenarioStates[scenarioId];
    const endings = stRaw?.endings ? countEndings(stRaw) : 0;
    const hasSave = !!stRaw?.scene;

    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;

    const cover = document.createElement("div");
    cover.className = "cover";
    cover.appendChild(makeCover(entry.cover || ""));

    const body = document.createElement("div");
    body.className = "card__body";

    const h = document.createElement("h3");
    h.className = "card__title";
    h.textContent = meta.title || scenarioId;

    const p = document.createElement("p");
    p.className = "card__sub";
    p.textContent = meta.tagline || "";

    const metaRow = document.createElement("div");
    metaRow.className = "card__meta";

    const b1 = document.createElement("div");
    b1.className = "badge";
    b1.textContent = hasSave ? tUI("menu.resume") : tUI("menu.start");

    const b2 = document.createElement("div");
    b2.className = "badge badge--muted";
    b2.textContent = tUI("menu.endings", { n: endings, total: 3 });

    metaRow.appendChild(b1);
    metaRow.appendChild(b2);

    body.appendChild(h);
    body.appendChild(p);
    body.appendChild(metaRow);

    card.appendChild(cover);
    card.appendChild(body);

    const goGame = () => {
      currentScenarioId = scenarioId;
      save();
      window.location.href = `game.html?s=${encodeURIComponent(scenarioId)}`;
    };
    card.onclick = goGame;
    card.onkeydown = (e) => { if(e.key === "Enter") goGame(); };

    grid.appendChild(card);
  }
}

/* =========================
   GAME (game.html)
========================= */
function logicScene(id){ return LOGIC?.scenes?.[id] || null; }

function resolveImage(scene){
  if(!scene?.image_id) return null;
  const im = LOGIC?.images?.[scene.image_id];
  return im?.file || null;
}

function applyChoiceEffects(st, ch){
  if(Array.isArray(ch.set_flags)){
    for(const f of ch.set_flags) st.flags[f] = true;
  }
  if(Array.isArray(ch.unset_flags)){
    for(const f of ch.unset_flags) delete st.flags[f];
  }
}

function meetsRequirements(st, ch){
  if(Array.isArray(ch.requires_all_flags)){
    for(const f of ch.requires_all_flags){
      if(!st.flags[f]) return false;
    }
  }
  if(Array.isArray(ch.requires_any_flags)){
    let ok = false;
    for(const f of ch.requires_any_flags){
      if(st.flags[f]) ok = true;
    }
    if(!ok) return false;
  }
  if(Array.isArray(ch.requires_not_flags)){
    for(const f of ch.requires_not_flags){
      if(st.flags[f]) return false;
    }
  }
  return true;
}

function endingType(sceneId){
  if(sceneId === "end_good") return "good";
  if(sceneId === "end_bad") return "bad";
  if(sceneId === "end_secret") return "secret";
  if(sceneId && sceneId.startsWith("end_")) return "bad";
  return null;
}

function unlockEnding(st, type){
  if(type==="good") st.endings.good = true;
  if(type==="bad") st.endings.bad = true;
  if(type==="secret") st.endings.secret = true;
}

function renderScene(){
  renderTopbar();

  const st = getScenarioState();
  if(!st) return;

  const sL = logicScene(st.scene);
  if(!sL){
    if($("scene_title")) $("scene_title").textContent = tUI("errors.missing_scene");
    if($("scene_body")) $("scene_body").textContent = tUI("errors.missing_scene");
    return;
  }

  // HUD
  if($("ui_scenario_name")) $("ui_scenario_name").textContent = TEXT?.meta?.title || currentScenarioId;
  if($("ui_step")) $("ui_step").textContent = tUI("ui.step", { n: st.step });
  if($("ui_endings")) $("ui_endings").textContent = tUI("ui.endings_found", { n: countEndings(st), total: 3 });

  // Scene text
  if($("scene_title")) $("scene_title").textContent = tS(sL.title_key);
  if($("scene_body")) $("scene_body").textContent = tS(sL.body_key);

  if($("ui_footer")) $("ui_footer").textContent = tUI("ui.footer");

  // Image
  const img = $("scene_img");
  const fb  = $("img_fallback");
  const path = resolveImage(sL);

  if(img && fb){
    if(!path){
      img.style.display="none";
      fb.style.display="flex";
      fb.textContent = tUI("ui.no_image");
    } else {
      img.style.display="block";
      fb.style.display="none";
      img.src = path;
      img.onerror = () => {
        img.style.display="none";
        fb.style.display="flex";
        fb.textContent = tUI("ui.missing_image", { path });
      };
    }
  }

  // Endings tracking
  const et = endingType(st.scene);
  if(et){
    unlockEnding(st, et);
    setScenarioState(st);
  }

  // Choices
  const box = $("choices");
  box.innerHTML = "";

  if(et){
    const btnAgain = document.createElement("button");
    btnAgain.className = "choice";
    btnAgain.textContent = tUI("ui.play_again");
    btnAgain.onclick = () => {
      const ok = confirm(tUI("ui.confirm_restart"));
      if(!ok) return;
      scenarioStates[currentScenarioId] = defaultScenarioState(LOGIC.start_scene || "s01");
      save();
      renderScene();
    };

    const btnMenu = document.createElement("button");
    btnMenu.className = "choice";
    btnMenu.textContent = tUI("menu.back_to_menu");
    btnMenu.onclick = () => { window.location.href = "index.html"; };

    box.appendChild(btnAgain);
    box.appendChild(btnMenu);
    return;
  }

  const choices = Array.isArray(sL.choices) ? sL.choices : [];
  for(const ch of choices){
    const btn = document.createElement("button");
    btn.className = "choice";

    const ok = meetsRequirements(st, ch);
    btn.disabled = !ok;
    btn.textContent = tS(ch.choice_key);

    if(!ok){
      const sub = document.createElement("small");
      sub.textContent = tUI("locks.locked");
      btn.appendChild(sub);
    }

    btn.onclick = () => {
      if(!meetsRequirements(st, ch)) return;
      applyChoiceEffects(st, ch);
      st.scene = ch.next;
      st.step += 1;
      setScenarioState(st);
      renderScene();
    };

    box.appendChild(btn);
  }
}

/* =========================
   HINTS
========================= */
function hintKey(sceneId, level){
  const ns = TEXT?.meta?.hint_ns;
  if(ns) return `${ns}.${sceneId}.${level}`;
  return `hint.${sceneId}.${level}`;
}

function setHintLevel(level){
  const soft = $("hint_soft");
  const strong = $("hint_strong");
  if(soft && strong){
    soft.classList.toggle("tab--active", level === "soft");
    strong.classList.toggle("tab--active", level === "strong");
  }

  const st = getScenarioState();
  const sceneId = st?.scene;
  const key = hintKey(sceneId, level);
  const txt = TEXT?.strings?.[key] || tUI("ui.hint_none");
  if($("hint_text")) $("hint_text").textContent = txt;
}

function openHintModal(){
  const modal = $("hint_modal");
  if(!modal) return;

  modal.style.display = "";
  modal.setAttribute("aria-hidden", "false");

  if($("hint_title")) $("hint_title").textContent = tUI("ui.hint_title");
  if($("hint_soft")) $("hint_soft").textContent = tUI("ui.hint_level_soft");
  if($("hint_strong")) $("hint_strong").textContent = tUI("ui.hint_level_strong");

  setHintLevel("soft");
}

function closeHintModal(){
  const modal = $("hint_modal");
  if(!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

/* =========================
   OPEN SCENARIO (game.html)
========================= */
async function openScenario(scenarioId){
  currentScenarioId = scenarioId;
  save();

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));

  try{
    TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  }catch{
    TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, "fr"));
  }

  const start = LOGIC.start_scene || "s01";
  scenarioStates[scenarioId] = normalizeScenarioState(scenarioStates[scenarioId], start);
  save();

  renderScene();
}

/* =========================
   LANGUAGE SWITCH
========================= */
async function reloadUI(){
  try{
    UI = await fetchJSON(PATHS.ui(LANG));
  }catch{
    LANG = "fr";
    UI = await fetchJSON(PATHS.ui("fr"));
  }
  save();
}

async function switchLang(){
  const supported = UI?.langs?.map(x => x.id) || ["fr"];
  const idx = Math.max(0, supported.indexOf(LANG));
  const next = supported[(idx + 1) % supported.length];
  LANG = next;
  await reloadUI();

  if(hasGamePage() && currentScenarioId){
    try{
      TEXT = await fetchJSON(PATHS.scenarioText(currentScenarioId, LANG));
    }catch{
      TEXT = await fetchJSON(PATHS.scenarioText(currentScenarioId, "fr"));
    }
    renderScene();
  } else if(hasMenuPage()){
    renderMenu();
  } else {
    renderTopbar();
  }
}

/* =========================
   BOOT
========================= */
async function boot(){
  loadSave();
  await reloadUI();
  CATALOG = await fetchJSON(PATHS.catalog);

  // Buttons
  if($("btn_lang")) $("btn_lang").onclick = () => switchLang();

  if($("btn_home")){
    $("btn_home").onclick = () => { window.location.href = "index.html"; };
    $("btn_home").onkeydown = (e) => { if(e.key==="Enter") $("btn_home").click(); };
  }

  if($("btn_restart")){
    $("btn_restart").onclick = () => {
      if(!currentScenarioId || !LOGIC) return;
      const ok = confirm(tUI("ui.confirm_restart"));
      if(!ok) return;
      scenarioStates[currentScenarioId] = defaultScenarioState(LOGIC.start_scene || "s01");
      save();
      renderScene();
    };
  }

  if($("btn_hint")) $("btn_hint").onclick = () => openHintModal();

  if($("hint_close")) $("hint_close").onclick = () => closeHintModal();
  if($("hint_backdrop")) $("hint_backdrop").onclick = () => closeHintModal();
  if($("hint_soft")) $("hint_soft").onclick = () => setHintLevel("soft");
  if($("hint_strong")) $("hint_strong").onclick = () => setHintLevel("strong");

  window.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeHintModal();
  });

  // Route
  if(hasMenuPage()){
    renderTopbar();
    await renderMenu();
    return;
  }

  if(hasGamePage()){
    renderTopbar();
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("s");
    const scenarioId = fromUrl || currentScenarioId || CATALOG?.scenarios?.[0]?.id;

    if(!scenarioId){
      window.location.href = "index.html";
      return;
    }

    await openScenario(scenarioId);
    return;
  }

  // Fallback
  renderTopbar();
}

boot().catch(() => {
  document.body.innerHTML = `
    <div style="padding:18px;font-family:system-ui;color:white">
      <h2>Erreur</h2>
      <p>Ouvre le projet via un serveur local (ex: <b>python -m http.server</b>) sinon les JSON ne se chargent pas.</p>
    </div>
  `;
});
