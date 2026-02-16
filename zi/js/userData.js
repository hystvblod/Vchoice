// js/userData.js
// VChoice — Local cache + Supabase RPCs (source of truth)
// - Profil via RPC secure_get_me
// - Solde via RPC: secure_add_vcoins / secure_add_jetons / secure_reduce_vcoins_to
// - Username via secure_set_username
// - Lang via secure_set_lang
// - Déblocage scénario via secure_unlock_scenario
//
// Notes:
// - unlocked_scenarios = cache local UX, Supabase = vérité via secure_get_me
// - vr:profile émis pour que l’UI se mette à jour sans “flash”

(function () {
  "use strict";

  const VUserDataKey = "vchoice_user_data";
  const LangStorageKey = "vchoice_lang";

  let _uiPaused = true;
  let _pendingEmit = false;

  function _isDebug(){ try { return !!window.__VC_DEBUG; } catch { return false; } }

  const _errState = { last: null, ts: 0 };
  function _reportRemoteError(where, err){
    try{
      if (!_isDebug()) return;
      _errState.last = {
        where: String(where || ""),
        message: (err && err.message) ? String(err.message) : String(err || "error"),
        ts: Date.now()
      };
      _errState.ts = Date.now();
      window.dispatchEvent(new CustomEvent("vc:remote_error", { detail: { ..._errState.last } }));
    }catch(_){}
  }

  let _remoteQueue = Promise.resolve();
  function queueRemote(fn, where){
    _remoteQueue = _remoteQueue.then(fn).catch((e) => {
      _reportRemoteError(where || "queueRemote", e);
      return null;
    });
    return _remoteQueue;
  }

  const _memState = {
    user_id: "",
    username: "",
    vcoins: 0,
    jetons: 0,
    lang: "fr",
    unlocked_scenarios: ["dossier14_appartement"], // FREE par défaut (à adapter)
    updated_at: Date.now(),
    last_sync_at: 0
  };

  function _clampInt(n){ return Math.max(0, Math.floor(Number(n || 0))); }

  function _safeParse(raw){ try { return JSON.parse(raw); } catch { return null; } }

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

  function _persistLocal(){
    try{
      _writeLocal({
        user_id: String(_memState.user_id || ""),
        username: String(_memState.username || ""),
        vcoins: _clampInt(_memState.vcoins),
        jetons: _clampInt(_memState.jetons),
        lang: String(_memState.lang || "fr"),
        unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice(0) : [],
        updated_at: Date.now(),
        last_sync_at: Number(_memState.last_sync_at || 0)
      });
    }catch(_){}
    try{ localStorage.setItem(LangStorageKey, String(_memState.lang || "fr")); }catch(_){}
  }

  function _emitProfile(){
    try{
      if (_uiPaused){ _pendingEmit = true; return; }
      window.dispatchEvent(new CustomEvent("vr:profile", { // compat avec tes autres pages si elles écoutent déjà vr:profile
        detail: {
          user_id: _memState.user_id,
          username: _memState.username,
          lang: _memState.lang,
          vcoins: _memState.vcoins,
          jetons: _memState.jetons,
          unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice(0) : []
        }
      }));
      window.dispatchEvent(new CustomEvent("vc:profile", {
        detail: {
          user_id: _memState.user_id,
          username: _memState.username,
          lang: _memState.lang,
          vcoins: _memState.vcoins,
          jetons: _memState.jetons,
          unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice(0) : []
        }
      }));
    }catch(_){}
  }

  function _default(){
    return {
      user_id: "",
      username: "",
      vcoins: 0,
      jetons: 0,
      lang: "fr",
      unlocked_scenarios: ["dossier14_appartement"],
      updated_at: Date.now()
    };
  }

  function _applyMe(me){
    if (!me) return false;

    _memState.user_id = String(me.id || "");
    _memState.username = String(me.username || "");
    _memState.vcoins = _clampInt(me.vcoins || 0);
    _memState.jetons = _clampInt(me.jetons || 0);
    _memState.lang = String(me.lang || "fr");

    // unlocked_scenarios
    if (Array.isArray(me.unlocked_scenarios)){
      _memState.unlocked_scenarios = me.unlocked_scenarios.filter(Boolean).map(String);
    } else if (typeof me.unlocked_scenarios === "string" && me.unlocked_scenarios){
      _memState.unlocked_scenarios = [String(me.unlocked_scenarios)];
    } else if (!Array.isArray(_memState.unlocked_scenarios) || !_memState.unlocked_scenarios.length){
      _memState.unlocked_scenarios = ["dossier14_appartement"];
    }

    _memState.updated_at = Date.now();
    _memState.last_sync_at = Date.now();

    _emitProfile();
    _persistLocal();
    return true;
  }

  // -------------------------
  // Remote store (Supabase)
  // -------------------------
  function sbReady(){
    return !!(window.sb && window.sb.auth && typeof window.sb.rpc === "function");
  }

  window.VCRemoteStore = window.VCRemoteStore || {
    enabled(){ return sbReady(); },

    async ensureAuth(){
      const sb = window.sb;
      if (!sb || !sb.auth) return null;

      try{
        if (typeof window.bootstrapAuthAndProfile === "function"){
          const p = await window.bootstrapAuthAndProfile();
          return p?.id || (await this._getUid());
        }
      }catch(e){ _reportRemoteError("ensureAuth.bootstrapAuthAndProfile", e); }

      const uid = await this._getUid();
      if (uid) return uid;

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
        return r?.data || null;
      }catch(e){
        _reportRemoteError("rpc.secure_get_me.exception", e);
        return null;
      }
    },

    async setUsername(username){
      const sb = window.sb;
      if (!sbReady()) return { ok:false, reason:"no_client" };
      const uid = await this.ensureAuth();
      if (!uid) return { ok:false, reason:"no_auth" };

      try{
        const r = await sb.rpc("secure_set_username", { p_username: username });
        if (r?.error){ _reportRemoteError("rpc.secure_set_username", r.error); return { ok:false, reason:"rpc_error" }; }
        return { ok: !!r?.data, reason: r?.data ? "ok" : "taken" };
      }catch(e){
        _reportRemoteError("rpc.secure_set_username.exception", e);
        return { ok:false, reason:"exception" };
      }
    },

    async setLang(lang){
      const sb = window.sb;
      if (!sbReady()) return false;
      const uid = await this.ensureAuth();
      if (!uid) return false;

      const l = String(lang || "fr").trim().toLowerCase() || "fr";
      try{
        const r = await sb.rpc("secure_set_lang", { p_lang: l });
        if (r?.error) _reportRemoteError("rpc.secure_set_lang", r.error);
        return !r?.error && !!r?.data;
      }catch(e){
        _reportRemoteError("rpc.secure_set_lang.exception", e);
        return false;
      }
    },

    async addVcoins(delta){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return null;

      try{
        const r = await sb.rpc("secure_add_vcoins", { p_delta: d });
        if (r?.error){ _reportRemoteError("rpc.secure_add_vcoins", r.error); return null; }
        return Number(r?.data ?? 0);
      }catch(e){
        _reportRemoteError("rpc.secure_add_vcoins.exception", e);
        return null;
      }
    },

    async addJetons(delta){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return null;

      try{
        const r = await sb.rpc("secure_add_jetons", { p_delta: d });
        if (r?.error){ _reportRemoteError("rpc.secure_add_jetons", r.error); return null; }
        return Number(r?.data ?? 0);
      }catch(e){
        _reportRemoteError("rpc.secure_add_jetons.exception", e);
        return null;
      }
    },

    async reduceVcoinsTo(value){
      const sb = window.sb;
      if (!sbReady()) return null;
      const uid = await this.ensureAuth();
      if (!uid) return null;

      const v = Math.max(0, Math.floor(Number(value || 0)));
      try{
        const r = await sb.rpc("secure_reduce_vcoins_to", { p_value: v });
        if (r?.error){ _reportRemoteError("rpc.secure_reduce_vcoins_to", r.error); return null; }
        return Number(r?.data ?? 0);
      }catch(e){
        _reportRemoteError("rpc.secure_reduce_vcoins_to.exception", e);
        return null;
      }
    },

    async unlockScenario(scenarioId){
      const sb = window.sb;
      if (!sbReady()) return { ok:false, reason:"no_client" };
      const uid = await this.ensureAuth();
      if (!uid) return { ok:false, reason:"no_auth" };

      const s = String(scenarioId || "").trim();
      if (!s) return { ok:false, reason:"invalid_scenario" };

      try{
        const r = await sb.rpc("secure_unlock_scenario", { p_scenario: s });
        if (r?.error){
          _reportRemoteError("rpc.secure_unlock_scenario", r.error);
          return { ok:false, reason: r.error.message || "rpc_error", error: r.error };
        }
        return { ok:true, data: r?.data || null };
      }catch(e){
        _reportRemoteError("rpc.secure_unlock_scenario.exception", e);
        return { ok:false, reason:"rpc_exception", error:e };
      }
    }
  };

  // -------------------------
  // VUserData (API)
  // -------------------------
  const VUserData = {
    async init(){
      const cached = _readLocal();
      if (cached) this.save(cached, { silent:true });
      else this.save(this.load(), { silent:true });

      if (window.VCRemoteStore?.enabled?.()){
        await this.refresh().catch((e) => { _reportRemoteError("VUserData.init.refresh", e); return false; });
      }

      _uiPaused = false;
      if (_pendingEmit){ _pendingEmit = false; _emitProfile(); }
      return true;
    },

    async refresh(){
      if (!window.VCRemoteStore?.enabled?.()) return false;

      return await queueRemote(async () => {
        const me = await window.VCRemoteStore.getMe();
        if (!me) return false;
        _applyMe(me);
        return true;
      }, "VUserData.refresh");
    },

    load(){
      try{
        const d = _default();
        return {
          ...d,
          user_id: String(_memState.user_id || ""),
          username: String(_memState.username || ""),
          vcoins: _clampInt(_memState.vcoins || 0),
          jetons: _clampInt(_memState.jetons || 0),
          lang: String(_memState.lang || "fr"),
          unlocked_scenarios: Array.isArray(_memState.unlocked_scenarios) ? _memState.unlocked_scenarios.slice(0) : d.unlocked_scenarios,
          updated_at: Number(_memState.updated_at || Date.now())
        };
      }catch{
        return _default();
      }
    },

    save(u, opts){
      const silent = !!(opts && opts.silent);
      try{
        const data = (u && typeof u === "object") ? u : _default();
        _memState.user_id = String(data.user_id || _memState.user_id || "");
        _memState.username = String(data.username || _memState.username || "");
        _memState.vcoins = _clampInt(typeof data.vcoins !== "undefined" ? data.vcoins : _memState.vcoins);
        _memState.jetons = _clampInt(typeof data.jetons !== "undefined" ? data.jetons : _memState.jetons);
        _memState.lang = String(data.lang || _memState.lang || "fr");

        if (Array.isArray(data.unlocked_scenarios)){
          _memState.unlocked_scenarios = data.unlocked_scenarios.filter(Boolean).map(String);
        } else if (!Array.isArray(_memState.unlocked_scenarios) || !_memState.unlocked_scenarios.length){
          _memState.unlocked_scenarios = ["dossier14_appartement"];
        }

        _memState.updated_at = Date.now();
        if (!silent) _emitProfile();
        _persistLocal();
      }catch(_){}
    },

    getLang(){ return String(this.load().lang || "fr"); },
    getVcoins(){ return Number(this.load().vcoins || 0); },

    getUnlockedScenarios(){
      const u = this.load();
      const arr = Array.isArray(u.unlocked_scenarios) ? u.unlocked_scenarios : [];
      return arr.filter(Boolean).map(String);
    },

    isScenarioUnlocked(scenarioId){
      const id = String(scenarioId || "");
      if (!id) return false;
      return new Set(this.getUnlockedScenarios()).has(id);
    },

    async unlockScenario(scenarioId){
      const id = String(scenarioId || "").trim();
      if (!id) return { ok:false, reason:"invalid_scenario" };
      if (this.isScenarioUnlocked(id)) return { ok:true, reason:"already", data:this.load() };
      if (!window.VCRemoteStore?.enabled?.()) return { ok:false, reason:"no_remote" };

      const res = await window.VCRemoteStore.unlockScenario(id);
      if (!res?.ok) return res || { ok:false, reason:"error" };

      const me = Array.isArray(res.data) ? (res.data[0] || null) : res.data;
      if (me && typeof me === "object"){
        const cur = this.load();
        this.save({
          ...cur,
          user_id: String(me.id || cur.user_id || ""),
          username: String(me.username || cur.username || ""),
          vcoins: (typeof me.vcoins !== "undefined") ? me.vcoins : cur.vcoins,
          jetons: (typeof me.jetons !== "undefined") ? me.jetons : cur.jetons,
          lang: String(me.lang || cur.lang || "fr"),
          unlocked_scenarios: Array.isArray(me.unlocked_scenarios) ? me.unlocked_scenarios : cur.unlocked_scenarios
        });
      }else{
        await this.refresh().catch(() => false);
      }

      return { ok:true, reason:"ok", data:this.load() };
    },

    // fire-and-forget coins (si tu en as besoin ailleurs)
    addVcoins(delta){
      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return this.getVcoins();
      if (!window.VCRemoteStore?.enabled?.()) return this.getVcoins();

      queueRemote(async () => {
        const newv = await window.VCRemoteStore.addVcoins(d);
        if (typeof newv === "number" && !Number.isNaN(newv)){
          _memState.vcoins = _clampInt(newv);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
        } else {
          await this.refresh().catch(() => false);
        }
        return true;
      }, "VUserData.addVcoins");

      return this.getVcoins();
    }
  };

  window.VUserData = VUserData;

})();
