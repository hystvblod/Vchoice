// js/purchases.js
/* global CdvPurchase */
// VChoice — IAP minimal “clean”
// - Expose window.VCIAP (et alias VRIAP)
// - Emit:
//    vc:iap_price  / vr:iap_price
//    vc:iap_credited / vr:iap_credited
// - Anti double-credit + replay local pending
//
// ✅ SKU:
// - 12 jetons, 30 jetons
// - 500 vcoins, 3000 vcoins
// - No Ads
// - ULTRA
// - Achat direct scénario (1 SKU par scénario)

(function () {
  "use strict";

  const DEBUG = false;
  const log  = (...a) => { if (DEBUG) console.log("[VC-IAP]", ...a); };
  const warn = (...a) => { if (DEBUG) console.warn("[VC-IAP]", ...a); };

  const ENT_NO_ADS_KEY    = "vchoice_ent_no_ads_v1";
  const ENT_DIAMOND_KEY   = "vchoice_ent_diamond_v1";
  const ENT_ULTRA_KEY     = "vchoice_ent_ultra_v1";

  function _lsGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
  function _lsSet(k,v){ try { localStorage.setItem(k, v); } catch(_){} }

  function hasUltra(){
    try{ if (window.VUserData && typeof window.VUserData.hasDiamond === "function" && window.VUserData.hasDiamond()) return true; }catch(_){}
    return (_lsGet(ENT_DIAMOND_KEY) === "1") || (_lsGet(ENT_ULTRA_KEY) === "1");
  }
  function hasNoAds(){
    try{ if (window.VUserData && typeof window.VUserData.hasNoAds === "function" && window.VUserData.hasNoAds()) return true; }catch(_){}
    return hasUltra() || (_lsGet(ENT_NO_ADS_KEY) === "1");
  }

  function persistEntToUserData(patch){
    try{
      const ud = window.VUserData;
      if (!ud || typeof ud.load !== "function" || typeof ud.save !== "function") return;
      const cur = ud.load() || {};
      const next = Object.assign({}, cur, patch || {});
      ud.save(next, { silent:true });
    }catch(_){}
  }

  function setNoAdsEntitled(on){
    _lsSet(ENT_NO_ADS_KEY, on ? "1" : "0");
    persistEntToUserData({ no_ads: !!on });
    try { window.__VC_NO_ADS = !!on; } catch(_) {}
  }

  function setUltraEntitled(on){
    _lsSet(ENT_DIAMOND_KEY, on ? "1" : "0");
    _lsSet(ENT_ULTRA_KEY, on ? "1" : "0");
    persistEntToUserData({ diamond: !!on, no_ads: !!on ? true : (hasNoAds()) });
    if (on) setNoAdsEntitled(true);
  }

  window.VCEnt = window.VCEnt || {};
  window.VCEnt.hasNoAds = hasNoAds;
  window.VCEnt.hasUltra = hasUltra;

  const DIRECT_SCENARIO_IDS = [
    "hopital_ferme",
    "metro_station_zero",
    "styx_gare",
    "foret_relais",
    "chateau_absents",
    "temple_mictlan"
  ];

  function scenarioSku(scenarioId){
    return "vchoice_scenario_" + String(scenarioId || "").trim().toLowerCase();
  }

  const SKU = {
    vchoice_jetons_12:   { kind: "jetons", amount: 12,   type: "consumable" },
    vchoice_jetons_30:   { kind: "jetons", amount: 30,   type: "consumable" },
    vchoice_vcoins_1200:  { kind: "vcoins", amount: 1200,  type: "consumable" },
    vchoice_vcoins_3000: { kind: "vcoins", amount: 3000, type: "consumable" },
    vchoice_no_ads:      { kind: "no_ads", amount: 0,    type: "non_consumable" },
    vchoice_ultra:       { kind: "ultra",  amount: 0,    type: "non_consumable" }
  };

  DIRECT_SCENARIO_IDS.forEach((id) => {
    SKU[scenarioSku(id)] = { kind: "scenario", scenario: id, amount: 0, type: "non_consumable" };
  });

  const ULTRA_SCENARIOS_KNOWN = [
    "dossier14_appartement",
    "bunker_reserve",
    "hopital_ferme",
    "metro_station_zero",
    "styx_gare",
    "foret_relais",
    "chateau_absents",
    "temple_mictlan"
  ];

  function applyUltraUnlockOverride(){
    try{
      const ud = window.VUserData;
      if (!ud || ud.__vcUltraPatched) return;

      if (typeof ud.isScenarioUnlocked === "function"){
        const orig = ud.isScenarioUnlocked.bind(ud);
        ud.isScenarioUnlocked = function(id, requiredPack){
          if (hasUltra()) return true;
          return orig(id, requiredPack);
        };
      }
      ud.__vcUltraPatched = true;
    }catch(_){}
  }

  try { window.addEventListener("vc:profile", applyUltraUnlockOverride); } catch(_) {}
  try { document.addEventListener("DOMContentLoaded", applyUltraUnlockOverride, { once:true }); } catch(_) {}
  applyUltraUnlockOverride();

  const PRICES_BY_ID = Object.create(null);
  const IN_FLIGHT_TX = new Set();

  const PENDING_KEY  = "vchoice_iap_pending_v1";
  const CREDITED_KEY = "vchoice_iap_credited_v1";
  let STORE_READY = false;

  const readJson  = (k, d=[]) => { try { return JSON.parse(localStorage.getItem(k)||"null") ?? d; } catch { return d; } };
  const writeJson = (k, v)    => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function addPending(txId, productId){
    if (!txId) return;
    const L = readJson(PENDING_KEY, []);
    if (!L.find(x => x.txId === txId)){
      L.push({ txId, productId, ts: Date.now() });
      writeJson(PENDING_KEY, L.slice(-60));
    }
  }
  function removePending(txId){
    if (!txId) return;
    writeJson(PENDING_KEY, readJson(PENDING_KEY, []).filter(x => x.txId !== txId));
  }
  function isCredited(txId){
    if (!txId) return false;
    const L = readJson(CREDITED_KEY, []);
    return L.includes(txId);
  }
  function markCredited(txId){
    if (!txId) return;
    const L = readJson(CREDITED_KEY, []);
    if (!L.includes(txId)){
      L.push(txId);
      writeJson(CREDITED_KEY, L.slice(-250));
    }
  }

  function emit(name, detail){
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
  }

  window.VCIAP = window.VCIAP || {};
  window.VCIAP.isAvailable = function(){ return !!window.CdvPurchase?.store; };
  window.VCIAP.getPrice = function(productId){ return PRICES_BY_ID[String(productId || "")] || ""; };
  window.VCIAP.order = function(productId){ return safeOrder(productId); };

  window.VRIAP = window.VRIAP || {};
  if (!window.VRIAP.isAvailable) window.VRIAP.isAvailable = window.VCIAP.isAvailable;
  if (!window.VRIAP.getPrice) window.VRIAP.getPrice = window.VCIAP.getPrice;
  if (!window.VRIAP.order) window.VRIAP.order = window.VCIAP.order;

  function parseMaybeJson(x){
    try{
      if (!x) return null;
      if (typeof x === "object") return x;
      return JSON.parse(x);
    }catch{ return null; }
  }

  function getTxIdFromTx(tx){
    try{
      const rec = tx?.transaction?.receipt || tx?.receipt;
      const r = typeof rec === "string" ? parseMaybeJson(rec) : rec;
      if (r?.payload){
        const p = typeof r.payload === "string" ? parseMaybeJson(r.payload) : r.payload;
        if (p?.purchaseToken) return p.purchaseToken;
      }
    }catch(_){}
    return (
      tx?.purchaseToken ||
      tx?.androidPurchaseToken ||
      tx?.transactionId ||
      tx?.orderId ||
      tx?.id ||
      null
    );
  }

  function getProductIdFromTx(tx){
    let pid =
      tx?.products?.[0]?.id ||
      tx?.productIds?.[0] ||
      tx?.productId ||
      tx?.sku ||
      tx?.transaction?.productId ||
      tx?.transaction?.lineItems?.[0]?.productId ||
      null;

    if (!pid){
      const rec = tx?.transaction?.receipt || tx?.receipt;
      const r = typeof rec === "string" ? parseMaybeJson(rec) : rec;
      if (Array.isArray(r?.productIds) && r.productIds[0]) pid = r.productIds[0];
      else if (r?.productId) pid = r.productId;
      else if (r?.payload){
        const p = typeof r.payload === "string" ? parseMaybeJson(r.payload) : r.payload;
        pid = p?.productId || (Array.isArray(p?.productIds) && p.productIds[0]) || pid;
      }
    }
    return pid || null;
  }

  async function ensureAuthStrict(){
    try { await window.bootstrapAuthAndProfile?.(); } catch(_) {}
    try {
      const sb = window.sb;
      if (sb?.auth?.getUser){
        const r = await sb.auth.getUser();
        return r?.data?.user?.id || null;
      }
    } catch(_) {}
    return null;
  }

  async function grantUltra(txId){
    if (hasUltra()) return true;

    setUltraEntitled(true);
    applyUltraUnlockOverride();

    try{
      if (window.VUserData && typeof window.VUserData.grantEntitlement === "function"){
        await window.VUserData.grantEntitlement("diamond", {
          source:"iap",
          txId: String(txId||""),
          productId:"vchoice_ultra"
        });
      }
    }catch(e){
      warn("ULTRA remote grant failed", e?.message || e);
    }

    return true;
  }

  async function unlockScenarioDirectIap(scenarioId, productId, txId){
    const uid = await ensureAuthStrict();
    if (!uid) throw new Error("no_session");

    const sb = window.sb;
    if (!sb?.rpc) throw new Error("no_client");

    const r = await sb.rpc("secure_unlock_scenario_iap", {
      p_scenario: String(scenarioId || ""),
      p_product_id: String(productId || ""),
      p_tx_id: String(txId || "")
    });

    if (r?.error) throw new Error(r.error.message || "scenario_unlock_iap_failed");

    try { await window.VUserData?.refresh?.(); } catch(_) {}
    return true;
  }

  async function creditByProductClientSide(productId, txId){
    const cfg = SKU[productId];
    if (!cfg) throw new Error("unknown_sku");

    const uid = await ensureAuthStrict();
    if (!uid) throw new Error("no_session");

    if (cfg.kind === "no_ads" && hasNoAds() && (!txId || isCredited(txId))){
      if (txId) markCredited(txId);
      emit("vc:iap_credited", { productId:String(productId||""), kind:"no_ads", amount:0, txId:String(txId||"") });
      emit("vr:iap_credited", { productId:String(productId||""), kind:"no_ads", amount:0, txId:String(txId||"") });
      return true;
    }

    if (cfg.kind === "ultra" && hasUltra() && (!txId || isCredited(txId))){
      if (txId) markCredited(txId);
      emit("vc:iap_credited", { productId:String(productId||""), kind:"ultra", amount:0, txId:String(txId||"") });
      emit("vr:iap_credited", { productId:String(productId||""), kind:"ultra", amount:0, txId:String(txId||"") });
      return true;
    }

    if (cfg.kind === "vcoins"){
      const r = await window.VUserData?.addVCoins?.(cfg.amount);
      if (r === null || r === undefined) throw new Error("credit_vcoins_failed");
    }
    else if (cfg.kind === "jetons"){
      const r = await window.VUserData?.addJetons?.(cfg.amount);
      if (r === null || r === undefined) throw new Error("credit_jetons_failed");
    }
    else if (cfg.kind === "no_ads"){
      setNoAdsEntitled(true);
      applyUltraUnlockOverride();
      try{ await window.VUserData?.grantEntitlement?.("no_ads", { source:"iap", txId:String(txId||""), productId:String(productId||"") }); }catch(_){}
    }
    else if (cfg.kind === "ultra"){
      await grantUltra(txId);
    }
    else if (cfg.kind === "scenario"){
      await unlockScenarioDirectIap(cfg.scenario, productId, txId);
    }
    else {
      throw new Error("unknown_kind");
    }

    if (txId) markCredited(txId);

    emit("vc:iap_credited", {
      productId: String(productId || ""),
      kind: String(cfg.kind || ""),
      amount: Number(cfg.amount || 0),
      scenarioId: String(cfg.scenario || ""),
      txId: String(txId || "")
    });
    emit("vr:iap_credited", {
      productId: String(productId || ""),
      kind: String(cfg.kind || ""),
      amount: Number(cfg.amount || 0),
      scenarioId: String(cfg.scenario || ""),
      txId: String(txId || "")
    });

    return true;
  }

  function getStoreApi(){
    const S = window.CdvPurchase?.store;
    return { S };
  }

  async function replayLocalPending(){
    const pendings = readJson(PENDING_KEY, []);
    if (!pendings.length) return;

    for (const it of pendings){
      if (!it?.txId || !it?.productId) continue;
      if (isCredited(it.txId)){ removePending(it.txId); continue; }

      try{
        await creditByProductClientSide(it.productId, it.txId);
        removePending(it.txId);
      }catch(e){
        warn("replay pending failed", it.productId, it.txId, e?.message || e);
      }
    }
  }

  async function start(){
    const { S } = getStoreApi();
    if (!S) return;

    await ensureAuthStrict();

    try{
      const P = window.CdvPurchase?.ProductType;

      Object.keys(SKU).forEach((id) => {
        const cfg = SKU[id];
        const t = (cfg?.type === "non_consumable") ? P.NON_CONSUMABLE : P.CONSUMABLE;
        S.register({ id, type: t, platform: S.Platform.GOOGLE_PLAY });
      });
    }catch(e){
      warn("register failed", e?.message || e);
    }

    S.when()
      .productUpdated((p) => {
        try{
          const id = p?.id;
          const price = p?.pricing?.price || p?.pricing?.formattedPrice || null;
          if (id && price){
            PRICES_BY_ID[id] = String(price);
            emit("vc:iap_price", { productId: String(id), price: String(price) });
            emit("vr:iap_price", { productId: String(id), price: String(price) });
          }
        }catch(_){}
      })
      .approved(async (tx) => {
        const txId = getTxIdFromTx(tx);
        const productId = getProductIdFromTx(tx);
        if (!productId) return;

        if (txId && (IN_FLIGHT_TX.has(txId) || isCredited(txId))){
          try { await tx.finish(); } catch(_) {}
          return;
        }

        if (txId){
          IN_FLIGHT_TX.add(txId);
          addPending(txId, productId);
        }

        try{
          await creditByProductClientSide(productId, txId);
          removePending(txId);
        }catch(e){
          warn("credit failed", productId, txId, e?.message || e);
          if (txId) IN_FLIGHT_TX.delete(txId);
          return;
        }

        try { await tx.finish(); } catch(e){ warn("finish failed", e?.message || e); }
        if (txId) IN_FLIGHT_TX.delete(txId);
      });

    try{ await replayLocalPending(); }catch(_){}

    try{
      await S.initialize([S.Platform.GOOGLE_PLAY]);
      await S.update();
      STORE_READY = true;
    }catch(e){
      warn("store init/update failed", e?.message || e);
    }
  }

  async function safeOrder(productId){
    const { S } = getStoreApi();
    if (!S){
      emit("vc:iap_unavailable", { productId: String(productId || "") });
      emit("vr:iap_unavailable", { productId: String(productId || "") });
      return;
    }

    await ensureAuthStrict();

    if (!STORE_READY){
      try{ await S.update(); STORE_READY = true; }catch(_){}
    }

    const p = S.get ? S.get(productId, S.Platform.GOOGLE_PLAY) : (S.products?.byId?.[productId]);
    if (!p){
      emit("vc:iap_order_failed", { productId: String(productId || ""), error: "product_not_found" });
      emit("vr:iap_order_failed", { productId: String(productId || ""), error: "product_not_found" });
      return;
    }

    const offer = p.getOffer && p.getOffer();
    let err = null;
    if (offer?.order) err = await offer.order();
    else if (p?.order) err = await p.order();

    if (err?.isError){
      emit("vc:iap_order_failed", { productId: String(productId || ""), error: String(err.message || err.code || "order_error") });
      emit("vr:iap_order_failed", { productId: String(productId || ""), error: String(err.message || err.code || "order_error") });
    }
  }

  window.safeOrder = safeOrder;

  function startWhenReady(){
    const fire = () => { start().catch((e) => warn("start failed", e?.message || e)); };

    const already =
      (window.cordova && (
        (window.cordova.deviceready && window.cordova.deviceready.fired) ||
        (window.channel && window.channel.onCordovaReady && window.channel.onCordovaReady.fired)
      )) ||
      window._cordovaReady === true;

    if (already) fire();
    else {
      document.addEventListener("deviceready", function () {
        window._cordovaReady = true;
        fire();
      }, { once: true });

      setTimeout(() => { if (window._cordovaReady) fire(); }, 1200);
    }
  }

  startWhenReady();
})();