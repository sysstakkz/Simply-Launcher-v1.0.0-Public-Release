const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { analyzeCrash, tailFile, newestCrashReport } = require('./lib/crash');
const modrinth = require('./lib/modrinth');
const profiles = require('./lib/profiles');

// ======================================================================
// Dossiers
//   minecraft/   : fichiers partagés (versions, bibliothèques, ressources)
//   instances/<id>/ : dossier de jeu isolé de chaque build (mods, mondes, options, logs)
//   backgrounds/ : images de fond personnalisées (backgrounds/videos/ : fonds vidéo .mp4)
//   sounds/custom/ : sons d'interface personnalisés (.ogg / .mp3)
// ======================================================================
const ROOT = path.join(app.getPath('appData'), '.simplylauncher');
const SHARED_DIR = path.join(ROOT, 'minecraft');
const INSTANCES_DIR = path.join(ROOT, 'instances');
const BG_DIR = path.join(ROOT, 'backgrounds');
const VIDEO_DIR = path.join(BG_DIR, 'videos');
const SOUND_USER_DIR = path.join(ROOT, 'sounds', 'custom');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const INSTANCES_FILE = path.join(ROOT, 'instances.json');
const CACHE_FILE = path.join(ROOT, 'versions-cache.json');
for (const dir of [SHARED_DIR, INSTANCES_DIR, BG_DIR, VIDEO_DIR, SOUND_USER_DIR]) fs.mkdirSync(dir, { recursive: true });

const BG_README = path.join(BG_DIR, 'LISEZ-MOI.txt');
if (!fs.existsSync(BG_README)) {
  fs.writeFileSync(
    BG_README,
    [
      'Dépose ici tes images de fond (.png, .jpg, .jpeg, .webp).',
      'Pour un fond propre à une version, crée un sous-dossier portant son nom (ex. 1.20.1) et mets-y tes images.',
      'Ensuite, dans Réglages > Apparence, choisis « Mes images ».',
      '',
      'Fonds vidéo : place tes fichiers .mp4 dans le sous-dossier « videos » (ou utilise le bouton « Ajouter une vidéo »).',
      'Choisis ensuite « Vidéo (.mp4) » dans Réglages > Apparence.'
    ].join('\n')
  );
}

// ======================================================================
// Configuration générale
// ======================================================================
const DEFAULTS = {
  mode: 'offline', // 'offline' | 'microsoft'
  username: '',
  javaPath: '',
  accentColor: '#f2c14e', // couleur d'accentuation libre (#rrggbb)
  panorama: 'blocks', // blocks | images | video | off
  video: '', // nom du fichier .mp4 choisi (dans backgrounds/videos)
  blur: true, // flou « verre dépoli » (backdrop-filter) de l'interface
  sounds: true,
  eco: true, // réduit la consommation du launcher pendant que le jeu tourne
  hwAccel: true, // accélération matérielle de l'interface (redémarrage requis)
  firstRunDone: false,
  ms: null // { name, save } : jamais envoyé à l'interface
};

