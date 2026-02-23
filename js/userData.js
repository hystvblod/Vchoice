// js/userData.js — VERSION COMPLETE À JOUR (lang device early + sync Supabase + local unlock cache "pour toujours")
// VChoice — Local cache + Supabase RPCs (source of truth)
// - Profil via RPC secure_get_me
// - Solde via RPC: secure_add_vcoins / secure_add_jetons / secure_spend_jetons / secure_reduce_vcoins_to
// - Username via secure_set_username
// - Lang via secure_set_lang
// - Déblocage scénario via secure_unlock_scenario
// - Fin scénario: secure_complete_scenario (reward + log ending)
//
// ✅ PATCH 2026-02-23:
// - Les scénarios débloqués sont "acquis pour toujours" côté local (cache dédié)
// - Un refresh au lancement ne peut JAMAIS re-verrouiller un scénario déjà en local (merge/union uniquement)
// - isScenarioUnlocked() fallback localStorage même si init pas encore fini (moins de flicker cadenas)
//
// ✅ PATCH 2026-02-23 (suite):
// - Support RPC Supabase qui renvoie ARRAY (setof) OU objet (json/row) -> plus de cadenas fantôme
// - Packs premium/diamond/no_ads = local OR remote (jamais shrink) pour éviter re-blocage offline/latence
// - no_ads coupe uniquement les interstitials (rewarded reste volontaire)

