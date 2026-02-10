// www/js/userData.js
// Version SANS module: utilise window.supabase (UMD)

(function () {
  const SUPABASE_URL = "TON_URL";
  const SUPABASE_ANON_KEY = "TON_ANON_KEY";

  let client = null;
  let session = null;
  let profile = null;

  function ensureClient() {
    if (client) return client;
    if (!window.supabase) throw new Error("Supabase JS non chargé (window.supabase absent)");
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  async function init() {
    const supa = ensureClient();

    // Auth anonyme
    const { data: authData, error: authErr } = await supa.auth.signInAnonymously();
    if (authErr) throw authErr;

    session = authData.session;

    // Profil (table profiles: id uuid pk, language text)
    const { data, error } = await supa
      .from("profiles")
      .select("language")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) throw error;

    profile = data || { language: null };
  }

  async function getLanguage() {
    if (!client) await init();
    return profile && profile.language ? profile.language : null;
  }

  async function setLanguage(lang) {
    if (!client) await init();

    const safe = String(lang || "").toLowerCase().split("-")[0];
    if (!safe) return;

    const supa = ensureClient();

    const { error } = await supa
      .from("profiles")
      .upsert({ id: session.user.id, language: safe }, { onConflict: "id" });

    if (error) throw error;

    profile = { language: safe };
  }

  // expose au moteur
  window.userData = { init, getLanguage, setLanguage };
})();