// Anciennes couleurs nommées (v1.1) converties en couleur libre.
const LEGACY_ACCENTS = {
  emeraude: '#17dd62', or: '#f2c14e', redstone: '#e5392b', lapis: '#4a7bff', amethyste: '#a56bff', diamant: '#3be8d1'
};
const HEX_RE = /^#[0-9a-f]{6}$/i;

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const cfg = { ...DEFAULTS, ...raw };
    if (!HEX_RE.test(String(raw.accentColor || '')) && LEGACY_ACCENTS[raw.accent]) cfg.accentColor = LEGACY_ACCENTS[raw.accent];
    delete cfg.accent;
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
function publicConfig(cfg) {
  return { ...cfg, ms: cfg.ms ? { name: cfg.ms.name } : null };
}
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur réseau ${res.status} (${url})`);
  return res.json();
}

// Doit être appelé avant que l'application soit prête.
if (loadConfig().hwAccel === false) app.disableHardwareAcceleration();

// Lecture automatique des fonds vidéo (toujours muets) sans geste de l'utilisateur.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Schéma d'URL pour servir les images, vidéos et sons locaux sans ouvrir file://
// (« stream » : nécessaire pour lire des médias avec avance rapide).
protocol.registerSchemesAsPrivileged([
  { scheme: 'slbg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const SOUND_APP_DIR = path.join(__dirname, 'renderer', 'sounds', 'custom'); // sons déposés dans le dossier du launcher
const SOUND_LEGACY_DIR = path.join(__dirname, 'renderer', 'sounds'); // emplacement de la v1.1
const MEDIA_ROOTS = { img: BG_DIR, vid: VIDEO_DIR, snd: SOUND_USER_DIR, sndapp: SOUND_APP_DIR, sndold: SOUND_LEGACY_DIR };
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg'
};

/** Sert un fichier local (avec prise en charge des requêtes « Range » indispensables à la vidéo). */
function serveMedia(request) {
  const url = new URL(request.url);
  const root = MEDIA_ROOTS[url.hostname];
  if (!root) return new Response('Introuvable', { status: 404 });
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep)) return new Response('Interdit', { status: 403 });

  let size;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    size = stat.size;
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (size === 0) return new Response(null, { status: 200, headers: { 'Content-Type': type, 'Content-Length': '0' } });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = parseInt(range[1], 10);
      if (range[2]) end = Math.min(parseInt(range[2], 10), size - 1);
    } else {
      start = Math.max(0, size - parseInt(range[2], 10));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
  }
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}

// ======================================================================
// Système et RAM
// ======================================================================
const GB = 1024 ** 3;

function recommendRam() {
  const total = Math.round(os.totalmem() / GB);
  if (total <= 4) return 2;
  if (total <= 6) return 3;
  if (total <= 8) return 4;
  if (total <= 16) return 6;
  return 8;
}
function systemInfo() {
  const total = os.totalmem() / GB;
  return {
    totalGb: Math.round(total * 10) / 10,
    freeGb: Math.round((os.freemem() / GB) * 10) / 10,
    recommendedRam: recommendRam(),
    maxRam: Math.max(2, Math.floor(total) - 1),
    cpus: os.cpus().length
  };
}
function clampRam(value) {
  const n = Math.round(Number(value)) || recommendRam();
  return Math.min(systemInfo().maxRam, Math.max(1, n));
}

// ======================================================================
// Instances (builds isolés) : instances.json
// ======================================================================
function applyInstanceFields(inst, patch) {
  if ('name' in patch) inst.name = String(patch.name || '').trim().slice(0, 40) || 'Nouveau build';
  if ('loader' in patch) inst.loader = patch.loader === 'fabric' ? 'fabric' : 'vanilla';
  if ('version' in patch) inst.version = String(patch.version || '').slice(0, 30);
  if ('ram' in patch) inst.ram = clampRam(patch.ram);
  if ('perf' in patch) inst.perf = Boolean(patch.perf);
  if ('jvmArgs' in patch) inst.jvmArgs = String(patch.jvmArgs || '').slice(0, 500);
  if ('profiles' in patch) {
    const known = profiles.profileIds();
    inst.profiles = (Array.isArray(patch.profiles) ? patch.profiles : []).filter((id) => known.includes(id));
  }
  return inst;
}
function makeInstance(patch) {
  const inst = {
    id: crypto.randomBytes(6).toString('hex'),
    name: 'Nouveau build',
    loader: 'vanilla',
    version: '',
    ram: recommendRam(),
    perf: false,
    jvmArgs: '',
    profiles: []
  };
  return applyInstanceFields(inst, patch || {});
}
const instanceDir = (id) => path.join(INSTANCES_DIR, id);
function ensureInstanceDirs(inst) {
  for (const sub of ['', 'mods', 'resourcepacks', 'saves']) {
    fs.mkdirSync(path.join(instanceDir(inst.id), sub), { recursive: true });
  }
}
function saveInstances(data) {
  fs.writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2));
}
function loadInstances() {
  let data = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.list) && parsed.list.length) data = parsed;
  } catch {}
  if (!data) {
    const first = makeInstance({ name: 'Principal' });
    data = { selected: first.id, list: [first] };
    saveInstances(data);
  }
  if (!data.list.some((i) => i.id === data.selected)) data.selected = data.list[0].id;
  data.list.forEach(ensureInstanceDirs);
  return data;
}
function getSelected() {
  const data = loadInstances();
  return data.list.find((i) => i.id === data.selected);
}

// ======================================================================
// Fenêtre
// ======================================================================
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Simply Launcher',
    backgroundColor: '#0e1f26',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};

app.whenReady().then(() => {
  protocol.handle('slbg', serveMedia);
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ======================================================================
// État, configuration, instances
// ======================================================================
ipcMain.handle('state:get', () => {
  const cfg = loadConfig();
  const firstRun = !cfg.firstRunDone;
  if (firstRun) {
    // Premier lancement : la RAM recommandée est déjà appliquée aux builds créés (voir makeInstance).
    const data = loadInstances();
    data.list.forEach((i) => (i.ram = clampRam(recommendRam())));
    saveInstances(data);
    cfg.firstRunDone = true;
    saveConfig(cfg);
  }
  return { config: publicConfig(cfg), instances: loadInstances(), system: systemInfo(), firstRun };
});

ipcMain.handle('config:set', (_e, patch) => {
  const cfg = loadConfig();
  for (const key of ['mode', 'username', 'javaPath', 'sounds', 'eco', 'hwAccel']) {
    if (key in patch) cfg[key] = patch[key];
  }
  if ('panorama' in patch && ['blocks', 'images', 'video', 'off'].includes(patch.panorama)) cfg.panorama = patch.panorama;
  if ('accentColor' in patch && HEX_RE.test(String(patch.accentColor))) cfg.accentColor = String(patch.accentColor).toLowerCase();
  if ('video' in patch) cfg.video = /\.mp4$/i.test(String(patch.video)) ? path.basename(String(patch.video)) : '';
  if ('blur' in patch) cfg.blur = Boolean(patch.blur);
  saveConfig(cfg);
  return publicConfig(cfg);
});

ipcMain.handle('instances:create', (_e, patch) => {
  const data = loadInstances();
  const inst = makeInstance(patch);
  ensureInstanceDirs(inst);
  data.list.push(inst);
  data.selected = inst.id;
  saveInstances(data);
  return data;
});

ipcMain.handle('instances:update', (_e, id, patch) => {
  const data = loadInstances();
  const inst = data.list.find((i) => i.id === id);
  if (inst) {
    applyInstanceFields(inst, patch || {});
    saveInstances(data);
  }
  return data;
});

ipcMain.handle('instances:select', (_e, id) => {
  const data = loadInstances();
  if (data.list.some((i) => i.id === id)) {
    data.selected = id;
    saveInstances(data);
  }
  return data;
});

ipcMain.handle('instances:delete', (_e, id) => {
  const data = loadInstances();
  const inst = data.list.find((i) => i.id === id);
  if (!inst) return data;
  if (data.list.length <= 1) return { ...data, error: 'Impossible de supprimer le dernier build.' };
  if (current && current.instanceId === id) return { ...data, error: 'Ce build est en cours d’utilisation.' };

  fs.rmSync(instanceDir(inst.id), { recursive: true, force: true });
  data.list = data.list.filter((i) => i.id !== id);
  if (data.selected === id) data.selected = data.list[0].id;
  saveInstances(data);
  return data;
});

ipcMain.handle('instances:open', async (_e, sub) => {
  if (!['', 'mods', 'resourcepacks', 'logs', 'saves'].includes(sub)) return;
  const dir = path.join(instanceDir(getSelected().id), sub);
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
});

ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text || ''));
});

// ======================================================================
// Versions (Mojang + Fabric)
// ======================================================================
ipcMain.handle('versions:get', async () => {
  const out = { vanilla: [], fabric: [] };
  try {
    const manifest = await getJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    out.vanilla = manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
  } catch {}
  try {
    const games = await getJson('https://meta.fabricmc.net/v2/versions/game');
    out.fabric = games.filter((v) => v.stable).map((v) => v.version);
  } catch {}

  if (out.vanilla.length || out.fabric.length) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
    return out;
  }
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); // hors connexion : dernière liste connue
  } catch {
    return out;
  }
});

// ======================================================================
// Compte Microsoft (licence)
// ======================================================================
const authManager = new Auth('select_account');
let xbox = null;

ipcMain.handle('auth:microsoft', async () => {
  try {
    xbox = await authManager.launch('electron');
    const mc = await xbox.getMinecraft();
    const cfg = loadConfig();
    cfg.ms = { name: mc.profile.name, save: xbox.save() };
    saveConfig(cfg);
    return { ok: true, name: mc.profile.name };
  } catch (err) {
    const msg = String(err && (err.message || err));
    if (msg.includes('gui.closed')) return { ok: false, error: 'Connexion annulée.' };
    return { ok: false, error: 'Connexion impossible. Ce compte possède-t-il Minecraft Java ?' };
  }
});

ipcMain.handle('auth:logout', () => {
  xbox = null;
  const cfg = loadConfig();
  cfg.ms = null;
  saveConfig(cfg);
  return publicConfig(cfg);
});

async function getMicrosoftAuth() {
  const cfg = loadConfig();
  if (!cfg.ms || !cfg.ms.save) throw new Error('Connecte-toi d’abord avec ton compte Microsoft.');
  if (!xbox) xbox = await authManager.refresh(cfg.ms.save);
  const token = await xbox.getMinecraft();
  cfg.ms.save = xbox.save(); // garde la session à jour
  saveConfig(cfg);
  return token.mclc();
}

// ======================================================================
// Fabric
// ======================================================================
async function installFabric(mcVersion) {
  const versionsDir = path.join(SHARED_DIR, 'versions');
  try {
    const loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!loaders.length) throw new Error(`Fabric ne gère pas Minecraft ${mcVersion}.`);
    const loaderVersion = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
    const profile = await getJson(
      `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`
    );
    const dir = path.join(versionsDir, profile.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
    return profile.id;
  } catch (err) {
    // Hors connexion : réutilise un Fabric déjà installé pour cette version.
    try {
      const local = fs
        .readdirSync(versionsDir)
        .filter((d) => d.startsWith('fabric-loader-') && d.endsWith(`-${mcVersion}`))
        .sort()
        .pop();
      if (local) return local;
    } catch {}
    throw err;
  }
}

// ======================================================================
// Mods (Modrinth) du build actif
// ======================================================================
const modsDirOf = (inst) => path.join(instanceDir(inst.id), 'mods');

ipcMain.handle('mods:search', async (_e, { query }) => {
  const inst = getSelected();
  try {
    return { ok: true, ...(await modrinth.search({ query, version: inst.version, loader: inst.loader })) };
  } catch {
    return { ok: false, error: 'Modrinth est injoignable. Vérifie ta connexion Internet.' };
  }
});

ipcMain.handle('mods:install', async (_e, projectId) => {
  const inst = getSelected();
  if (!/^[A-Za-z0-9]{6,12}$/.test(String(projectId))) return { ok: false, error: 'Mod invalide.' };
  if (inst.loader === 'vanilla') return { ok: false, error: 'Choisis Fabric pour ce build afin d’installer des mods.' };
  try {
    const done = await modrinth.installProject(projectId, {
      mc: inst.version,
      loader: inst.loader,
      modsDir: modsDirOf(inst)
    });
    return { ok: true, installed: done.map((d) => d.name) };
  } catch (err) {
    return { ok: false, error: err.message || 'Installation impossible.' };
  }
});

ipcMain.handle('mods:list', () => {
  try {
    return fs
      .readdirSync(modsDirOf(getSelected()))
      .filter((f) => /\.jar(\.disabled)?$/i.test(f))
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ file, enabled: !file.endsWith('.disabled') }));
  } catch {
    return [];
  }
});

ipcMain.handle('mods:toggle', (_e, file) => {
  const dir = modsDirOf(getSelected());
  const from = path.join(dir, path.basename(String(file)));
  const to = from.endsWith('.disabled') ? from.slice(0, -'.disabled'.length) : `${from}.disabled`;
  if (fs.existsSync(from)) fs.renameSync(from, to);
});

ipcMain.handle('mods:delete', (_e, file) => {
  const target = path.join(modsDirOf(getSelected()), path.basename(String(file)));
  if (fs.existsSync(target)) fs.unlinkSync(target);
});

// ======================================================================
// Packs de textures (options.txt du build actif)
// ======================================================================
function packsContext() {
  const inst = getSelected();
  const dir = instanceDir(inst.id);
  return { inst, dir, packsDir: path.join(dir, 'resourcepacks'), optionsFile: path.join(dir, 'options.txt') };
}
function readOptionsLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}
function parsePackEntries(lines) {
  const line = lines.find((l) => l.startsWith('resourcePacks:'));
  if (!line) return [];
  try {
    const arr = JSON.parse(line.slice('resourcePacks:'.length));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
function listAvailablePacks(packsDir) {
  try {
    return fs
      .readdirSync(packsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || /\.zip$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

ipcMain.handle('packs:list', () => {
  const { packsDir, optionsFile } = packsContext();
  const available = listAvailablePacks(packsDir);
  const entries = parsePackEntries(readOptionsLines(optionsFile));
  const active = [];
  const kept = [];
  for (const entry of entries) {
    const name = entry.startsWith('file/') ? entry.slice(5) : entry;
    if (available.includes(name)) active.push(name);
    else kept.push(entry); // « vanilla », packs intégrés de mods, etc. : conservés tels quels
  }
  // L'ordre du fichier va du plus bas au plus haut en priorité.
  return { active, kept, available, running: Boolean(current) };
});

ipcMain.handle('packs:save', (_e, activeNames) => {
  if (current) return { ok: false, error: 'Ferme Minecraft avant de modifier les packs de textures.' };
  const { inst, packsDir, optionsFile } = packsContext();
  const available = listAvailablePacks(packsDir);
  const lines = readOptionsLines(optionsFile);
  const entries = parsePackEntries(lines);

  const minor = parseInt(String(inst.version).split('.')[1], 10);
  const prefix = Number.isNaN(minor) || minor >= 13 ? 'file/' : '';
  const kept = entries.filter((e) => !available.includes(e.startsWith('file/') ? e.slice(5) : e));
  const next = [...kept, ...activeNames.filter((n) => available.includes(n)).map((n) => prefix + n)];

  const newLine = `resourcePacks:${JSON.stringify(next)}`;
  const index = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  if (index >= 0) lines[index] = newLine;
  else lines.push(newLine);
  fs.writeFileSync(optionsFile, lines.filter((l, i) => l !== '' || i < lines.length - 1).join('\n') + '\n');
  return { ok: true };
});

ipcMain.handle('packs:add', async () => {
  const { packsDir } = packsContext();
  const res = await dialog.showOpenDialog(win, {
    title: 'Ajouter un pack de textures',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Packs de textures (.zip)', extensions: ['zip'] }]
  });
  if (res.canceled) return 0;
  fs.mkdirSync(packsDir, { recursive: true });
  for (const file of res.filePaths) fs.copyFileSync(file, path.join(packsDir, path.basename(file)));
  return res.filePaths.length;
});

// ======================================================================
// Images de fond (panoramas)
// ======================================================================
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const listImages = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f));
  } catch {
    return [];
  }
};

ipcMain.handle('bg:list', (_e, version) => {
  const safeVersion = String(version || '').replace(/[^\w.\-]/g, '');
  let sub = '';
  let files = safeVersion ? listImages(path.join(BG_DIR, safeVersion)) : [];
  if (files.length) sub = safeVersion;
  else files = listImages(BG_DIR);
  return files.map((f) => 'slbg://img/' + [sub, f].filter(Boolean).map(encodeURIComponent).join('/'));
});

ipcMain.handle('bg:open', async (_e, sub) => {
  await shell.openPath(sub === 'videos' ? VIDEO_DIR : BG_DIR);
});

// Fonds vidéo (.mp4) : copiés dans backgrounds/videos pour être lus via slbg://vid/
const listVideos = () => {
  try {
    return fs.readdirSync(VIDEO_DIR).filter((f) => /\.mp4$/i.test(f)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};
ipcMain.handle('bg:videos', () => listVideos());

ipcMain.handle('bg:addVideo', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choisir une vidéo de fond',
    properties: ['openFile'],
    filters: [{ name: 'Vidéo MP4', extensions: ['mp4'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const name = path.basename(res.filePaths[0]);
  const target = path.join(VIDEO_DIR, name);
  if (path.resolve(res.filePaths[0]) !== path.resolve(target)) await fs.promises.copyFile(res.filePaths[0], target);
  return name;
});

// ======================================================================
// Sons d'interface personnalisés (.ogg / .mp3)
// Priorité : dossier utilisateur (AppData) > renderer/sounds/custom > renderer/sounds (v1.1) > son synthétisé
// ======================================================================
const SOUND_EVENTS = ['click', 'toggle', 'success', 'error'];
const SOUND_EXTS = ['.ogg', '.mp3'];
const SOUND_SOURCES = [
  { host: 'snd', dir: SOUND_USER_DIR, origin: 'user' },
  { host: 'sndapp', dir: SOUND_APP_DIR, origin: 'app' },
  { host: 'sndold', dir: SOUND_LEGACY_DIR, origin: 'app' }
];
const MAX_SOUND_BYTES = 5 * 1024 * 1024;

function soundsState() {
  const out = {};
  for (const name of SOUND_EVENTS) {
    out[name] = null;
    search: for (const src of SOUND_SOURCES) {
      for (const ext of SOUND_EXTS) {
        const file = path.join(src.dir, name + ext);
        try {
          const stat = fs.statSync(file);
          if (stat.isFile() && stat.size > 0) {
            out[name] = { url: `slbg://${src.host}/${name}${ext}?v=${Math.floor(stat.mtimeMs)}`, file: name + ext, origin: src.origin };
            break search;
          }
        } catch {}
      }
    }
  }
  return out;
}
const removeUserSound = (name) => {
  for (const ext of SOUND_EXTS) fs.rmSync(path.join(SOUND_USER_DIR, name + ext), { force: true });
};

