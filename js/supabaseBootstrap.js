// js/supabaseBootstrap.js
// ✅ Mets tes clés ICI (et seulement ici). Aucun autre fichier ne contient de clé.
// - Expose window.sb (client Supabase)
// - Assure une session anon (signInAnonymously) si besoin
// - Optionnel: window.bootstrapAuthAndProfile() utilisé par userData.js

(function () {
  "use strict";

  // ===========================
  // 🔧 A REMPLIR PAR TOI
  // ===========================
  const SUPABASE_URL = "https://TON-PROJET.supabase.co";
  const SUPABASE_ANON_KEY = "TON-ANON-KEY";

  // Nom global attendu par le reste du code
  const GLOBAL_CLIENT_NAME = "sb";

  // ===========================
  // Helpers
  // ===========================
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _hasSupabaseLib() {
    return !!(window.supabase && typeof window.supabase.createClient === "function");
  }

  function _getClient() { return window[GLOBAL_CLIENT_NAME]; }

  // ===========================
  // Create client (singleton)
  // ===========================
  function createClientOnce() {
    if (_getClient()) return _getClient();

    if (!_hasSupabaseLib()) {
      throw new Error("Supabase JS lib missing: add https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

    window[GLOBAL_CLIENT_NAME] = client;
    return client;
  }

  // ===========================
  // Ensure anon session
  // ===========================
  async function ensureAnonSession() {
    const sb = _getClient() || createClientOnce();

    // 1) session déjà là ?
    try {
      const { data } = await sb.auth.getSession();
      if (data?.session) return data.session;
    } catch (_) {}

    // 2) user déjà là ?
    try {
      const { data } = await sb.auth.getUser();
      if (data?.user) {
        const { data: s2 } = await sb.auth.getSession();
        if (s2?.session) return s2.session;
      }
    } catch (_) {}

    // 3) login anon
    try {
      const res = await sb.auth.signInAnonymously();
      if (res?.data?.session) return res.data.session;
    } catch (e) {
      // Petite tolérance: parfois session dispo juste après
      await _sleep(250);
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session) return data.session;
      } catch (_) {}
      throw e;
    }

    // fallback final
    const { data: last } = await sb.auth.getSession();
    return last?.session || null;
  }

  // ===========================
  // Public API
  // ===========================
  // Attendre que window.sb soit prêt
  window.vcWaitBootstrap = async function vcWaitBootstrap() {
    if (_getClient()) return true;
    createClientOnce();
    return true;
  };

  // Bootstrap complet: client + anon + (optionnel) refresh profile
  window.bootstrapAuthAndProfile = async function bootstrapAuthAndProfile() {
    const sb = _getClient() || createClientOnce();
    const session = await ensureAnonSession();

    // Optionnel: si userData.js est chargé, on refresh le profil
    try {
      if (window.VUserData && typeof window.VUserData.refresh === "function") {
        await window.VUserData.refresh();
      }
    } catch (_) {}

    return session?.user || null;
  };

  // Auto-init (silencieux)
  try {
    createClientOnce();
  } catch (_) {}
})();
