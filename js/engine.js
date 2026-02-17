/* =========================
   CONFIG
========================= */
const SAVE_KEY = "creepy_engine_save_v1";
const UI_PATH = "data/ui/ui_fr.json"; // UI de base FR (tu peux le rendre dynamique si tu veux)
const SUPPORTED_LANGS = ["fr","en","de","es","it","nl","pt"];

const PATHS = {
  catalog: () => `data/scenarios/catalog.json`,
  scenarioLogic: (scenarioId) => `data/scenarios/${scenarioId}/logic.json`,
  scenarioText:  (scenarioId, lang) => `data/scenarios/${scenarioId}/text_${lang}.json`,
};

let UI = {};
let CATALOG = null;

let LANG = "fr";
let LOGIC = null;
let TEXT = null;
let TEXT_STRINGS = null;

let currentScenarioId = null;

// Scenario progress saved per scenario_id
let scenarioStates = {};

/* =========================
   SMALL HELPERS
========================= */
function $(id){ return document.getElementById(id); }

async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error(`fetch failed: ${url} (${r.status})`);
  return await r.json();
}

function deepGet(obj, path){
  try{
    const parts = String(path||"").split(".");
    let cur = obj;
    for(const p of parts){
      if(cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }catch(e){ return undefined; }
}

function format(str, params){
  if(!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (_,k) => (params[k] ?? `{${k}}`));
}

function normalizeLang(l){
  const s = String(l||"").trim().toLowerCase();
  if(!s) return "fr";
  if(s.startsWith("fr")) return "fr";
  if(s.startsWith("en")) return "en";
  if(s.startsWith("de")) return "de";
  if(s.startsWith("es")) return "es";
  if(s.startsWith("it")) return "it";
  if(s.startsWith("nl")) return "nl";
  if(s.startsWith("pt")) return "pt";
  return "fr";
}

function detectDeviceLang(){
  try{
    const nav = (navigator.language || "fr");
    const base = normalizeLang(nav);
    return SUPPORTED_LANGS.includes(base) ? base : "fr";
  }catch(e){ return "fr"; }
}

/* =========================
   LOGIC HELPERS
========================= */
function resolveStartScene(logic){
  if(!logic) return null;
  return logic.start_scene || "s01";
}

function resolveSceneObject(logic, sceneId){
  if(!logic || !logic.scenes) return null;
  return logic.scenes[sceneId] || null;
}

function isChoiceAvailable(choice){
  // supports:
  // requires_all_flags, requires_any_flags (arrays)
  const st = scenarioStates[currentScenarioId];
  const flags = (st && st.flags) ? st.flags : {};

  const all = choice.requires_all_flags || [];
  const any = choice.requires_any_flags || [];

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
   RESUME / END MODALS
========================= */
function isEndingSceneId(sceneId){
  const s = String(sceneId || "").toLowerCase();
  return s === "end_good" || s === "end_bad" || s === "end_secret";
}
function endingTypeFromSceneId(sceneId){
  const s = String(sceneId || "").toLowerCase();
  if(s === "end_good") return "good";
  if(s === "end_bad") return "bad";
  if(s === "end_secret") return "secret";
  return null;
}

function resetScenarioState(scenarioId){
  const st = scenarioStates[scenarioId];
  if(!st) return;
  st.scene = resolveStartScene(LOGIC);
  st.flags = {};
  st.clues = [];
  st.end_awarded_for = null;
  save();
}

function showModal(modalId){
  const modal = $(modalId);
  if(!modal) return false;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  return true;
}
function hideModal(modalId){
  const modal = $(modalId);
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function bindSimpleModal(modalId, closeId, backdropId){
  const close = $(closeId);
  const back  = $(backdropId);
  if(close) close.onclick = () => hideModal(modalId);
  if(back)  back.onclick  = () => hideModal(modalId);
}

function askResumeOrRestart(){
  return new Promise((resolve) => {
    const modalOk = showModal("resumeModal");
    if(!modalOk) return resolve("continue");

    bindSimpleModal("resumeModal","resumeClose","resumeBackdrop");

    const title = $("resumeTitle");
    const body  = $("resumeBody");
    const bRestart = $("btnResumeRestart");
    const bCont    = $("btnResumeContinue");

    if(title) title.textContent = tUI("resume_title");
    if(body)  body.textContent  = tUI("resume_body");

    if(bRestart) bRestart.textContent = tUI("btn_restart");
    if(bCont)    bCont.textContent    = tUI("btn_continue");

    const done = (v) => {
      hideModal("resumeModal");
      resolve(v);
    };

    if(bRestart) bRestart.onclick = () => done("restart");
    if(bCont)    bCont.onclick    = () => done("continue");
  });
}

function showEndingModal(ending, reward){
  const modalOk = showModal("endModal");
  if(!modalOk) return;

  bindSimpleModal("endModal","endClose","endBackdrop");

  const t = $("endTitle");
  const b = $("endBody");
  const bb = $("btnEndBack");
  const br = $("btnEndReplay");

  const titleKey = ending === "good" ? "end_title_good" : ending === "bad" ? "end_title_bad" : "end_title_secret";
  if(t) t.textContent = tUI(titleKey);
  if(b) b.textContent = tUI("end_body", { reward: String(reward ?? 300) });

  if(bb) bb.textContent = tUI("btn_back");
  if(br) br.textContent = tUI("btn_restart");
}

/* =========================
   SAVE/LOAD
========================= */
function load(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(!data || typeof data !== "object") return;

    const lang = normalizeLang(data.lang || "");
    if(lang) LANG = lang;

    if(data.scenarioStates && typeof data.scenarioStates === "object"){
      scenarioStates = data.scenarioStates;
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
  return !!$("screen_game");
}

async function reloadUI(){
  UI = await fetchJSON(UI_PATH);
}

async function loadCatalog(){
  CATALOG = await fetchJSON(PATHS.catalog());
}

async function setLang(lang, opts){
  const v = normalizeLang(lang);
  if(!SUPPORTED_LANGS.includes(v)) return;
  LANG = v;

  if(opts && opts.persistLocal){
    save();
  }

  if(opts && opts.persistRemote){
    if(window.VUserData && typeof window.VUserData.setLanguage === "function"){
      try{ await window.VUserData.setLanguage(v); }catch(e){}
    }
  }

  // reload current scenario text if in game
  if(hasGamePage() && currentScenarioId){
    TEXT = await fetchJSON(PATHS.scenarioText(currentScenarioId, LANG));
    TEXT_STRINGS = (TEXT && typeof TEXT === "object" && TEXT.strings && typeof TEXT.strings === "object")
      ? TEXT.strings
      : null;
  }

  if(opts && opts.rerender){
    if(hasMenuPage()) await renderMenu();
    if(hasGamePage()) renderScene();
    renderTopbar();
  }
}

async function boot(){
  load();

  let initialLang = LANG;

  if(window.userData && typeof window.userData.getLanguage === "function"){
    try{
      const remoteLang = await window.userData.getLanguage();
      const base = normalizeLang(remoteLang);
      if(base && SUPPORTED_LANGS.includes(base)) initialLang = base;
    }catch(e){
      // ignore
    }
  }else if(window.VUserData && typeof window.VUserData.getLanguage === "function"){
    try{
      const base = normalizeLang(window.VUserData.getLanguage());
      if(base && SUPPORTED_LANGS.includes(base)) initialLang = base;
    }catch(e){ /* ignore */ }
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
      // NOTE: load() a déjà rempli scenarioStates depuis localStorage
      const hadSaveBefore = !!scenarioStates[scenarioId];
      const savedSceneBefore = scenarioStates[scenarioId]?.scene;

      await openScenario(scenarioId);

      const start = resolveStartScene(LOGIC);
      const hasProgress = hadSaveBefore && savedSceneBefore && savedSceneBefore !== start;

      if(hasProgress){
        const choice = await askResumeOrRestart();
        if(choice === "restart"){
          resetScenarioState(scenarioId);
        }
      }

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
  const txt = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));
  // meta est bien présent dans tes JSON, mais on garde un fallback
  // au cas où tu aies seulement strings["xxx.title"] plus tard.
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

    metaBox.appendChild(title);
    metaBox.appendChild(sub);

    card.appendChild(cover);
    card.appendChild(metaBox);

    grid.appendChild(card);
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
  // ✅ Compat avec tes JSON actuels:
  // text_<lang>.json = { meta: {...}, strings: { "x.y.z": "..." } }
  // => on doit lire TEXT_STRINGS[key] (et non deepGet(TEXT, key))
  let v;

  if(TEXT_STRINGS && Object.prototype.hasOwnProperty.call(TEXT_STRINGS, key)){
    v = TEXT_STRINGS[key];
  }else{
    v = deepGet(TEXT, key);
  }

  if(v == null) v = `[${key}]`;
  return params ? format(v, params) : v;
}

/* =========================
   GAME (game.html)
========================= */
async function openScenario(scenarioId){
  currentScenarioId = scenarioId;

  LOGIC = await fetchJSON(PATHS.scenarioLogic(scenarioId));
  TEXT  = await fetchJSON(PATHS.scenarioText(scenarioId, LANG));

  // ✅ compat TEXT.strings
  TEXT_STRINGS = (TEXT && typeof TEXT === "object" && TEXT.strings && typeof TEXT.strings === "object")
    ? TEXT.strings
    : null;

  // init state if missing
  if(!scenarioStates[scenarioId]){
    const start = resolveStartScene(LOGIC);
    scenarioStates[scenarioId] = {
      scene: start,
      flags: {},
      clues: [],
      end_awarded_for: null,
    };
  } else {
    // si un scénario a été sauvegardé avec scene undefined (ancien bug), on répare
    if(!scenarioStates[scenarioId].scene){
      scenarioStates[scenarioId].scene = resolveStartScene(LOGIC);
    }
    scenarioStates[scenarioId].flags ??= {};
    scenarioStates[scenarioId].clues ??= [];
    scenarioStates[scenarioId].end_awarded_for ??= null;
  }

  save();
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
  if(!scene){
    // fallback: si scene inexistante, on recolle sur start_scene
    st.scene = resolveStartScene(LOGIC);
    save();
    return renderScene();
  }

  const titleEl = $("sceneTitle");
  const bodyEl  = $("sceneBody");
  const imgEl   = $("sceneImg");
  const imgSourceEl = $("scene_img_source");

  if(titleEl) titleEl.textContent = tS(scene.title_key || "");
  if(bodyEl)  bodyEl.textContent  = tS(scene.body_key || "");

  // image
  if(imgEl && LOGIC && LOGIC.images && scene.image_id){
    const im = LOGIC.images[scene.image_id];
    if(im && im.file){
      imgEl.src = `assets/scenarios/${currentScenarioId}/img/${im.file}`;
    }
  }

  if(imgSourceEl){
    imgSourceEl.textContent = "";
  }

  // --- ENDING detection ---
  const endingType = endingTypeFromSceneId(st.scene);
  if(endingType){
    // pas de boutons de choix sur une fin
    const choicesBox = $("choices");
    if(choicesBox) choicesBox.innerHTML = "";

    const reward = 300;
    showEndingModal(endingType, reward);

    const doAwardAndReset = async (goBackToMenu) => {
      try{
        if(st.end_awarded_for !== st.scene){
          if(window.VUserData && typeof window.VUserData.completeScenario === "function"){
            await window.VUserData.completeScenario(currentScenarioId, endingType);
          } else if(window.sb){
            await window.sb.rpc("secure_complete_scenario", { p_scenario: currentScenarioId, p_ending: endingType });
          }
          st.end_awarded_for = st.scene;
          save();
        }
      }catch(e){
        // on affiche un warning, mais on laisse le joueur continuer
        const endBody = $("endBody");
        if(endBody){
          const msg = tUI("end_err_save");
          endBody.textContent = tUI("end_body", { reward: String(reward) }) + "\n\n" + msg;
        }
      }

      // reset local state (retour à 0)
      resetScenarioState(currentScenarioId);

      hideModal("endModal");
      if(goBackToMenu){
        location.href = "index.html";
      }else{
        renderScene();
      }
    };

    const btnBack = $("btnEndBack");
    const btnReplay = $("btnEndReplay");
    if(btnBack) btnBack.onclick = () => doAwardAndReset(true);
    if(btnReplay) btnReplay.onclick = () => doAwardAndReset(false);

    return;
  }

  const choicesEl = $("choices");
  const hintBtn = $("btnHint");

  if(choicesEl) choicesEl.innerHTML = "";

  // bind hint button if exists
  if(hintBtn){
    hintBtn.onclick = () => {
      // optional hint: first clue not found
      const clueList = (LOGIC && LOGIC.clues) ? LOGIC.clues : {};
      const clueIds = Object.keys(clueList);
      if(!clueIds.length){
        showHintModal(tUI("hint_title"), "");
        return;
      }
      const first = clueIds[0];
      const c = clueList[first];
      const text = c ? (c.text_key ? tS(c.text_key) : (c.text || "")) : "";
      showHintModal(tUI("hint_title"), text);
    };
  }

  // choices
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  if(choicesEl){
    for(const ch of choices){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice_btn";
      btn.textContent = tS(ch.choice_key || "");
      btn.disabled = false;

      // locked by flags
      const available = isChoiceAvailable(ch);
      if(!available){
        btn.disabled = true;
        btn.classList.add("is_locked");
      }

      btn.onclick = () => {
        if(btn.disabled) return;

        // apply side effects: set_flags, add_clues
        if(Array.isArray(ch.set_flags)){
          for(const f of ch.set_flags) setFlag(f);
        }
        if(Array.isArray(ch.add_clues)){
          for(const c of ch.add_clues) addClue(c);
        }

        // move
        if(ch.next){
          st.scene = ch.next;
          save();
          renderScene();
        }else{
          showHintModal(tUI("hint_title") || "Info", "Ce choix ne mène nulle part pour l’instant.");
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
