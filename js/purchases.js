// js/purchases.js
/* global CdvPurchase */
// VChoice — IAP minimal “clean” (même pattern events que l’autre app)
// - Expose window.VCIAP (et alias VRIAP si tu veux compat)
// - Emit:
//    vc:iap_price  / vr:iap_price
//    vc:iap_credited / vr:iap_credited
// - Anti double-credit + replay local pending

(function () {
  "use strict";

  const DEBUG = false; // mets true si tu veux logs
  const log = (...a) => { if (DEBUG) console.log("[VC-IAP]", ...a); };
  const warn = (...a) => { if (DEBUG) console.warn("[VC-IAP]", ...a); };

  // ---- SKU (reprend les mêmes IDs que l’autre app par défaut)
  // Si VChoice a ses propres produits Play Console, change ici.
  const SKU = {
    vrealms_coins_300:  { kind: "vcoins", amount: 300 },
    vrealms_coins_500:  { kind: "vcoins", amount: 500 },
    vrealms_coins_3000: { kind: "vcoins", amount: 3000 }
  };

  // ---- Anti double-credit
  const PRICES_BY_ID = Object.create(null);
  const IN_FLIGHT_TX = new Set();

  const PENDING_KEY  = "vchoice_iap_pending_v1";   // [{txId, productId, ts}]
  const CREDITED_KEY = "vchoice_iap_credited_v1";  // [txId]
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

  // ---- Expose API
  window.VCIAP = window.VCIAP || {};
  window.VCIAP.isAvailable = function(){ return !!window.CdvPurchase?.store; };
  window.VCIAP.getPrice = function(productId){ return PRICES_BY_ID[String(productId || "")] || ""; };
  window.VCIAP.order = function(productId){ return safeOrder(productId); };

  // compat: certains écrans utilisent VRIAP
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
    // Si tu as supabaseBootstrap + anon auth:
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

  async function creditByProductClientSide(productId, txId){
    const cfg = SKU[productId];
    if (!cfg) throw new Error("unknown_sku");

    const uid = await ensureAuthStrict();
    if (!uid) throw new Error("no_session");

    if (cfg.kind === "vcoins"){
      const r = await window.VUserData?.addVcoins?.(cfg.amount);
      if (r === null || r === undefined) throw new Error("credit_vcoins_failed");
    } else {
      throw new Error("unknown_kind");
    }

    if (txId) markCredited(txId);

    // events (vc + compat vr)
    emit("vc:iap_credited", { productId: String(productId || ""), kind: String(cfg.kind || ""), amount: Number(cfg.amount || 0), txId: String(txId || "") });
    emit("vr:iap_credited", { productId: String(productId || ""), kind: String(cfg.kind || ""), amount: Number(cfg.amount || 0), txId: String(txId || "") });

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
    if (!S) return; // web => silence

    await ensureAuthStrict();

    try{
      const P = window.CdvPurchase?.ProductType;
      // enregistre uniquement ceux listés dans SKU
      Object.keys(SKU).forEach((id) => {
        S.register({ id, type: P.CONSUMABLE, platform: S.Platform.GOOGLE_PLAY });
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
            emit("vr:iap_price", { productId: String(id), price: String(price) }); // compat
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
          // on laisse pending pour replay
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
