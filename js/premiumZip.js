(function () {
  "use strict";

  const STORE_KEY = "vchoice_premium_zip_v1";
  const DATA_DIR = "DATA";

  function getCap() {
    return window.Capacitor || null;
  }

  function isNative() {
    const cap = getCap();
    if (!cap) return false;

    try {
      if (typeof cap.isNativePlatform === "function") {
        return !!cap.isNativePlatform();
      }
    } catch (_) {}

    try {
      if (typeof cap.getPlatform === "function") {
        return cap.getPlatform() !== "web";
      }
    } catch (_) {}

    return false;
  }

  function getPlugin(name) {
    const cap = getCap();
    if (!cap) return null;

    try {
      if (cap.Plugins && cap.Plugins[name]) return cap.Plugins[name];
    } catch (_) {}

    try {
      if (typeof cap.registerPlugin === "function") {
        return cap.registerPlugin(name);
      }
    } catch (_) {}

    return null;
  }

  function getFilesystem() {
    return getPlugin("Filesystem");
  }

  function getFileTransfer() {
    return getPlugin("FileTransfer");
  }

  function getZipPlugin() {
    return (
      getPlugin("CapacitorZip") ||
      getPlugin("Zip") ||
      null
    );
  }

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveStore(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data || {}));
    } catch (_) {}
  }

  function norm(v) {
    return String(v || "").trim().toLowerCase();
  }

  function basename(p) {
    const clean = String(p || "").split("?")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1] || "";
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function getRemoteImageNames(logic) {
    const out = [];
    const seen = new Set();
    const images = logic?.images || {};

    Object.keys(images).forEach((key) => {
      const item = images[key];
      const file = typeof item === "string" ? item : item?.file;
      const name = basename(file);
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });

    return out;
  }

  async function getRemoteRow(scenarioId) {
    const { data, error } = await window.sb
      .from("scenario_asset_versions")
      .select("scenario_id, version, bucket_name, object_path, active")
      .eq("scenario_id", scenarioId)
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1);

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new Error("missing_remote_row");
    return row;
  }

  function publicUrl(bucketName, objectPath) {
    const r = window.sb.storage.from(bucketName).getPublicUrl(objectPath);
    const url = r?.data?.publicUrl || "";
    if (!url) throw new Error("missing_public_url");
    return url;
  }

  async function ensureDir(path) {
    const Filesystem = getFilesystem();
    if (!Filesystem?.mkdir) throw new Error("filesystem_missing");

    try {
      await Filesystem.mkdir({
        directory: DATA_DIR,
        path,
        recursive: true
      });
    } catch (_) {}
  }

  async function exists(path) {
    const Filesystem = getFilesystem();
    if (!Filesystem?.stat) return false;

    try {
      await Filesystem.stat({
        directory: DATA_DIR,
        path
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function uriFor(path) {
    const Filesystem = getFilesystem();
    if (!Filesystem?.getUri) throw new Error("filesystem_missing");

    const res = await Filesystem.getUri({
      directory: DATA_DIR,
      path
    });

    const uri = res?.uri || "";
    if (!uri) throw new Error("missing_uri");
    return uri;
  }

  async function downloadZip(zipUrl, zipPath) {
    const Filesystem = getFilesystem();
    const FileTransfer = getFileTransfer();

    if (!Filesystem?.getUri) throw new Error("filesystem_missing");
    if (!FileTransfer?.downloadFile) throw new Error("filetransfer_missing");

    const info = await Filesystem.getUri({
      directory: DATA_DIR,
      path: zipPath
    });

    await FileTransfer.downloadFile({
      url: zipUrl,
      path: info.uri,
      progress: true
    });
  }

  async function unzipZip(zipPath, destPath) {
    const Zip = getZipPlugin();
    if (!Zip?.unzip) throw new Error("zip_plugin_missing");

    const zipUri = await uriFor(zipPath);
    const destUri = await uriFor(destPath);

    await Zip.unzip({
      source: zipUri,
      destination: destUri
    });
  }

  function localWebUrl(path) {
    const cap = getCap();
    if (!cap?.convertFileSrc) return path;
    return cap.convertFileSrc(path);
  }

  async function buildLocalMap(scenarioId, version, imageNames) {
    const map = {};

    for (const fileName of imageNames) {
      const rel = `premium_scenarios/${scenarioId}/${version}/files/img/${fileName}`;
      const nativeUri = await uriFor(rel);
      map[fileName] = localWebUrl(nativeUri);
    }

    return map;
  }

  function patchLogic(logic, fileMap) {
    const out = clone(logic);
    const images = out?.images || {};

    Object.keys(images).forEach((key) => {
      const item = images[key];
      const oldFile = typeof item === "string" ? item : item?.file;
      const name = basename(oldFile);

      if (!name || !fileMap[name]) return;

      if (typeof item === "string") {
        images[key] = fileMap[name];
      } else {
        images[key] = {
          ...item,
          file: fileMap[name]
        };
      }
    });

    return out;
  }

  async function ensurePremiumScenarioReady(scenarioId, logic, onProgress) {
    if (!isNative()) {
      throw new Error("premium_native_only");
    }

    const id = norm(scenarioId);
    const row = await getRemoteRow(id);

    const version = String(row.version || "v1");
    const zipObjectPath = String(row.object_path || "");
    const bucketName = String(row.bucket_name || "");

    if (!/\.zip$/i.test(zipObjectPath)) {
      throw new Error("remote_path_is_not_zip");
    }

    const zipUrl = publicUrl(bucketName, zipObjectPath);
    const baseDir = `premium_scenarios/${id}/${version}`;
    const zipPath = `${baseDir}/images.zip`;
    const extractDir = `${baseDir}/files`;

    const imageNames = getRemoteImageNames(logic);
    const store = loadStore();
    const prev = store[id];

    const probeFile = imageNames[0] || "s01.webp";

    const alreadyReady =
      prev &&
      prev.version === version &&
      await exists(`${extractDir}/img/${probeFile}`);

    if (!alreadyReady) {
      await ensureDir(baseDir);
      await ensureDir(extractDir);

      onProgress?.("download");
      await downloadZip(zipUrl, zipPath);

      onProgress?.("unzip");
      await unzipZip(zipPath, extractDir);

      store[id] = {
        version,
        ready: true,
        updatedAt: Date.now()
      };
      saveStore(store);
    }

    const localMap = await buildLocalMap(id, version, imageNames);
    const patchedLogic = patchLogic(logic, localMap);

    return {
      ok: true,
      logic: patchedLogic,
      version
    };
  }

  window.ensurePremiumScenarioReady = ensurePremiumScenarioReady;
})();
