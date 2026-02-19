// js/profile.js
// Profil VChoice
// - Affiche jetons/vcoins + pseudo (update via RPC secure_set_username)
// - Liste scénarios (2 colonnes) + 3 fins (good/bad/secret) en "jauge" (empty + full superposés)
// - Cache local des fins pour limiter la bande passante : lecture Supabase seulement si cache absent ou refresh manuel.

(function(){
  "use strict";

  const ENDINGS_CACHE_KEY = "vchoice_endings_cache_v1";

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

  async function loadCatalog(){
    const r = await fetch("data/scenarios/catalog.json", { cache: "no-store" });
    if (!r.ok) throw new Error("catalog_not_found");
    const data = await r.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data?.scenarios) ? data.scenarios : []);
    const ids = [];
    for (const it of list){
      const id = String(it?.id || it?.scenario_id || "").trim();
      if (id) ids.push(id);
    }
    return ids;
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
    }catch(_){ }

    // 2) fallback scenario_endings
    try{
      const r = await sb
        .from("scenario_endings")
        .select("scenario_id,ending")
        .eq("user_id", userId);
      if (r?.error) throw r.error;
      const map = {};
      for (const row of (r?.data || [])){
        const sid = String(row?.scenario_id || "").trim().toLowerCase();
        const e = String(row?.ending || "").trim().toLowerCase();
        if (!sid) continue;
        if (!map[sid]) map[sid] = { good:false, bad:false, secret:false };
        if (e === "good") map[sid].good = true;
        if (e === "bad") map[sid].bad = true;
        if (e === "secret") map[sid].secret = true;
      }
      return map;
    }catch(e){
      throw e;
    }
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

  async function handleSaveUsername(){
    const inp = $("pf_username");
    if (!inp) return;
    const next = String(inp.value || "").trim();

    if (!isValidUsername(next)){
      setMsg("err", "ui.profile_username_err_format");
      return;
    }

    const curState = window.VUserData?.load?.() || {};
    const cur = String(curState.username || "");
    const uid = String(curState.user_id || "");
    if (!uid){
      setMsg("err", "ui.profile_err_not_ready");
      return;
    }
    if (String(cur).trim() === next){
      setMsg("ok", "ui.profile_username_ok_nochange");
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

    const btn = $("pf_save");
    if (btn) btn.disabled = true;
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
        try{ localStorage.setItem(flagKey, "1"); }catch(_){ }
      }

      try{ await window.VUserData?.refresh?.(); }catch(_){ }
      setMsg("ok", "ui.profile_username_ok_saved");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function refreshEndings(force){
    const st = window.VUserData?.load?.() || {};
    const uid = String(st.user_id || "");
    const unlocked = window.VUserData?.getUnlockedScenarios?.() || [];

    let ids = [];
    try{ ids = await loadCatalog(); }catch(e){ console.error("[catalog]", e); }

    let endingsMap = {};
    const cache = readEndingsCache();
    const cacheOk = !!(cache && cache.user_id === uid && cache.map);
    if (!force && cacheOk){
      endingsMap = cache.map || {};
      renderScenarios(ids, unlocked, endingsMap);
      return;
    }

    if (!uid){
      renderScenarios(ids, unlocked, endingsMap);
      return;
    }

    try{
      endingsMap = await fetchEndingsFromSupabase(uid);
      writeEndingsCache(uid, endingsMap);
    }catch(e){
      console.error("[fetchEndings]", e);
      if (cacheOk) endingsMap = cache.map || {};
    }

    renderScenarios(ids, unlocked, endingsMap);
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

    window.addEventListener("vc:profile", (ev) => {
      const d = ev?.detail || {};
      const jet = Number(d.jetons ?? 0);
      const vc = Number(d.vcoins ?? 0);
      const un = String(d.username || "");

      const jetEl = $("pf_jetons");
      const vcEl = $("pf_vcoins");
      if (jetEl) jetEl.textContent = String(jet);
      if (vcEl) vcEl.textContent = String(vc);

      const inp = $("pf_username");
      if (inp && !inp.value) inp.value = un;
    });

    const saveBtn = $("pf_save");
    if (saveBtn) saveBtn.addEventListener("click", handleSaveUsername);

    const refBtn = $("pf_refresh");
    if (refBtn) refBtn.addEventListener("click", async () => {
      await refreshEndings(true);
    });

    await refreshEndings(false);
  }

  boot();
})();
