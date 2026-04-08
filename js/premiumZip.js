import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { CapacitorZip } from '@capgo/capacitor-zip';

const STORE_KEY = 'vchoice_premium_zip_v1';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveStore(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data || {}));
}

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function basename(p) {
  const clean = String(p || '').split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || '';
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
    const file = typeof item === 'string' ? item : item?.file;
    const name = basename(file);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });

  return out;
}

async function getRemoteRow(scenarioId) {
  const { data, error } = await window.sb
    .from('scenario_asset_versions')
    .select('scenario_id, version, bucket_name, object_path, active')
    .eq('scenario_id', scenarioId)
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('missing_remote_row');
  return row;
}

function publicUrl(bucketName, objectPath) {
  const r = window.sb.storage.from(bucketName).getPublicUrl(objectPath);
  const url = r?.data?.publicUrl || '';
  if (!url) throw new Error('missing_public_url');
  return url;
}

async function ensureDir(path) {
  try {
    await Filesystem.mkdir({
      directory: Directory.Data,
      path,
      recursive: true
    });
  } catch {}
}

async function exists(path) {
  try {
    await Filesystem.stat({
      directory: Directory.Data,
      path
    });
    return true;
  } catch {
    return false;
  }
}

async function uriFor(path) {
  const { uri } = await Filesystem.getUri({
    directory: Directory.Data,
    path
  });
  return uri;
}

async function downloadZip(zipUrl, zipPath) {
  const info = await Filesystem.getUri({
    directory: Directory.Data,
    path: zipPath
  });

  await FileTransfer.downloadFile({
    url: zipUrl,
    path: info.uri,
    progress: true
  });
}

async function unzipZip(zipPath, destPath) {
  const zipUri = await uriFor(zipPath);
  const destUri = await uriFor(destPath);

  await CapacitorZip.unzip({
    source: zipUri,
    destination: destUri
  });
}

function localWebUrl(path) {
  const raw = Capacitor.convertFileSrc(path);
  return raw;
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
    const oldFile = typeof item === 'string' ? item : item?.file;
    const name = basename(oldFile);
    if (!name || !fileMap[name]) return;

    if (typeof item === 'string') {
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

export async function ensurePremiumScenarioReady(scenarioId, logic, onProgress) {
  const id = norm(scenarioId);
  const row = await getRemoteRow(id);

  const version = String(row.version || 'v1');
  const zipObjectPath = String(row.object_path || '');
  const bucketName = String(row.bucket_name || '');

  if (!/\.zip$/i.test(zipObjectPath)) {
    throw new Error('remote_path_is_not_zip');
  }

  const zipUrl = publicUrl(bucketName, zipObjectPath);
  const baseDir = `premium_scenarios/${id}/${version}`;
  const zipPath = `${baseDir}/images.zip`;
  const extractDir = `${baseDir}/files`;

  const imageNames = getRemoteImageNames(logic);
  const store = loadStore();
  const prev = store[id];

  const alreadyReady =
    prev &&
    prev.version === version &&
    await exists(`${extractDir}/img/${imageNames[0] || 's01.webp'}`);

  if (!alreadyReady) {
    await ensureDir(baseDir);
    await ensureDir(extractDir);

    onProgress?.('download');
    await downloadZip(zipUrl, zipPath);

    onProgress?.('unzip');
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