ipcMain.handle('sounds:get', () => soundsState());

ipcMain.handle('sounds:pick', async (_e, name) => {
  if (!SOUND_EVENTS.includes(name)) return { ok: false, error: 'Son inconnu.' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Choisir un son (.ogg ou .mp3)',
    properties: ['openFile'],
    filters: [{ name: 'Sons (.ogg, .mp3)', extensions: ['ogg', 'mp3'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const source = res.filePaths[0];
  const ext = path.extname(source).toLowerCase();
  if (!SOUND_EXTS.includes(ext)) return { ok: false, error: 'Format non pris en charge : utilise un fichier .ogg ou .mp3.' };
  if (fs.statSync(source).size > MAX_SOUND_BYTES) return { ok: false, error: 'Fichier trop lourd (5 Mo maximum).' };
  removeUserSound(name);
  await fs.promises.copyFile(source, path.join(SOUND_USER_DIR, name + ext));
  return { ok: true, sounds: soundsState() };
});

ipcMain.handle('sounds:reset', (_e, name) => {
  if (SOUND_EVENTS.includes(name)) removeUserSound(name);
  return soundsState();
});

ipcMain.handle('sounds:open', async () => {
  await shell.openPath(SOUND_USER_DIR);
});

// ======================================================================
// Profils de mods (Performance, Beauté, PvP, mode hybride)
// ======================================================================
let profilesBusy = false;
const profileContext = () => {
  const inst = getSelected();
  return { inst, ctx: { mc: inst.version, loader: inst.loader, modsDir: modsDirOf(inst) } };
};
const cleanProfileIds = (ids) => (Array.isArray(ids) ? ids : []).filter((id) => profiles.profileIds().includes(id));

ipcMain.handle('profiles:list', () => ({ profiles: profiles.publicProfiles(), selected: getSelected().profiles || [] }));

ipcMain.handle('profiles:preview', async (_e, ids) => {
  const { inst, ctx } = profileContext();
  if (inst.loader === 'vanilla') return { ok: false, error: 'Choisis Fabric pour ce build afin d’utiliser les profils de mods.' };
  const chosen = cleanProfileIds(ids);
  if (!chosen.length) return { ok: false, error: 'Coche au moins un profil.' };
  try {
    return { ok: true, plan: await profiles.preview(chosen, ctx) };
  } catch {
    return { ok: false, error: 'Modrinth est injoignable. Vérifie ta connexion Internet.' };
  }
});

ipcMain.handle('profiles:install', async (_e, ids) => {
  const { inst, ctx } = profileContext();
  if (inst.loader === 'vanilla') return { ok: false, error: 'Choisis Fabric pour ce build afin d’utiliser les profils de mods.' };
  const chosen = cleanProfileIds(ids);
  if (!chosen.length) return { ok: false, error: 'Coche au moins un profil.' };
  if (profilesBusy) return { ok: false, error: 'Une installation est déjà en cours.' };
  profilesBusy = true;
  try {
    const result = await profiles.apply(chosen, ctx, (p) => send('profiles:progress', p));
    const data = loadInstances();
    const target = data.list.find((i) => i.id === inst.id);
    if (target) {
      applyInstanceFields(target, { profiles: chosen });
      saveInstances(data);
    }
    return { ok: true, result };
  } catch {
    return { ok: false, error: 'Modrinth est injoignable. Vérifie ta connexion Internet.' };
  } finally {
    profilesBusy = false;
  }
});

// ======================================================================
// Lancement du jeu, logs, mode éco, assistant de crash
// ======================================================================
const PERF_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1'
];

let current = null; // { instanceId, startedAt, output: string[] }

// Les lignes de logs sont envoyées par paquets pour ne pas saturer l'interface.
let logQueue = [];
let logTimer = null;
function logLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line) continue;
    if (current) {
      current.output.push(line);
      if (current.output.length > 600) current.output.splice(0, current.output.length - 600);
    }
    logQueue.push(line);
  }
  if (!logTimer) {
    logTimer = setTimeout(() => {
      logTimer = null;
      const lines = logQueue;
      logQueue = [];
      if (lines.length) send('game:log', lines);
    }, 120);
  }
}

