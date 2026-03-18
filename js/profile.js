// js/profile.js
// Profil VChoice (v3.2) — PROFILES-ONLY
// - Scénarios EN DUR
// - Fix pseudo (i18n ne réécrit plus le texte)
// - Scénarios en 1 colonne
// - UI sans encadrés sur bloc profil + pills
// - Assigne un pseudo automatique si manquant (tentative en base, sinon fallback local)
//
// ✅ PATCH LOCAL-FIRST BADGES + BFCache:
// - badges d'abord via cache local vchoice_endings_cache_v1
// - rerender sur pageshow/visibilitychange/vc:profile/vc:endings_updated
//
// ✅ IMPORTANT:
// - plus AUCUNE requête sur scenario_status / scenario_endings
// - les badges viennent UNIQUEMENT de profiles.endings via VUserData.load() (secure_get_me)

(function(){
  "use strict";

  const ENDINGS_CACHE_KEY = "vchoice_endings_cache_v1";

  // ✅ IDs EXACTS (d'après ton dossier assets/scenarios/)
  const SCENARIO_IDS = [
    "bunker_reserve",
    "chateau_absents",
    "dossier14_appartement",
    "foret_relais",
    "hopital_ferme",
    "metro_station_zero",
    "styx_gare",
    "temple_mictlan"
  ];

  function $(id){ return document.getElementById(id); }
  function _safeParse(raw){ try { return JSON.parse(raw); } catch { return null; } }
  function _now(){ return Date.now(); }
  function _norm(x){ return String(x || "").trim().toLowerCase(); }

  function readEndingsCache(){
    const raw = localStorage.getItem(ENDINGS_CACHE_KEY);
    const o = _safeParse(raw);
    if (!o || typeof o !== "object") return null;
    if (!o.user_id) return null;
    if (!o.map || typeof o.map !== "object") return null;
    return o;
  }

  function writeEndingsCache(userId, map){
    try{
      localStorage.setItem(ENDINGS_CACHE_KEY, JSON.stringify({
        user_id: String(userId || ""),
        ts: _now(),
        map: map || {}
      }));
    }catch(_){}
  }

  // Convertit profiles.endings (jsonb) -> map attendu par le renderer
  // endings JSON exemple:
  // {
  //   "bunker_reserve": { "good": true, "bad": false, "secret": false },
  //   "styx_gare": { "good": false, "bad": true, "secret": true }
  // }
  function endingsJsonToMap(endings){
    const map = {};
    if (!endings || typeof endings !== "object") return map;

    for (const key of Object.keys(endings)){
      const sid = _norm(key);
      if (!sid) continue;
      const v = endings[key] || {};
      map[sid] = {
        good:   !!v.good,
        bad:    !!v.bad,
        secret: !!v.secret
      };
    }
    return map;
  }

  async function fetchEndingsFromProfiles(){
    // 1) state local
    const st0 = window.VUserData?.load?.() || {};
    const uid0 = String(st0.user_id || "");
    const map0 = endingsJsonToMap(st0.endings);

    // si déjà ok
    if (uid0 && Object.keys(map0).length > 0){
      return { uid: uid0, map: map0 };
    }

    // 2) tente refresh pour récupérer profiles.endings via secure_get_me
    if (uid0 && window.VUserData?.refresh){
      try{ await window.VUserData.refresh(); }catch(_){}
      const st1 = window.VUserData?.load?.() || {};
      const uid1 = String(st1.user_id || uid0);
      const map1 = endingsJsonToMap(st1.endings);
      return { uid: uid1, map: map1 };
    }

    return { uid: uid0, map: map0 };
  }

  function endingIconPaths(){
    return {
      good:   { empty: "assets/img/ui/ending_good_empty.webp",   full: "assets/img/ui/ending_good_full.webp" },
      bad:    { empty: "assets/img/ui/ending_bad_empty.webp",    full: "assets/img/ui/ending_bad_full.webp" },
      secret: { empty: "assets/img/ui/ending_secret_empty.webp", full: "assets/img/ui/ending_secret_full.webp" }
    };
  }

  function renderScenarios(ids, unlockedList, endingsMap){
    const host = $("pf_scenarios");
    if (!host) return;
    host.innerHTML = "";

    const unlocked = new Set((unlockedList || []).map(_norm).filter(Boolean));
    const icons = endingIconPaths();

    for (const rawId of (ids || [])){
      const id = String(rawId || "").trim();
      const sid = id.toLowerCase();
      if (!id) continue;

      const isUnlocked = unlocked.has(sid);
      const st = endingsMap?.[sid] || { good:false, bad:false, secret:false };

      const card = document.createElement("div");
      card.className = "vc-scen-card" + (isUnlocked ? "" : " is-locked");

      const inner = document.createElement("div");
      inner.className = "vc-scen-inner";

      const name = document.createElement("h3");
      name.className = "vc-scen-name";
      name.setAttribute("data-i18n", `scenarios.${id}.title`);
      inner.appendChild(name);

      const ends = document.createElement("div");
      ends.className = "vc-scen-ends";

      for (const key of ["good","bad","secret"]){
        const box = document.createElement("div");
        const done = !!st?.[key];
        box.className = "vc-end" + (done ? " unlocked" : "");

        const imgEmpty = document.createElement("img");
        imgEmpty.className = "empty";
        imgEmpty.alt = "";
        imgEmpty.src = icons[key].empty;

        const imgFull = document.createElement("img");
        imgFull.className = "full";
        imgFull.alt = "";
        imgFull.src = icons[key].full;

        box.appendChild(imgEmpty);
        box.appendChild(imgFull);
        ends.appendChild(box);
      }

      inner.appendChild(ends);
      card.appendChild(inner);
      host.appendChild(card);
    }

    try { window.VRI18n?.applyI18n?.(host); } catch(_){}
  }

  function setMsg(type, key, vars){
    const el = $("pf_msg");
    if (!el) return;
    el.classList.remove("ok","err");
    el.classList.add(type === "ok" ? "ok" : "err");
    const txt = window.VRI18n?.t?.(key, "", vars) || "";
    el.textContent = txt;
    el.style.display = txt ? "block" : "none";
  }

  function isValidUsername(u){
    const s = String(u || "").trim();
    if (s.length < 3 || s.length > 20) return false;
    return /^[a-zA-Z0-9_]+$/.test(s);
  }

  function genRandomUsername(){
    const n = Math.floor(1000 + Math.random() * 9000);
    return `User_${n}`;
  }

  async function ensureDefaultUsernameIfMissing(){
    const st = window.VUserData?.load?.() || {};
    const uid = String(st.user_id || "");
    const cur = String(st.username || "").trim();
    if (!uid) return;

    if (cur) return;

    const textEl = $("pf_username_text");
    if (textEl) textEl.textContent = (window.VRI18n?.t?.("ui.profile_username_missing") || "—");

    for (let i=0; i<8; i++){
      const candidate = genRandomUsername();
      const r = await window.VCRemoteStore?.setUsername?.(candidate);

      if (r === undefined) return;
      if (r && r.ok){
        try{ await window.VUserData?.refresh?.(); }catch(_){}
        return;
      }
    }
  }

  function openEdit(open){
    const wrap = $("pf_edit_wrap");
    if (!wrap) return;
    if (open) wrap.classList.add("is-open");
    else wrap.classList.remove("is-open");
  }

  async function handleSaveUsername(){
    const inp = $("pf_username_input");
    if (!inp) return;

    const next = String(inp.value || "").trim();
    if (!isValidUsername(next)){
      setMsg("err", "ui.profile_username_err_format");
      return;
    }

    const curState = window.VUserData?.load?.() || {};
    const cur = String(curState.username || "").trim();
    const uid = String(curState.user_id || "");
    if (!uid){
      setMsg("err", "ui.profile_err_not_ready");
      return;
    }
    if (cur === next){
      setMsg("ok", "ui.profile_username_ok_nochange");
      openEdit(false);
      return;
    }

    const flagKey = `vchoice_username_changed_once_${uid}`;
    const alreadyChanged = localStorage.getItem(flagKey) === "1";
    const needCost = !!alreadyChanged;

    if (needCost){
      const jet = Number((window.VUserData?.load?.() || {}).jetons ?? 0);
      if (jet < 1){
        setMsg("err", "ui.profile_username_err_nojeton");
        return;
      }
    }

    const saveBtn = $("pf_save");
    if (saveBtn) saveBtn.disabled = true;
    setMsg("ok", "ui.profile_username_working");

    try{
      const r = await window.VCRemoteStore?.setUsername?.(next);
      if (!r || !r.ok){
        const reason = r?.reason || "rpc_error";
        if (reason === "taken") setMsg("err", "ui.profile_username_err_taken");
        else setMsg("err", "ui.profile_username_err_generic");
        return;
      }

      if (needCost){
        const spent = await window.VCRemoteStore?.spendJetons?.(1);
        if (spent === null){
          setMsg("err", "ui.profile_username_err_cost_failed");
        }
      } else {
        try{ localStorage.setItem(flagKey, "1"); }catch(_){}
      }

      try{ await window.VUserData?.refresh?.(); }catch(_){}
      setMsg("ok", "ui.profile_username_ok_saved");
      openEdit(false);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function renderProfileFromState(){
    const st = window.VUserData?.load?.() || {};
    const jet = Number(st.jetons ?? 0);
    const vc = Number(st.vcoins ?? 0);
    const un = String(st.username || "").trim();

    const jetEl = $("pf_jetons");
    const vcEl = $("pf_vcoins");
    if (jetEl) jetEl.textContent = String(jet);
    if (vcEl) vcEl.textContent = String(vc);

    const textEl = $("pf_username_text");
    if (textEl){
      textEl.textContent = un || (window.VRI18n?.t?.("ui.profile_username_missing") || "—");
    }
  }

  async function refreshEndingsOnce(){
    const st = window.VUserData?.load?.() || {};
    const uid = String(st.user_id || "");
    const unlocked = window.VUserData?.getUnlockedScenarios?.() || [];
    const ids = SCENARIO_IDS.slice();

    // cache local
    const cache = readEndingsCache();
    const cacheOk = !!(cache && cache.user_id === uid && cache.map);

    if (cacheOk){
      renderScenarios(ids, unlocked, cache.map || {});
      return;
    }

    if (!uid){
      if (cache && cache.map) {
        renderScenarios(ids, unlocked, cache.map || {});
        return;
      }
      renderScenarios(ids, unlocked, {});
      return;
    }

    try{
      const r = await fetchEndingsFromProfiles();
      const endingsMap = r?.map || {};
      writeEndingsCache(uid, endingsMap);
      renderScenarios(ids, unlocked, endingsMap);
    }catch(e){
      console.error("[fetchEndingsFromProfiles]", e);
      renderScenarios(ids, unlocked, {});
    }
  }

  let _refreshEndingsRunning = false;
  async function refreshEndingsSafe(){
    if (_refreshEndingsRunning) return;
    _refreshEndingsRunning = true;
    try{ await refreshEndingsOnce(); }
    finally{ _refreshEndingsRunning = false; }
  }

  async function boot(){
    try{
      const langEarly = window.VRI18n?.getLang?.() || "fr";
      await window.VRI18n?.initI18n?.(langEarly);
    }catch(e){ console.error("[i18n]", e); }

    try{ await window.bootstrapAuthAndProfile?.(); }catch(e){ console.error("[bootstrapAuthAndProfile]", e); }

    try{
      const p = window.VUserData?.init?.();
      if (p && typeof p.then === "function") await p;
    }catch(e){ console.error("[VUserData.init]", e); }

    renderProfileFromState();

    try{ await ensureDefaultUsernameIfMissing(); }catch(e){ console.error("[ensureDefaultUsernameIfMissing]", e); }
    renderProfileFromState();

    const toggle = $("pf_edit_toggle");
    const cancel = $("pf_cancel");
    const save = $("pf_save");

    if (toggle) toggle.addEventListener("click", () => {
      const wrap = $("pf_edit_wrap");
      const open = !(wrap && wrap.classList.contains("is-open"));
      openEdit(open);

      const st = window.VUserData?.load?.() || {};
      const cur = String(st.username || "").trim();
      const inp = $("pf_username_input");
      if (open && inp){
        inp.value = cur || "";
        inp.focus();
      }
    });

    if (cancel) cancel.addEventListener("click", () => {
      setMsg("ok", "", null);
      openEdit(false);
    });

    if (save) save.addEventListener("click", handleSaveUsername);

    window.addEventListener("vc:profile", () => {
      renderProfileFromState();
      refreshEndingsSafe();
    });

    window.addEventListener("vc:endings_updated", () => {
      refreshEndingsSafe();
    });

    window.addEventListener("pageshow", () => {
      renderProfileFromState();
      refreshEndingsSafe();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible"){
        renderProfileFromState();
        refreshEndingsSafe();
      }
    });

    await refreshEndingsSafe();
  }

  boot();
})();