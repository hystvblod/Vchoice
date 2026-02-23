// js/profile.js
// Profil VChoice (v3.1)
// - Scénarios EN DUR (plus de catalog.json)
// - Fix pseudo (i18n ne réécrit plus le texte)
// - Scénarios en 1 colonne
// - UI sans encadrés sur bloc profil + pills
// - Assigne un pseudo automatique si manquant (tentative en base, sinon fallback local)
//
// ✅ PATCH LOCAL-FIRST BADGES + BFCache:
// - badges d'abord via cache local vchoice_endings_cache_v1
// - rerender sur pageshow/visibilitychange/vc:profile/vc:endings_updated

(function(){
  "use strict";

  const ENDINGS_CACHE_KEY = "vchoice_endings_cache_v1";

  // ✅ IDs EXACTS (d'après ton dossier assets/scenarios/)
  // (On garde le même ordre que ta capture)
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
    }catch(_){ }
  }

  function normalizeStatusRow(row){
    const sid = String(row?.scenario_id || row?.scenario || "").trim().toLowerCase();
    if (!sid) return null;
    return {
      scenario_id: sid,
      good: !!row?.good_done,
      bad: !!row?.bad_done,
      secret: !!row?.secret_done
    };
  }

  function buildStatusMap(rows){
    const map = {};
    for (const r of (rows || [])){
      const n = normalizeStatusRow(r);
      if (!n) continue;
      map[n.scenario_id] = { good: n.good, bad: n.bad, secret: n.secret };
    }
    return map;
  }

  async function fetchEndingsFromSupabase(userId){
    const sb = window.sb;
    if (!sb) throw new Error("no_sb");

    if (window.VCRemoteStore?.ensureAuth) {
      await window.VCRemoteStore.ensureAuth();
    }

    // 1) scenario_status
    try{
      const r = await sb
        .from("scenario_status")
        .select("scenario_id,good_done,bad_done,secret_done")
        .eq("user_id", userId);
      if (!r?.error && Array.isArray(r?.data)) {
        return buildStatusMap(r.data);
      }
    }catch(_){}

    // 2) scenario_endings
    const r = await sb
      .from("scenario_endings")
      .select("scenario_id,good_done,bad_done,secret_done")
      .eq("user_id", userId);
    if (r?.error) throw r.error;
    return buildStatusMap(r?.data || []);
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

    const unlocked = new Set((unlockedList || []).map(x => String(x||"").trim().toLowerCase()).filter(Boolean));
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

    try { window.VRI18n?.applyI18n?.(host); } catch(_){ }
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

  // ✅ pseudo auto (sera TENTÉ d’être écrit dans Supabase via VCRemoteStore.setUsername)
  function genRandomUsername(){
    const n = Math.floor(1000 + Math.random() * 9000);
    return `User_${n}`;
  }

  async function ensureDefaultUsernameIfMissing(){
    const st = window.VUserData?.load?.() || {};
    const uid = String(st.user_id || "");
    const cur = String(st.username || "").trim();
    if (!uid) return;

    // Déjà un pseudo => OK
    if (cur) return;

    // Si VUserData a un fallback local, on l’affiche tout de suite, mais on tente quand même la base
    const textEl = $("pf_username_text");
    if (textEl) textEl.textContent = (window.VRI18n?.t?.("ui.profile_username_missing") || "—");

    // Tentatives d’écriture en base (gère collisions via index unique lower(username))
    for (let i=0; i<8; i++){
      const candidate = genRandomUsername();
      const r = await window.VCRemoteStore?.setUsername?.(candidate);

      // si setUsername n’existe pas, on ne peut rien faire côté base
      if (r === undefined) return;

      if (r && r.ok){
        try{ await window.VUserData?.refresh?.(); }catch(_){}
        return;
      }
      // si "taken" => on retente
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

    const cache = readEndingsCache();
    const cacheOk = !!(cache && cache.user_id === uid && cache.map);

    if (cacheOk){
      renderScenarios(ids, unlocked, cache.map || {});
      return;
    }

    if (!uid){
      // ✅ local-first: si on a un cache (même sans uid prêt), on l'affiche
      if (cache && cache.map) {
        renderScenarios(ids, unlocked, cache.map || {});
        return;
      }
      renderScenarios(ids, unlocked, {});
      return;
    }

    try{
      // ✅ backup uniquement si local introuvable
      const endingsMap = await fetchEndingsFromSupabase(uid);
      writeEndingsCache(uid, endingsMap);
      renderScenarios(ids, unlocked, endingsMap);
    }catch(e){
      console.error("[fetchEndings]", e);
      renderScenarios(ids, unlocked, {});
    }
  }

  // ✅ IMPORTANT: la page peut revenir via history.back() (BFCache) => on doit rerender les badges
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

    // ✅ Affiche immédiatement
    renderProfileFromState();

    // ✅ Pseudo auto si manquant
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
      // ✅ si user_id arrive un peu après, on refresh les badges
      refreshEndingsSafe();
    });

    // ✅ maj badges si le cache local bouge (même page)
    window.addEventListener("vc:endings_updated", () => {
      refreshEndingsSafe();
    });

    // ✅ retour via history.back() (souvent BFCache) : rerender sûr
    window.addEventListener("pageshow", () => {
      renderProfileFromState();
      refreshEndingsSafe();
    });

    // ✅ quand on revient sur l'onglet/app
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