(function () {
  "use strict";

  const VUserDataKey = "vchoice_user_data";
  const LangStorageKey = "vchoice_lang";

  // ✅ Cache endings (même clé/format que profile.js)
  const ENDINGS_CACHE_KEY = "vchoice_endings_cache_v1";

  // ✅ Cache scénarios débloqués "pour toujours" (scopé user_id)
  const UNLOCKED_CACHE_KEY = "vchoice_unlocked_cache_v1";

  // ✅ Langs supportées côté app (device -> local -> supabase)
  const SUPPORTED_LANGS = ["fr","en","de","es","pt","ptbr","it","ko","ja"];

  let _uiPaused = true;
  let _pendingEmit = false;

  // ✅ init guard (évite double init sur certaines pages)
  let _initPromise = null;

  // ✅ queue remote (évite RPC simultanés)
  let _remoteQueue = Promise.resolve();

  // ✅ évite double prime local
  let _primedLocal = false;

  // ======= utils =======
  function _now(){ return Date.now(); }

  function _safeParse(raw){
    try{ return JSON.parse(raw); }catch{ return null; }
  }

  function _safeLower(s){
    try{ return String(s||"").trim().toLowerCase(); }catch{ return ""; }
  }

  // ✅ Supabase RPC peut renvoyer un ARRAY (setof) ou un objet (row/json). On unifie ici.
  function _unwrapRpcData(data){
    try{
      if (Array.isArray(data)) return (data.length ? data[0] : null);
      return (data === undefined) ? null : data;
    }catch(_){
      return null;
    }
  }

  function _normScenarioId(s){
    const v = _safeLower(s);
    if (!v) return "";
    return v.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g,"");
  }

  function _isDebug(){ try { return !!window.__VC_DEBUG; } catch { return false; } }

  function _mergeScenarioLists(/* ...lists */){
    const out = [];
    const seen = new Set();
    for (let i=0;i<arguments.length;i++){
      const list = arguments[i];
      if (!Array.isArray(list)) continue;
      for (let j=0;j<list.length;j++){
        const s = _normScenarioId(list[j]);
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  const _errState = { last: null, ts: 0 };
  function _reportRemoteError(where, err){
    try{
      if (!_isDebug()) return;
      _errState.last = {
        where: String(where || ""),
        message: (err && (err.message || err.error_description || err.error)) ? String(err.message || err.error_description || err.error) : String(err || ""),
        raw: err || null
      };
      _errState.ts = _now();
      console.warn("[VUserData][debug][remote_error]", _errState.last);
    }catch(_){}
  }

  function sbReady(){
    try{
      return !!(window.sb && window.sb.auth && window.sb.rpc);
    }catch{ return false; }
  }

  function queueRemote(fn){
    _remoteQueue = _remoteQueue
      .catch(()=>null)
      .then(fn)
      .catch((e)=>{ _reportRemoteError("queueRemote.fn", e); return null; });
    return _remoteQueue;
  }

  // ======= endings cache =======
  function _readEndingsCache(){
    try{
      const raw = localStorage.getItem(ENDINGS_CACHE_KEY);
      const o = _safeParse(raw);
      if (!o || typeof o !== "object") return null;
      if (!o.user_id) return null;
      if (!o.map || typeof o.map !== "object") return null;
      return o;
    }catch{ return null; }
  }

  function _writeEndingsCache(userId, map){
    try{
      localStorage.setItem(ENDINGS_CACHE_KEY, JSON.stringify({
        user_id: String(userId || ""),
        ts: _now(),
        map: map || {}
      }));
    }catch(_){}
  }

  function _markEndingLocal(userId, scenarioId, ending){
    const uid = String(userId || "");
    const sid = _normScenarioId(scenarioId);
    const e = _safeLower(ending);
    if(!uid || !sid) return;

    const cache = _readEndingsCache();
    const map = (cache && cache.user_id === uid && cache.map) ? cache.map : {};

    if(!map[sid]) map[sid] = { good:false, bad:false, secret:false };

    if(e === "good" || e === "bad" || e === "secret"){
      map[sid][e] = true;
    }

    _writeEndingsCache(uid, map);

    try{
      window.dispatchEvent(new CustomEvent("vc:endings_updated", {
        detail: { user_id: uid, scenario_id: sid, ending: e }
      }));
    }catch(_){}
  }

  // ======= local unlocked scenarios cache (pour toujours) =======
  function _readUnlockedCache(){
    try{
      const raw = localStorage.getItem(UNLOCKED_CACHE_KEY);
      const o = _safeParse(raw);
      if (!o || typeof o !== "object") return null;
      if (!o.user_id) return null;
      if (!Array.isArray(o.list)) return null;
      return {
        user_id: String(o.user_id || ""),
        ts: Number(o.ts || 0) || 0,
        list: Array.isArray(o.list) ? o.list.slice() : []
      };
    }catch{ return null; }
  }

  function _writeUnlockedCache(userId, list){
    try{
      const uid = String(userId || "");
      if (!uid) return;
      const merged = _mergeScenarioLists(list || []);
      localStorage.setItem(UNLOCKED_CACHE_KEY, JSON.stringify({
        user_id: uid,
        ts: _now(),
        list: merged
      }));
    }catch(_){}
  }

  function _getUnlockedCacheFor(uid){
    const u = String(uid || "");
    if (!u) return [];
    const cache = _readUnlockedCache();
    if (!cache) return [];
    if (String(cache.user_id || "") !== u) return [];
    return Array.isArray(cache.list) ? cache.list.slice() : [];
  }

  function _syncUnlockedCacheFromMem(){
    try{
      const uid = String(_memState.user_id || "");
      if (!uid) return;
      _writeUnlockedCache(uid, _memState.unlocked_scenarios);
    }catch(_){}
  }

  // ======= local profile cache =======
  function _readLocal(){
    try{
      const raw = localStorage.getItem(VUserDataKey);
      if (!raw) return null;
      const o = _safeParse(raw);
      if (!o || typeof o !== "object") return null;
      return o;
    }catch{ return null; }
  }

  function _writeLocal(obj){ try { localStorage.setItem(VUserDataKey, JSON.stringify(obj)); } catch{} }

  // ======= lang helpers =======
  function _getDeviceLang(){
    try{
      const nav = (navigator.languages && navigator.languages[0]) ? navigator.languages[0] : (navigator.language || "");
      const l = String(nav || "").toLowerCase();
      const base = l.split("-")[0] || "";
      if (SUPPORTED_LANGS.includes(l)) return l;
      if (SUPPORTED_LANGS.includes(base)) return base;
      return "en";
    }catch{ return "en"; }
  }

  function _readLangLocal(){
    try{
      const v = String(localStorage.getItem(LangStorageKey) || "").trim().toLowerCase();
      if (!v) return "";
      return SUPPORTED_LANGS.includes(v) ? v : "";
    }catch{ return ""; }
  }

  function _writeLangLocal(lang){
    try{ localStorage.setItem(LangStorageKey, String(lang || "")); }catch(_){}
  }

  function _normalizeRow(row){
    if (!row || typeof row !== "object") return null;
    const out = { ...row };

    // normalize arrays (unlocked scenarios may come as {scenarios:[...]} or array)
    if (out.unlocked_scenarios && out.unlocked_scenarios.scenarios && Array.isArray(out.unlocked_scenarios.scenarios)){
      out.unlocked_scenarios = out.unlocked_scenarios.scenarios;
    }
    if (!Array.isArray(out.unlocked_scenarios)) out.unlocked_scenarios = [];

    out.user_id = String(out.user_id || out.id || "").trim();
    out.username = String(out.username || "").trim();
    out.lang = String(out.lang || "").trim().toLowerCase();

    out.vcoins = (typeof out.vcoins === "number") ? out.vcoins : Number(out.vcoins || 0) || 0;
    out.jetons = (typeof out.jetons === "number") ? out.jetons : Number(out.jetons || 0) || 0;

    // ✅ entitlements (colonnes OU jsonb "entitlements")
    let prem = !!out.premium;
    let dia = !!out.diamond;
    let noads = !!out.no_ads;
    try{
      const ent = out.entitlements;
      if (ent && typeof ent === "object"){
        if (ent.premium === true) prem = true;
        if (ent.diamond === true) dia = true;
        if (ent.no_ads === true) noads = true;
      }
    }catch(_){}

    out.premium = !!prem;
    out.diamond = !!dia;
    // no_ads peut être un flag dédié, mais premium/diamond impliquent aussi "no ads interstitial"
    out.no_ads = !!(noads || prem || dia);

    if (!SUPPORTED_LANGS.includes(out.lang)) out.lang = "";

    // normalize scenario ids
    out.unlocked_scenarios = out.unlocked_scenarios.map(_normScenarioId).filter(Boolean);

    return out;
  }

  // ======= in-memory state =======
  const _memState = {
    user_id: "",
    username: "",
    vcoins: 0,
    jetons: 0,
    lang: "",
    unlocked_scenarios: [],
    // ✅ entitlements (premium/diamond/no_ads interstitial)
    premium: false,
    diamond: false,
    no_ads: false,
    _remote_lang_missing: false
  };

  function _persistLocal(){
    try{
      _writeLocal({
        user_id: String(_memState.user_id || ""),
        username: String(_memState.username || ""),
        vcoins: Number(_memState.vcoins || 0) || 0,
        jetons: Number(_memState.jetons || 0) || 0,
        lang: String(_memState.lang || ""),
        unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice() : [],
        premium: !!_memState.premium,
        diamond: !!_memState.diamond,
        no_ads: !!_memState.no_ads
      });
    }catch(_){}
    // ✅ en plus, on sync le cache "pour toujours" si on a un uid
    _syncUnlockedCacheFromMem();
  }

  function _emitProfile(){
    try{
      window.dispatchEvent(new CustomEvent("vc:profile", { detail: VUserData.load() }));
    }catch(_){}
  }

  function _emitProfileSoon(){
    if (_uiPaused){
      _pendingEmit = true;
      return;
    }
    _emitProfile();
  }

  // ======= Remote Store =======
  async function _tryRpc(name, args, where2){
    const sb = window.sb;
    try{
      const r = await sb.rpc(name, args || {});
      if (r?.error) _reportRemoteError(where2 || `rpc.${name}`, r.error);
      return r;
    }catch(e){
      _reportRemoteError(`rpc.${name}.exception`, e);
      return { error: e, data: null };
    }
  }

  window.VCRemoteStore = window.VCRemoteStore || {
    enabled(){ return sbReady(); },

    async ensureAuth(){
      const sb = window.sb;
      if (!sb || !sb.auth) return null;

      const uid1 = await this._getUid();
      if (uid1) return uid1;

      try{
        const r = await sb.auth.signInAnonymously();
        if (r?.data?.user?.id) return r.data.user.id;
      }catch(e){ _reportRemoteError("ensureAuth.signInAnonymously", e); }

      return await this._getUid();
    },

    async _getUid(){
      const sb = window.sb;
      if (!sb || !sb.auth) return null;
      try{
        const r = await sb.auth.getUser();
        return r?.data?.user?.id || null;
      }catch(e){
        _reportRemoteError("_getUid", e);
        return null;
      }
    },

    async getMe(){
      const sb = window.sb;
      if (!sbReady()) return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      try{
        const r = await sb.rpc("secure_get_me");
        if (r?.error){ _reportRemoteError("rpc.secure_get_me", r.error); return null; }
        return _normalizeRow(_unwrapRpcData(r?.data)) || null;
      }catch(e){
        _reportRemoteError("rpc.secure_get_me.exception", e);
        return null;
      }
    },

    async setUsername(username){
      const sb = window.sb;
      if (!sbReady()) return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const name = String(username || "").trim();
      if (!name) return null;

      const r = await _tryRpc("secure_set_username", { p_username: name });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && d.username) ? d.username : d;
      return (v !== null && v !== undefined && v !== "") ? String(v) : null;
    },

    async setLang(lang){
      const sb = window.sb;
      if (!sbReady()) return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const l = String(lang || "").trim().toLowerCase();
      if (!SUPPORTED_LANGS.includes(l)) return null;

      const r = await _tryRpc("secure_set_lang", { p_lang: l });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && d.lang) ? d.lang : d;
      return (v !== null && v !== undefined && v !== "") ? String(v).toLowerCase() : null;
    },

    async unlockScenario(scenarioId){
      const sb = window.sb;
      if (!sbReady()) return { ok:false, reason:"no_client" };
      const uid = await this.ensureAuth();
      if (!uid) return { ok:false, reason:"no_auth" };

      const s = _normScenarioId(scenarioId);
      if (!s) return { ok:false, reason:"invalid_scenario" };

      try{
        const r = await sb.rpc("secure_unlock_scenario", { p_scenario: s });
        if (r?.error){
          _reportRemoteError("rpc.secure_unlock_scenario", r.error);
          return { ok:false, reason: r.error.message || "rpc_error", error:r.error };
        }
        return { ok:true, data: (_unwrapRpcData(r?.data) || null) };
      }catch(err){
        _reportRemoteError("rpc.secure_unlock_scenario.exception", err);
        return { ok:false, reason:"rpc_exception", error:err };
      }
    },

    async addVCoins(delta){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d0 = Number(delta || 0);
      if (!Number.isFinite(d0) || d0 === 0) return null;

      const r = await _tryRpc("secure_add_vcoins", { p_delta: d0 });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && typeof d.vcoins === "number") ? d.vcoins : d;
      return (typeof v === "number" && !Number.isNaN(v)) ? v : null;
    },

    async addJetons(delta){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d0 = Number(delta || 0);
      if (!Number.isFinite(d0) || d0 === 0) return null;

      const r = await _tryRpc("secure_add_jetons", { p_delta: d0 });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && typeof d.jetons === "number") ? d.jetons : d;
      return (typeof v === "number" && !Number.isNaN(v)) ? v : null;
    },

    async spendJetons(delta){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d0 = Number(delta || 0);
      if (!Number.isFinite(d0) || d0 <= 0) return null;

      const r = await _tryRpc("secure_spend_jetons", { p_delta: d0 });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && typeof d.jetons === "number") ? d.jetons : d;
      return (typeof v === "number" && !Number.isNaN(v)) ? v : null;
    },

    async reduceVCoinsTo(value){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const v0 = Number(value || 0);
      if (!Number.isFinite(v0)) return null;

      const r = await _tryRpc("secure_reduce_vcoins_to", { p_value: v0 });
      if (r?.error) return null;
      const d = _unwrapRpcData(r?.data);
      const v = (d && typeof d === "object" && typeof d.vcoins === "number") ? d.vcoins : d;
      return (typeof v === "number" && !Number.isNaN(v)) ? v : null;
    },

    async completeScenario(scenarioId, ending){
      const sb = window.sb;
      if (!sbReady()) return { ok:false, reason:"no_client" };
      const uid = await this.ensureAuth();
      if (!uid) return { ok:false, reason:"no_auth" };

      const s = _normScenarioId(scenarioId);
      const e = _safeLower(ending);
      if (!s) return { ok:false, reason:"invalid_scenario" };
      if (!["good","bad","secret"].includes(e)) return { ok:false, reason:"invalid_ending" };

      try{
        const r = await sb.rpc("secure_complete_scenario", { p_scenario: s, p_ending: e });
        if (r?.error){
          _reportRemoteError("rpc.secure_complete_scenario", r.error);
          return { ok:false, reason: r.error.message || "rpc_error", error:r.error };
        }
        return { ok:true, data: (_unwrapRpcData(r?.data) || null) };
      }catch(err){
        _reportRemoteError("rpc.secure_complete_scenario.exception", err);
        return { ok:false, reason:"rpc_exception", error:err };
      }
    }
  };

  const VUserData = {
    async init(){
      if (_initPromise) return _initPromise;

      _initPromise = (async () => {
        // ✅ PRIME local immédiatement (avant tout refresh remote)
        if (!_primedLocal){
          _primedLocal = true;
          const cached = _readLocal();
          if (cached) this.save(cached, { silent:true });
          else this.save(this.load(), { silent:true });
        }

        // ✅ Si on a un uid local, on merge le cache "pour toujours"
        try{
          const uid = String(_memState.user_id || "");
          if (uid){
            const cachedUnlock = _getUnlockedCacheFor(uid);
            if (cachedUnlock.length){
              _memState.unlocked_scenarios = _mergeScenarioLists(_memState.unlocked_scenarios, cachedUnlock);
              _persistLocal();
            }
          }
        }catch(_){}

        // ✅ Refresh (background) : ajoute seulement, ne retire jamais
        if (window.VCRemoteStore?.enabled?.()){
          await this.refresh().catch((e) => { _reportRemoteError("VUserData.init.refresh", e); return false; });

          // ✅ si remote n'a pas de lang, push la locale/device (EN fallback)
          try{
            if (_memState._remote_lang_missing){
              await this.setLang(_memState.lang);
            }
          }catch(_){}
        }

        _uiPaused = false;
        if (_pendingEmit){ _pendingEmit = false; _emitProfile(); }
        return true;
      })();

      return _initPromise;
    },

    async refresh(){
      if (!window.VCRemoteStore?.enabled?.()) return false;

      return await queueRemote(async () => {
        const me = await window.VCRemoteStore.getMe();
        if (!me) return false;

        const prevUid = String(_memState.user_id || "");
        const nextUid = String(me.user_id || "");
        const uidChanged = !!(prevUid && nextUid && prevUid !== nextUid);

        const prevLang = String(_memState.lang || "");
        const nextLang = String(me.lang || "");
        _memState._remote_lang_missing = !nextLang;

        // ✅ lang: device/local prioritaire si remote vide
        const localLang = _readLangLocal() || _getDeviceLang();
        if (!nextLang){
          _memState.lang = localLang;
        } else {
          _memState.lang = nextLang;
          _writeLangLocal(nextLang);
        }

        _memState.user_id = nextUid;
        _memState.username = String(me.username || "");
        _memState.vcoins = Number(me.vcoins || 0) || 0;
        _memState.jetons = Number(me.jetons || 0) || 0;

        // ✅ MERGE entitlements (local OR remote, jamais shrink)
        try{
          const localPrem = uidChanged ? false : !!_memState.premium;
          const localDia  = uidChanged ? false : !!_memState.diamond;
          const localNo   = uidChanged ? false : !!_memState.no_ads;

          const remotePrem = !!me.premium;
          const remoteDia  = !!me.diamond;
          const remoteNo   = !!me.no_ads;

          _memState.premium = !!(localPrem || remotePrem);
          _memState.diamond = !!(localDia || remoteDia);
          _memState.no_ads  = !!(localNo || remoteNo || _memState.premium || _memState.diamond);
        }catch(_){}

        // ✅ MERGE unlocked_scenarios (local "pour toujours" + cache user + remote)
        const remoteList = Array.isArray(me.unlocked_scenarios) ? me.unlocked_scenarios.slice() : [];
        const cacheList = nextUid ? _getUnlockedCacheFor(nextUid) : [];
        const localList = uidChanged ? [] : (Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice() : []);

        // ⚠️ si uid change, on évite de garder les unlocks de l'ancien user
        _memState.unlocked_scenarios = _mergeScenarioLists(cacheList, localList, remoteList);

        _persistLocal();

        // ✅ si la lang change, on peut prévenir (engine.js gère UI)
        if (prevLang && prevLang !== _memState.lang){
          try{ window.dispatchEvent(new CustomEvent("vc:lang", { detail: { lang: _memState.lang } })); }catch(_){}
        }

        _emitProfileSoon();
        return true;
      });
    },

    load(){
      return {
        user_id: String(_memState.user_id || ""),
        username: String(_memState.username || ""),
        vcoins: Number(_memState.vcoins || 0) || 0,
        jetons: Number(_memState.jetons || 0) || 0,
        lang: String(_memState.lang || ""),
        unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice() : [],
        premium: !!_memState.premium,
        diamond: !!_memState.diamond,
        no_ads: !!_memState.no_ads
      };
    },

    save(obj, opts){
      const o = (obj && typeof obj === "object") ? obj : {};
      const silent = !!(opts && opts.silent);

      const deviceLang = _getDeviceLang();
      const localLang = _readLangLocal();
      const desiredLang = localLang || deviceLang || "en";

      const incomingUid = String(o.user_id || "").trim();
      if (incomingUid){
        // ⚠️ si uid change via save, on ne mélange pas les unlocks
        const prevUid = String(_memState.user_id || "");
        if (prevUid && prevUid !== incomingUid){
          _memState.unlocked_scenarios = [];
          _memState.premium = false;
          _memState.diamond = false;
          _memState.no_ads = false;
        }
        _memState.user_id = incomingUid;
      } else {
        _memState.user_id = String(_memState.user_id || "");
      }

      _memState.username = String(o.username || _memState.username || "");
      _memState.vcoins = Number((o.vcoins ?? _memState.vcoins ?? 0)) || 0;
      _memState.jetons = Number((o.jetons ?? _memState.jetons ?? 0)) || 0;

      const langIn = String(o.lang || _memState.lang || "").toLowerCase();
      if (SUPPORTED_LANGS.includes(langIn)) _memState.lang = langIn;
      else _memState.lang = desiredLang;

      _writeLangLocal(_memState.lang);

      // ✅ IMPORTANT: entitlements ne doivent JAMAIS "shrink" (si tu as premium/diamond une fois, on ne le retire pas en local)
      //    - source remote = vérité, mais côté UX on fait "local OR remote" pour éviter de re-bloquer en offline/latence
      try{
        const ent = (o && typeof o === "object") ? (o.entitlements || null) : null;

        const premIn = (o && o.premium === true) || (ent && ent.premium === true);
        const diaIn  = (o && o.diamond === true) || (ent && ent.diamond === true);
        const noadsIn = (o && o.no_ads === true) || (ent && ent.no_ads === true);

        _memState.premium = !!(_memState.premium || premIn);
        _memState.diamond = !!(_memState.diamond || diaIn);

        // no_ads interstitial: flag dédié OU implique premium/diamond
        _memState.no_ads = !!(_memState.no_ads || noadsIn || _memState.premium || _memState.diamond);
      }catch(_){}

      // ✅ IMPORTANT: unlocked_scenarios ne doit JAMAIS "shrink"
      // -> on merge toujours l'existant + l'incoming + le cache "pour toujours" du user
      const incomingList = Array.isArray(o.unlocked_scenarios) ? o.unlocked_scenarios.slice() : null;
      const uid = String(_memState.user_id || "");
      const cacheList = uid ? _getUnlockedCacheFor(uid) : [];
      _memState.unlocked_scenarios = _mergeScenarioLists(
        cacheList,
        _memState.unlocked_scenarios,
        incomingList || []
      );

      _persistLocal();

      if (!silent) _emitProfileSoon();
    },

    // ✅ getters jetons/vcoins (évite bugs popup jetons si init pas fini)
    getJetons(){
      try{
        const v = Number(_memState.jetons || 0);
        if (Number.isFinite(v)) return v;
      }catch(_){}
      try{
        const cached = _readLocal();
        const v = Number(cached?.jetons || 0);
        return Number.isFinite(v) ? v : 0;
      }catch(_){}
      return 0;
    },

    getVCoins(){
      try{
        const v = Number(_memState.vcoins || 0);
        if (Number.isFinite(v)) return v;
      }catch(_){}
      try{
        const cached = _readLocal();
        const v = Number(cached?.vcoins || 0);
        return Number.isFinite(v) ? v : 0;
      }catch(_){}
      return 0;
    },

    // ✅ helper utilisé par index.html chez toi
    getLang(){
      const l = String(_memState.lang || "").toLowerCase();
      if (SUPPORTED_LANGS.includes(l)) return l;
      return _readLangLocal() || _getDeviceLang() || "en";
    },

    // ✅ entitlements helpers (utilisé par index + ads.js)
    hasPremium(){
      return !!_memState.premium;
    },
    hasDiamond(){
      return !!_memState.diamond;
    },
    hasNoAds(){
      // "no_ads" = on coupe uniquement les interstitials. Rewarded reste volontaire.
      return !!(_memState.no_ads || _memState.premium || _memState.diamond);
    },

    getUnlockedScenarios(){
      // ✅ fallback localStorage même si init pas fini
      const mem = Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice() : [];
      if (mem.length) return mem;

      try{
        const cached = _readLocal();
        const arr = cached && Array.isArray(cached.unlocked_scenarios) ? cached.unlocked_scenarios : [];
        if (arr && arr.length) return _mergeScenarioLists(arr);
      }catch(_){}

      return [];
    },

    isScenarioUnlocked(scenarioId, requiredPack){
      const s = _normScenarioId(scenarioId);
      if (!s) return false;

      const pack = String(requiredPack || "").trim().toLowerCase();

      // ✅ Premium/Diamond = accès automatique (débloque aussi les futurs scénarios)
      // - Si un scénario est "diamond-only", premium ne suffit pas.
      if (pack === "diamond"){
        if (this.hasDiamond()) return true;
      } else {
        if (this.hasPremium() || this.hasDiamond()) return true;
      }

      const arr = this.getUnlockedScenarios();
      if (arr.includes(s)) return true;

      // ✅ si on a un uid, check aussi le cache "pour toujours"
      try{
        const uid = String(_memState.user_id || "") || String(_readLocal()?.user_id || "");
        if (uid){
          const cacheList = _getUnlockedCacheFor(uid);
          if (cacheList.includes(s)) return true;
        }
      }catch(_){}

      return false;
    },

    async unlockScenario(scenarioId){
      // ✅ sécurité: si init pas fait, on le fait ici
      try{ await this.init(); }catch(_){}

      const s = _normScenarioId(scenarioId);
      if (!s) return { ok:false, reason:"invalid_scenario" };

      // ✅ local (optimiste + permanent) : on l'ajoute tout de suite
      const cur = this.getUnlockedScenarios();
      if (!cur.includes(s)){
        cur.push(s);
        this.save({ ...this.load(), unlocked_scenarios: cur });
      }

      // ✅ write-through "pour toujours" si uid connu
      try{
        let uid = String(_memState.user_id || "");
        if (!uid && window.VCRemoteStore?.ensureAuth){
          try{ uid = String(await window.VCRemoteStore.ensureAuth() || ""); }catch(_){}
          if (uid){
            _memState.user_id = uid;
            _persistLocal();
          }
        }
        if (uid){
          const merged = _mergeScenarioLists(_getUnlockedCacheFor(uid), cur);
          _writeUnlockedCache(uid, merged);
        }
      }catch(_){}

      if (!window.VCRemoteStore?.enabled?.()){
        return { ok:false, reason:"no_remote", local_ok:true, remote_ok:false, data:null };
      }

      const res = await window.VCRemoteStore.unlockScenario(s);
      if (!res?.ok){
        return { ok:false, reason: res?.reason || "rpc_error", local_ok:true, remote_ok:false, error: res?.error || null, data: res?.data || null };
      }

      // ✅ remote peut renvoyer unlocked_scenarios -> on merge (jamais shrink)
      try{
        const payload = res.data || null;
        const list = payload && payload.unlocked_scenarios;
        if (Array.isArray(list)){
          const merged = _mergeScenarioLists(this.getUnlockedScenarios(), list);
          this.save({ ...this.load(), unlocked_scenarios: merged });
        } else {
          await this.refresh().catch(() => false);
        }
      }catch(_){}

      return { ok:true, reason:"ok", local_ok:true, remote_ok:true, data: res.data || null };
    },

    async setUsername(username){
      const name = String(username || "").trim();
      if (!name) return { ok:false, reason:"invalid_username" };

      this.save({ ...this.load(), username: name });

      if (!window.VCRemoteStore?.enabled?.()){
        return { ok:false, reason:"no_remote" };
      }

      const v = await window.VCRemoteStore.setUsername(name);
      if (!v) return { ok:false, reason:"rpc_error" };

      this.save({ ...this.load(), username: String(v) });
      return { ok:true, username: String(v) };
    },

    async setLang(lang){
      const l = String(lang || "").trim().toLowerCase();
      if (!SUPPORTED_LANGS.includes(l)) return { ok:false, reason:"invalid_lang" };

      // ✅ local
      this.save({ ...this.load(), lang: l });

      // ✅ signal app
      try{ window.dispatchEvent(new CustomEvent("vc:lang", { detail: { lang: l } })); }catch(_){}

      if (!window.VCRemoteStore?.enabled?.()){
        return { ok:false, reason:"no_remote" };
      }

      const v = await window.VCRemoteStore.setLang(l);
      if (!v) return { ok:false, reason:"rpc_error" };

      this.save({ ...this.load(), lang: String(v) });
      return { ok:true, lang: String(v) };
    },

    async addVCoins(delta){
      const d = Number(delta || 0);
      if (!Number.isFinite(d) || d === 0) return { ok:false, reason:"invalid_delta" };

      const cur = this.load();
      this.save({ ...cur, vcoins: (Number(cur.vcoins || 0) + d) });

      if (!window.VCRemoteStore?.enabled?.()){
        return { ok:false, reason:"no_remote" };
      }

      const v = await window.VCRemoteStore.addVCoins(d);
      if (typeof v !== "number" || Number.isNaN(v)) return { ok:false, reason:"rpc_error" };

      const cur2 = this.load();
      this.save({ ...cur2, vcoins: v });
      return { ok:true, vcoins: v };
    },

    async reduceVCoinsTo(value){
      const v0 = Number(value || 0);
      if (!Number.isFinite(v0)) return { ok:false, reason:"invalid_value" };

      if (!window.VCRemoteStore?.enabled?.()){
        const cur = this.load();
        this.save({ ...cur, vcoins: Math.max(0, v0) });
        return { ok:true, vcoins: Math.max(0, v0), local_only:true };
      }

      const v = await window.VCRemoteStore.reduceVCoinsTo(v0);
      if (typeof v !== "number" || Number.isNaN(v)) return { ok:false, reason:"rpc_error" };

      const cur = this.load();
      this.save({ ...cur, vcoins: v });
      return { ok:true, vcoins: v };
    },

    async addJetons(delta){
      const d = Number(delta || 0);
      if (!Number.isFinite(d) || d === 0) return { ok:false, reason:"invalid_delta" };

      if (!window.VCRemoteStore?.enabled?.()){
        const cur = this.load();
        this.save({ ...cur, jetons: Math.max(0, Number(cur.jetons||0) + d) });
        return { ok:true, jetons: this.load().jetons, local_only:true };
      }

      const v = await window.VCRemoteStore.addJetons(d);
      if (typeof v !== "number" || Number.isNaN(v)) return { ok:false, reason:"rpc_error" };

      const cur = this.load();
      this.save({ ...cur, jetons: v });
      return { ok:true, jetons: v };
    },

    async spendJetons(delta){
      const d = Number(delta || 0);
      if (!Number.isFinite(d) || d <= 0) return { ok:false, reason:"invalid_delta" };

      if (!window.VCRemoteStore?.enabled?.()){
        const cur = this.load();
        const left = Math.max(0, Number(cur.jetons||0) - d);
        this.save({ ...cur, jetons: left });
        return { ok:true, jetons: left, local_only:true };
      }

      const v = await window.VCRemoteStore.spendJetons(d);
      if (typeof v !== "number" || Number.isNaN(v)) return { ok:false, reason:"rpc_error" };

      const cur = this.load();
      this.save({ ...cur, jetons: v });
      return { ok:true, jetons: v };
    },

    async completeScenario(scenarioId, ending){
      try{ await this.init(); }catch(_){}

      const s = _normScenarioId(scenarioId);
      const e = _safeLower(ending);

      if (!s) return { ok:false, reason:"invalid_scenario" };
      if (!["good","bad","secret"].includes(e)) return { ok:false, reason:"invalid_ending" };

      // ✅ LOCAL-FIRST : on marque le badge en local immédiatement
      let localOk = false;
      try{
        let uid = String(_memState.user_id || "");
        if (!uid && window.VCRemoteStore?.ensureAuth){
          try{ uid = String(await window.VCRemoteStore.ensureAuth() || ""); }catch(_){}
        }

        if (!uid){
          try{ await this.refresh(); }catch(_){}
          uid = String(_memState.user_id || "");
        }

        if (uid){
          _memState.user_id = uid;
          _persistLocal();
          _markEndingLocal(uid, s, e);
          localOk = true;
        }
      }catch(_){}

      if (!window.VCRemoteStore?.enabled?.()){
        return { ok:false, reason:"no_remote", local_ok: localOk, remote_ok:false, data:null };
      }

      const res = await window.VCRemoteStore.completeScenario(s, e);
      if (!res?.ok){
        return { ok:false, reason: res?.reason || "rpc_error", local_ok: localOk, remote_ok:false, error: res?.error || null, data: res?.data || null };
      }

      const payload = res.data || null;
      const v = (payload && typeof payload.vcoins === "number") ? payload.vcoins : null;

      if (typeof v === "number" && !Number.isNaN(v)){
        const cur = this.load();
        this.save({ ...cur, vcoins: v });
      } else {
        await this.refresh().catch(() => false);
      }

      return { ok:true, reason:"ok", local_ok: localOk, remote_ok:true, data: payload };
    }
  };

  window.VUserData = VUserData;

  // ✅ AUTO INIT : toutes les pages sont safe (index/game/profile/settings/shop…)
  (function autoInit(){
    const run = async () => {
      try{ await window.VUserData.init(); }catch(_){}
    };
    if (document.readyState === "loading"){
      document.addEventListener("DOMContentLoaded", run, { once:true });
    } else {
      run();
    }
  })();

})();