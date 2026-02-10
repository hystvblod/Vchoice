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
   SAVE / LOAD
========================= */
function normalizeScenarioState(st, startScene){
  // State model minimal stable
  const out = {
    scene: startScene,
    step: 1,
    flags: {},
    endings: { good:false, bad:false, secret:false }
  };

  if(!st || typeof st !== "object") return out;

  out.scene = (typeof st.scene === "string") ? st.scene : startScene;
  out.step = Number.isFinite(st.step) ? st.step : 1;

  out.flags = (st.flags && typeof st.flags === "object") ? st.flags : {};
  out.endings = (st.endings && typeof st.endings === "object")
    ? { good:!!st.endings.good, bad:!!st.endings.bad, secret:!!st.endings.secret }
    : { good:false, bad:false, secret:false };

  // migration: ignore old fields safely
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

/* =========================
   I18N ACCESSORS
========================= */
function tUI(path, params={}){
  const raw = deepGet(UI, path);
  const s = (typeof raw === "string") ? raw : `[${path}]`;
  return format(s, params);
}

function tS(key){
  const raw = TEXT?.strings?.[key];
  return (typeof raw === "string") ? raw : `[${key}]`;
}

/* =========================
   PAGE DETECTION
========================= */
function hasMenuPage(){
  return !!$("screen_menu") && !!$("scenario_grid");
}

function hasGamePage(){
  return !!$("screen_game") && !!$("scene_title") && !!$("choices");
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
   UI LOADING
========================= */
async function reloadUI(){
  try{
    UI = await fetchJSON(PATHS.ui(LANG));
  }catch{
    LANG = DEFAULT_LANG;
    UI = await fetchJSON(PATHS.ui(DEFAULT_LANG));
  }
  // Important: on ne save() pas ici tout seul,
  // setLang/boot gèrent quand persister.
}

/* =========================
   MENU (index.html)
========================= */
async function loadScenarioMeta(scenarioId){
  try{
    const text = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
    return text.meta || { title: scenarioId, tagline: "" };
  }catch{
    const textFr = await fetchJSON(PATHS.scenarioText(scenarioId, DEFAULT_LANG));
    return textFr.meta || { title: scenarioId, tagline: "" };
  }
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

    const card = document.createElement("button");
    card.className = "scenario_card";
    card.type = "button";

    // cover peut être string OU objet {file, alt}
    const cover = entry.cover || "";
    const coverSrc = (typeof cover === "string") ? cover : (cover && typeof cover === "object" ? (cover.file || "") : "");
    card.style.backgroundImage = coverSrc ? `url('${coverSrc}')` : "none";

    const title = document.createElement("div");
    title.className = "scenario_title";
    title.textContent = meta.title || scenarioId;

    const sub = document.createElement("div");
    sub.className = "scenario_sub";
    sub.textContent = meta.tagline || "";

    card.appendChild(title);
    card.appendChild(sub);

    card.onclick = () => {
      window.location.href = `game.html?s=${encodeURIComponent(scenarioId)}`;
    };

    grid.appendChild(card);
  }
}

/* =========================
   GAME (game.html)
========================= */
function defaultScenarioState(startScene){
  return normalizeScenarioState(null, startScene);
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

function hintKey(sceneId, level){
  const ns = TEXT?.meta?.hint_ns || "hint";
  return `${ns}.${sceneId}.${level}`;
}

function hasHintForScene(sceneId){
  const ns = TEXT?.meta?.hint_ns || "hint";
  const soft = `${ns}.${sceneId}.soft`;
  const strong = `${ns}.${sceneId}.strong`;
  return !!(TEXT?.strings?.[soft] || TEXT?.strings?.[strong]);
}

function updateHintButton(){
  const btn = $("btn_hint");
  if(!btn) return;

  const st = getScenarioState();
  const sceneId = st?.scene;
  const ok = sceneId ? hasHintForScene(sceneId) : false;

  btn.disabled = !ok;
  btn.style.opacity = ok ? "1" : "0.5";
  btn.style.pointerEvents = ok ? "" : "none";
}

let HINT_LEVEL = "soft";

function setHintLevel(level){
  HINT_LEVEL = level;
  if($("hint_soft")) $("hint_soft").classList.toggle("active", level==="soft");
  if($("hint_strong")) $("hint_strong").classList.toggle("active", level==="strong");
  renderHintText(level);
}

function renderHintText(level){
  const st = getScenarioState();
  const sceneId = st?.scene;
  const key = hintKey(sceneId, level);
  const txt = TEXT?.strings?.[key] || tUI("ui.hint_none");
  if($("hint_text")) $("hint_text").textContent = txt;
}

function openHintModal(){
  // si bouton grisé, on ne doit pas ouvrir
  if($("btn_hint") && $("btn_hint").disabled) return;

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

function resolveSceneImage(imageId){
  const im = LOGIC?.images?.[imageId];
  if(!im) return { src: "", alt: "" };

  // compat ancien format: string
  if(typeof im === "string"){
    return { src: im, alt: "" };
  }

  // format pro: {file, alt}
  if(im && typeof im === "object"){
    return {
      src: im.file || "",
      alt: im.alt || ""
    };
  }

  return { src: "", alt: "" };
}

async function openScenario(scenarioId){
  currentScenarioId = scenarioId;
  save();

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));

  try{
    TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  }catch{
    TEXT = await fetchJSON(PATHS.scenarioText(scenarioId, DEFAULT_LANG));
  }

  const start = LOGIC.start_scene || "s01";
  scenarioStates[scenarioId] = normalizeScenarioState(scenarioStates[scenarioId], start);
  save();

  // HUD static
  if($("ui_scenario_name")) $("ui_scenario_name").textContent = TEXT?.meta?.title || scenarioId;

  renderScene();
}

function renderScene(){
  const st = getScenarioState();
  if(!st) return;

  const sceneId = st.scene;
  const sL = LOGIC?.scenes?.[sceneId];

  renderTopbar();

  if(!sL){
    if($("scene_title")) $("scene_title").textContent = tUI("errors.missing_scene");
    if($("scene_body")) $("scene_body").textContent = tUI("errors.missing_scene");
    return;
  }

  // HUD
  if($("ui_step")) $("ui_step").textContent = tUI("ui.step", { n: st.step });
  if($("ui_endings")) $("ui_endings").textContent = tUI("ui.endings_found", { n: countEndings(st), total: 3 });

  // Scene text
  if($("scene_title")) $("scene_title").textContent = tS(sL.title_key);
  if($("scene_body")) $("scene_body").textContent = tS(sL.body_key);

  if($("ui_footer")) $("ui_footer").textContent = tUI("ui.footer");

  // Image
  const img = $("scene_img");
  if(img){
    const imageId = sL.image_id;
    const { src, alt } = resolveSceneImage(imageId);

    if(src){
      img.src = src;
      img.alt = alt || tS(sL.title_key);
      img.style.display = "";
    }else{
      img.removeAttribute("src");
      img.alt = "";
      img.style.display = "none";
      if($("scene_img_fallback")) $("scene_img_fallback").textContent = tUI("ui.no_image");
    }
  }

  // Choices
  const box = $("choices");
  box.innerHTML = "";

  const choices = Array.isArray(sL.choices) ? sL.choices : [];
  for(const ch of choices){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice_btn";
    btn.textContent = tS(ch.choice_key);

    btn.onclick = () => {
      const next = ch.next;
      if(!next) return;

      // Update state
      const nextState = {
        ...st,
        scene: next,
        step: (st.step || 1) + 1
      };

      setScenarioState(nextState);
      renderScene();
    };

    box.appendChild(btn);
  }

  // Hint button + text refresh
  updateHintButton();
  renderHintText(HINT_LEVEL);
}

/* =========================
   LANGUAGE SWITCH UI
========================= */
async function switchLang(){
  // Si ton ui_<lang>.json contient "langs", on s’en sert,
  // sinon on retombe sur SUPPORTED_LANGS
  const supported = (UI?.langs?.map(x => x.id).filter(Boolean) || SUPPORTED_LANGS)
    .filter(id => SUPPORTED_LANGS.includes(id));

  const idx = Math.max(0, supported.indexOf(LANG));
  const next = supported[(idx + 1) % supported.length] || DEFAULT_LANG;

  // Ici on persiste local + remote si userData branché
  await setLang(next, { persistLocal: true, persistRemote: true, rerender: true });
}

/* =========================
   BOOT
========================= */
async function boot(){
  // 1) charge cache local si existe
  loadSave();

  // 2) si aucune langue sauvegardée ou invalide => device
  const base = normalizeLang(LANG);
  if(!base || !SUPPORTED_LANGS.includes(base)){
    LANG = detectDeviceLang();
  }else{
    LANG = base;
  }

  // 3) charge l'UI dans la langue choisie
  await reloadUI();

  // 4) charge catalog
  CATALOG = await fetchJSON(PATHS.catalog);

  // 5) branche boutons topbar
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

  // 6) SYNC SUPABASE (optionnel) :
  // Si userData existe, on récupère la langue profil et on resynchronise.
  // -> ne bloque pas le boot
  if(window.userData && typeof window.userData.init === "function"){
    try{
      await window.userData.init();
      if(typeof window.userData.getLanguage === "function"){
        const remoteLang = await window.userData.getLanguage();
        if(remoteLang){
          await setLang(remoteLang, { persistLocal: true, persistRemote: false, rerender: true });
        }
      }
    }catch(e){
      // ignore: offline / pas configuré
    }
  }

  // 7) Render page
  if(hasMenuPage()){
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

  // fallback
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