function setEco(on) {
  if (!loadConfig().eco) return;
  try {
    win.webContents.setBackgroundThrottling(true);
    os.setPriority(process.pid, on ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL);
  } catch {}
  send('app:eco', on);
}

function buildCrashReport(inst, run, code) {
  const dir = instanceDir(inst.id);
  const text = [
    tailFile(path.join(dir, 'logs', 'latest.log')),
    newestCrashReport(path.join(dir, 'crash-reports'), run.startedAt),
    run.output.join('\n')
  ].join('\n');
  return { ...analyzeCrash(text, code), code, instance: inst.name, version: inst.version, loader: inst.loader };
}

ipcMain.handle('game:launch', async () => {
  if (current) return;
  const cfg = loadConfig();
  const inst = getSelected();
  const run = { instanceId: inst.id, startedAt: Date.now(), output: [] };
  current = run;
  let failedToStart = false;

  try {
    if (!inst.version) throw new Error('Choisis une version de Minecraft pour ce build.');

    let authorization;
    if (cfg.mode === 'microsoft') {
      send('game:status', 'Connexion au compte Microsoft…');
      authorization = await getMicrosoftAuth();
    } else {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(cfg.username)) {
        throw new Error('Pseudo invalide (3 à 16 caractères : lettres, chiffres, _).');
      }
      authorization = await Authenticator.getAuth(cfg.username);
    }

    // Allocation de RAM : jamais plus que ce que la machine peut offrir.
    const sys = systemInfo();
    const ram = Math.min(inst.ram, sys.maxRam);
    if (sys.freeGb < ram) {
      logLine(`[launcher] Attention : seulement ${sys.freeGb} Go de RAM libres pour ${ram} Go demandés. Ferme d’autres applications si le jeu rame.`);
    }

    const gameDir = instanceDir(inst.id);
    const customArgs = [];
    if (inst.perf) customArgs.push(...PERF_FLAGS);
    if (inst.jvmArgs) customArgs.push(...inst.jvmArgs.split(/\s+/).filter(Boolean));

    const opts = {
      authorization,
      root: SHARED_DIR,
      version: { number: inst.version, type: 'release' },
      memory: { max: `${ram}G`, min: inst.perf ? `${ram}G` : '1G' },
      javaPath: cfg.javaPath || 'java',
      customArgs,
      overrides: { gameDirectory: gameDir, cwd: gameDir }
    };

    if (inst.loader === 'fabric') {
      send('game:status', 'Préparation de Fabric…');
      opts.version.custom = await installFabric(inst.version);
    }

    const launcher = new Client();
    launcher.on('progress', (p) => {
      send('game:progress', { type: p.type, pct: p.total ? Math.round((p.task / p.total) * 100) : 0 });
    });
    launcher.on('debug', (m) => logLine(`[launcher] ${m}`));
    launcher.on('data', (m) => logLine(m));
    launcher.on('close', (code) => {
      if (failedToStart) return;
      const finished = current;
      current = null;
      setEco(false);
      send('game:closed', { code });
      if (finished && code !== 0 && code != null) send('game:crash', buildCrashReport(inst, finished, code));
    });

    logLine(`[launcher] Build « ${inst.name} » : ${inst.loader} ${inst.version}, ${ram} Go${inst.perf ? ', mode perfs' : ''}`);
    send('game:status', 'Téléchargement des fichiers du jeu…');
    const proc = await launcher.launch(opts);
    if (!proc) throw new Error('Impossible de lancer le jeu. Java est-il installé ? Consulte la console pour le détail.');
    proc.on('error', () => {
      failedToStart = true;
      current = null;
      setEco(false);
      send('game:error', 'Java est introuvable. Installe Java ou indique son chemin dans Réglages > Performance.');
    });

    send('game:status', 'Minecraft démarre…');
    setEco(true);
  } catch (err) {
    failedToStart = true;
    current = null;
    send('game:error', err.message || String(err));
  }
});
