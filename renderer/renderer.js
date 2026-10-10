const bridge = window.api;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let cfg;
let instances;
let system;
let versions = { vanilla: [], fabric: [] };
let playing = false;
let packs = { active: [], kept: [], available: [], running: false };
let dialogMode = 'create';
let dialogLoader = 'vanilla';
let lastCrash = null;
let profileData = { profiles: [] };
let profileChecked = new Set();
let profileInstanceId = null;
let profilesBusy = false;
let accentTimer = null;
const logLines = [];

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PROGRESS_LABELS = {
  assets: 'Téléchargement des ressources',
  classes: 'Téléchargement des bibliothèques',
  'classes-custom': 'Téléchargement de Fabric',
  'classes-maven-custom': 'Téléchargement de Fabric',
  natives: 'Préparation des fichiers natifs'
};

// ---------- Utilitaires ----------
const getInst = () => instances.list.find((i) => i.id === instances.selected);
const loaderName = (loader) => (loader === 'fabric' ? 'Fabric' : 'Vanilla');

function el(tag, { cls, text, attrs } = {}, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}
function button(text, cls, onClick) {
  const b = el('button', { cls: `btn ${cls || ''}`.trim(), text, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}
function setStatus(text, isError = false) {
  const node = $('#status');
  node.textContent = text;
  node.classList.toggle('error', isError);
}
function setProgress(pct) {
  $('#bar-fill').style.width = `${pct}%`;
}
function fillVersionSelect(select, loader, wanted) {
  const list = versions[loader] || [];
  select.innerHTML = '';
  for (const v of list) select.appendChild(el('option', { text: v, attrs: { value: v } }));
  const value = list.includes(wanted) ? wanted : list[0] || '';
  select.value = value;
  return value;
}

// ---------- Apparence ----------
const DEFAULT_ACCENT = '#f2c14e';
const HEX_RE = /^#[0-9a-f]{6}$/i;
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(Number(v)) || 0));
const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
// Texte noir ou blanc : celui qui contraste le mieux avec la couleur choisie.
function inkFor([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#10130f' : '#ffffff';
}

function applyAccent(hex = cfg.accentColor) {
  if (!HEX_RE.test(hex)) hex = DEFAULT_ACCENT;
  const rgb = hexToRgb(hex);
  const style = document.documentElement.style;
  style.setProperty('--accent', hex);
  style.setProperty('--accent-rgb', rgb.join(', '));
  style.setProperty('--accent-ink', inkFor(rgb));

  // Synchronise les champs sans écraser celui que l'utilisateur est en train de saisir.
  const active = document.activeElement;
  if (active !== $('#accent-hex')) $('#accent-hex').value = hex;
  $('#accent-color').value = hex;
  ['r', 'g', 'b'].forEach((c, i) => {
    if (active !== $(`#accent-${c}`)) $(`#accent-${c}`).value = rgb[i];
  });
  Background.refreshTheme();
  Background.redraw();
}

function setAccent(hex) {
  hex = hex.toLowerCase();
  cfg.accentColor = hex;
  applyAccent(hex);
  clearTimeout(accentTimer); // on n'écrit le réglage qu'une fois la couleur stabilisée
  accentTimer = setTimeout(() => bridge.setConfig({ accentColor: hex }), 300);
}

function applyBlur() {
  document.body.classList.toggle('no-blur', !cfg.blur);
}

async function refreshVideoList() {
  const videos = await bridge.listVideos();
  const select = $('#video-select');
  select.innerHTML = '';
  if (!videos.length) select.appendChild(el('option', { text: 'Aucune vidéo', attrs: { value: '' } }));
  for (const v of videos) select.appendChild(el('option', { text: v, attrs: { value: v } }));
  if (cfg.video && videos.includes(cfg.video)) select.value = cfg.video;
  else if (videos.length) select.value = videos[0];
  return videos;
}

async function applyPanorama() {
  let urls = [];
  let videoUrl = '';
  if (cfg.panorama === 'images') urls = await bridge.listBackgrounds(getInst().version);
  if (cfg.panorama === 'video') {
    const videos = await refreshVideoList();
    if (!videos.includes(cfg.video) && videos.length) {
      cfg = await bridge.setConfig({ video: videos[0] }); // première vidéo du dossier par défaut
    }
    if (videos.includes(cfg.video)) videoUrl = `slbg://vid/${encodeURIComponent(cfg.video)}`;
  }
  $('#video-row').hidden = cfg.panorama !== 'video';
  const used = Background.setMode(cfg.panorama, urls, videoUrl);
  let hint = '';
  if (cfg.panorama === 'images' && used === 0) {
    hint = 'Aucune image trouvée. Dépose des .png ou .jpg dans le dossier des fonds (un sous-dossier par version est possible).';
  } else if (cfg.panorama === 'video' && used === 0) {
    hint = 'Aucune vidéo choisie. Ajoute un fichier .mp4 avec le bouton ci-dessus.';
  } else if (cfg.panorama === 'video') {
    hint = 'La vidéo tourne en boucle, sans son. Un fichier léger (1080p max, H.264) consomme moins de ressources.';
  }
  $('#bg-hint').textContent = hint;
}

function showView(name) {
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  for (const b of $$('.nav button')) b.classList.toggle('on', b.dataset.view === name);
  if (name === 'mods') {
    renderModsContext();
    loadInstalledMods();
    if (!$('#mod-results').children.length) searchMods();
  }
  if (name === 'packs') loadPacks();
  if (name === 'profiles') loadProfiles();
}

// ---------- Compte ----------
function renderMode() {
  for (const b of $$('[data-mode]')) {
    const on = b.dataset.mode === cfg.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('#pane-offline').hidden = cfg.mode !== 'offline';
  $('#pane-ms').hidden = cfg.mode !== 'microsoft';
  refreshPlay();
}
function renderMicrosoft() {
  const connected = Boolean(cfg.ms);
  $('#ms-state').textContent = connected ? `Connecté : ${cfg.ms.name}` : 'Aucun compte connecté.';
  $('#ms-login').hidden = connected;
  $('#ms-logout').hidden = !connected;
  refreshPlay();
}

// ---------- Builds (instances) ----------
function canPlay() {
  const inst = getInst();
  if (playing || !inst || !inst.version) return false;
  if (cfg.mode === 'offline') return USERNAME_RE.test(cfg.username);
  return Boolean(cfg.ms);
}
function refreshPlay() {
  $('#play').disabled = !canPlay();
  for (const id of ['#instance', '#inst-new', '#inst-edit', '#inst-del', '#quick-perf', '#ram-apply']) {
    $(id).disabled = playing;
  }
}

function renderInstances() {
  const select = $('#instance');
  select.innerHTML = '';
  for (const i of instances.list) select.appendChild(el('option', { text: i.name, attrs: { value: i.id } }));
  select.value = instances.selected;

  const inst = getInst();
  $('#inst-summary').textContent = `${loaderName(inst.loader)}, ${inst.version || 'version à choisir'}, ${inst.ram} Go de RAM`;
  $('#quick-perf').checked = inst.perf;

  const mismatch = inst.ram !== system.recommendedRam;
  $('#ram-hint').hidden = !mismatch;
  if (mismatch) {
    $('#ram-hint-text').textContent = `Ta machine a ${system.totalGb} Go de RAM : ${system.recommendedRam} Go sont recommandés.`;
  }
  refreshPlay();
}

async function ensureVersions() {
  for (const inst of [...instances.list]) {
    if (inst.version) continue;
    const first = (versions[inst.loader] || [])[0];
    if (first) instances = await bridge.updateInstance(inst.id, { version: first });
  }
}

function openInstanceDialog(mode) {
  dialogMode = mode;
  const inst = mode === 'edit' ? getInst() : null;
  $('#inst-dialog-title').textContent = mode === 'edit' ? 'Modifier le build' : 'Nouveau build';
  $('#f-name').value = inst ? inst.name : 'Nouveau build';
  setDialogLoader(inst ? inst.loader : 'vanilla', inst ? inst.version : '');
  const max = Math.min(system.maxRam, 32);
  $('#f-ram').max = String(max);
  $('#f-ram').value = String(Math.min(inst ? inst.ram : system.recommendedRam, max));
  $('#f-ram-out').textContent = $('#f-ram').value;
  $('#f-perf').checked = inst ? inst.perf : false;
  $('#f-jvm').value = inst ? inst.jvmArgs : '';
  $('#f-error').textContent = '';
  $('#inst-dialog').showModal();
}
function setDialogLoader(loader, wantedVersion) {
  dialogLoader = loader;
  for (const b of $$('[data-floader]')) {
    const on = b.dataset.floader === loader;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  fillVersionSelect($('#f-version'), loader, wantedVersion || $('#f-version').value);
}

async function saveInstanceDialog() {
  const patch = {
    name: $('#f-name').value.trim(),
    loader: dialogLoader,
    version: $('#f-version').value,
    ram: Number($('#f-ram').value),
    perf: $('#f-perf').checked,
    jvmArgs: $('#f-jvm').value.trim()
  };
  if (!patch.name) return ($('#f-error').textContent = 'Donne un nom à ce build.');
  if (!patch.version) return ($('#f-error').textContent = 'Aucune version disponible. Vérifie ta connexion Internet.');

  instances =
    dialogMode === 'create' ? await bridge.createInstance(patch) : await bridge.updateInstance(getInst().id, patch);
  $('#inst-dialog').close();
  renderInstances();
  renderModsContext();
  applyPanorama();
}

async function deleteInstance() {
  const inst = getInst();
  const ok = window.confirm(
    `Supprimer le build « ${inst.name} » ?\nSes mods, ses mondes et ses réglages seront effacés définitivement.`
  );
  if (!ok) return;
  const res = await bridge.deleteInstance(inst.id);
  instances = res;
  if (res.error) setStatus(res.error, true);
  renderInstances();
  applyPanorama();
}

// ---------- Mods (Modrinth) ----------
function renderModsContext() {
  const inst = getInst();
  $('#mods-context').textContent =
    inst.loader === 'vanilla'
      ? `Le build « ${inst.name} » est en Vanilla. Passe-le en Fabric pour installer des mods.`
      : `Build « ${inst.name} » : ${loaderName(inst.loader)} ${inst.version}. Les résultats sont filtrés pour ce build.`;
}

async function searchMods() {
  const inst = getInst();
  const list = $('#mod-results');
  list.innerHTML = '';
  if (inst.loader === 'vanilla') {
    $('#mods-msg').textContent = 'Les mods nécessitent Fabric (bouton « Modifier » dans l’onglet Jouer).';
    return;
  }
  $('#mods-msg').textContent = 'Recherche en cours…';
  const res = await bridge.searchMods({ query: $('#mod-query').value.trim() });
  if (!res.ok) {
    $('#mods-msg').textContent = res.error;
    return;
  }
  $('#mods-msg').textContent = res.hits.length
    ? `${res.total} résultats`
    : 'Aucun mod trouvé pour cette version et ce loader.';
  for (const hit of res.hits) list.appendChild(modResult(hit));
}

function modResult(hit) {
  const safeIcon = hit.icon && hit.icon.startsWith('https://cdn.modrinth.com/');
  const icon = safeIcon ? el('img', { attrs: { src: hit.icon, alt: '', loading: 'lazy' } }) : el('div', { cls: 'icon-fallback' });
  const downloads = new Intl.NumberFormat('fr-FR').format(hit.downloads);
  const install = button('Installer', 'primary', async () => {
    install.disabled = true;
    install.textContent = 'Installation…';
    const res = await bridge.installMod(hit.id);
    if (res.ok) {
      install.textContent = 'Installé';
      Sound.play('success');
      $('#mods-msg').textContent = `Installé : ${res.installed.join(', ')}`;
      loadInstalledMods();
    } else {
      install.disabled = false;
      install.textContent = 'Installer';
      Sound.play('error');
      $('#mods-msg').textContent = res.error;
    }
  });
  return el(
    'li',
    { cls: 'item' },
    icon,
    el(
      'div',
      { cls: 'body' },
      el('div', { cls: 'name', text: hit.title }),
      el('div', { cls: 'desc', text: hit.description }),
      el('div', { cls: 'meta', text: `par ${hit.author}, ${downloads} téléchargements` })
    ),
    el('div', { cls: 'actions' }, install)
  );
}

async function loadInstalledMods() {
  const mods = await bridge.listMods();
  const list = $('#mod-installed');
  list.innerHTML = '';
  if (!mods.length) {
    list.appendChild(el('li', { cls: 'hint', text: 'Aucun mod installé dans ce build.' }));
    return;
  }
  for (const mod of mods) {
    const toggle = button(mod.enabled ? 'Désactiver' : 'Activer', 'ghost', async () => {
      await bridge.toggleMod(mod.file);
      loadInstalledMods();
    });
    const remove = button('Supprimer', 'ghost', async () => {
      await bridge.deleteMod(mod.file);
      loadInstalledMods();
    });
    const name = mod.file.replace(/\.disabled$/, '');
    list.appendChild(
      el(
        'li',
        { cls: `item${mod.enabled ? '' : ' off'}` },
        el('div', { cls: 'body' }, el('div', { cls: 'name', text: name })),
        el('div', { cls: 'actions' }, toggle, remove)
      )
    );
  }
}

// ---------- Packs de textures ----------
async function loadPacks() {
  packs = await bridge.listPacks();
  renderPacks();
}
async function persistPacks() {
  const res = await bridge.savePacks(packs.active);
  if (!res.ok) {
    $('#packs-msg').textContent = res.error;
    Sound.play('error');
    await loadPacks();
    return;
  }
  renderPacks();
}
function movePack(realIndex, delta) {
  const target = realIndex + delta;
  if (target < 0 || target >= packs.active.length) return;
  [packs.active[realIndex], packs.active[target]] = [packs.active[target], packs.active[realIndex]];
  persistPacks();
}
function renderPacks() {
  $('#packs-msg').textContent = packs.running
    ? 'Minecraft est en cours d’exécution : ferme-le pour modifier les packs.'
    : 'Le dernier pack de la liste des actifs est celui qui a la priorité la plus haute.';

  const activeList = $('#packs-active');
  activeList.innerHTML = '';
  if (!packs.active.length) activeList.appendChild(el('li', { cls: 'hint', text: 'Aucun pack actif.' }));
  const shown = [...packs.active].reverse(); // priorité haute en haut
  shown.forEach((name, displayIndex) => {
    const realIndex = packs.active.length - 1 - displayIndex;
    const up = button('↑', 'ghost', () => movePack(realIndex, +1));
    const down = button('↓', 'ghost', () => movePack(realIndex, -1));
    up.setAttribute('aria-label', 'Donner plus de priorité');
    down.setAttribute('aria-label', 'Donner moins de priorité');
    const remove = button('Retirer', 'ghost', () => {
      packs.active.splice(realIndex, 1);
      persistPacks();
    });
    for (const b of [up, down, remove]) b.disabled = packs.running;
    activeList.appendChild(
      el('li', { cls: 'item' }, el('div', { cls: 'body' }, el('div', { cls: 'name', text: name })), el('div', { cls: 'actions' }, up, down, remove))
    );
  });

  const availableList = $('#packs-available');
  availableList.innerHTML = '';
  const free = packs.available.filter((n) => !packs.active.includes(n));
  if (!free.length) availableList.appendChild(el('li', { cls: 'hint', text: 'Aucun autre pack dans le dossier.' }));
  for (const name of free) {
    const add = button('Activer', 'primary', () => {
      packs.active.push(name);
      persistPacks();
    });
    add.disabled = packs.running;
    availableList.appendChild(
      el('li', { cls: 'item' }, el('div', { cls: 'body' }, el('div', { cls: 'name', text: name })), el('div', { cls: 'actions' }, add))
    );
  }
}

// ---------- Profils de mods ----------
async function loadProfiles() {
  const inst = getInst();
  profileData = await bridge.listProfiles();
  if (profileInstanceId !== inst.id) {
    // Autre build : on repart de ses derniers profils installés.
    profileChecked = new Set(profileData.selected);
    profileInstanceId = inst.id;
    $('#profiles-plan').hidden = true;
    $('#profiles-msg').textContent = '';
  }
  renderProfiles();
}

function refreshProfileButtons() {
  const vanilla = getInst().loader === 'vanilla';
  const none = profileChecked.size === 0;
  $('#profiles-preview').disabled = profilesBusy || vanilla || none;
  $('#profiles-install').disabled = profilesBusy || vanilla || none;
}

function renderProfiles() {
  const inst = getInst();
  $('#profiles-context').textContent =
    inst.loader === 'vanilla'
      ? `Le build « ${inst.name} » est en Vanilla. Passe-le en Fabric (onglet Jouer > Modifier) pour utiliser les profils.`
      : `Build « ${inst.name} » : ${loaderName(inst.loader)} ${inst.version}. Les mods sont choisis pour cette version.`;

  const grid = $('#profile-cards');
  grid.innerHTML = '';
  for (const p of profileData.profiles) {
    const input = el('input', { attrs: { type: 'checkbox', 'aria-label': p.name } });
    input.checked = profileChecked.has(p.id);
    const card = el(
      'label',
      { cls: `profile${input.checked ? ' on' : ''}` },
      input,
      el('div', { cls: 'name', text: `${p.icon} ${p.name}` }),
      el('div', { cls: 'desc', text: p.description }),
      el('div', { cls: 'meta', text: p.mods.join(', ') })
    );
    input.addEventListener('change', () => {
      if (input.checked) profileChecked.add(p.id);
      else profileChecked.delete(p.id);
      card.classList.toggle('on', input.checked);
      $('#profiles-plan').hidden = true; // l'aperçu ne correspond plus à la sélection
      refreshProfileButtons();
    });
    grid.appendChild(card);
  }
  refreshProfileButtons();
}

function planSection(box, title, items) {
  if (!items.length) return;
  const list = el('ul', { cls: 'plain' });
  for (const item of items) list.appendChild(item);
  box.appendChild(el('div', { cls: 'plan-sec' }, el('h3', { cls: 'sub-title', text: title }), list));
}

function renderPlan(plan, outcome) {
  const box = $('#profiles-plan');
  box.innerHTML = '';
  box.hidden = false;

  if (plan.merged > 0) {
    box.appendChild(el('p', { cls: 'hint', text: `${plan.merged} doublon${plan.merged > 1 ? 's' : ''} fusionné${plan.merged > 1 ? 's' : ''} entre les profils.` }));
  }
  if (outcome) {
    planSection(box, `Installés (${outcome.installed.length})`, outcome.installed.map((n) => el('li', { text: n })));
    planSection(box, 'Échecs', outcome.failed.map((f) => el('li', { text: `${f.name} : ${f.error}` })));
  } else {
    planSection(
      box,
      `À installer (${plan.install.length})`,
      plan.install.map((m) => el('li', { text: m.name }, m.auto ? el('span', { cls: 'tag', text: 'dépendance' }) : null))
    );
  }
  planSection(box, 'Déjà installés', plan.already.map((n) => el('li', { text: n })));
  planSection(box, 'Retirés (doublon ou incompatibilité)', plan.removed.map((r) => el('li', { text: `${r.name} : ${r.reason}` })));
  planSection(box, 'Indisponibles', plan.missing.map((r) => el('li', { text: `${r.name} : ${r.reason}` })));
  if (!outcome && !plan.install.length) {
    box.appendChild(el('p', { cls: 'hint', text: 'Rien à installer : tout est déjà en place ou indisponible pour ce build.' }));
  }
}

async function previewProfiles() {
  profilesBusy = true;
  refreshProfileButtons();
  $('#profiles-msg').textContent = 'Analyse en cours…';
  const res = await bridge.previewProfiles([...profileChecked]);
  profilesBusy = false;
  refreshProfileButtons();
  if (!res.ok) {
    $('#profiles-msg').textContent = res.error;
    Sound.play('error');
    return;
  }
  $('#profiles-msg').textContent = '';
  renderPlan(res.plan);
}

async function installProfiles() {
  profilesBusy = true;
  refreshProfileButtons();
  $('#profiles-msg').textContent = 'Préparation…';
  const res = await bridge.installProfiles([...profileChecked]);
  profilesBusy = false;
  refreshProfileButtons();
  if (!res.ok) {
    $('#profiles-msg').textContent = res.error;
    Sound.play('error');
    return;
  }
  const { installed, failed } = res.result;
  renderPlan(res.result, res.result);
  $('#profiles-msg').textContent = failed.length
    ? `${installed.length} mod(s) installé(s), ${failed.length} échec(s).`
    : `Terminé : ${installed.length} mod(s) installé(s).`;
  Sound.play(failed.length ? 'error' : 'success');
  loadInstalledMods();
}

// ---------- Sons personnalisés ----------
const SOUND_LABELS = {
  click: 'Clic des boutons',
  toggle: 'Cases à cocher',
  success: 'Succès',
  error: 'Erreur'
};

function renderSoundSlots(state) {
  Sound.setFiles(state);
  const list = $('#sound-slots');
  list.innerHTML = '';
  for (const [name, label] of Object.entries(SOUND_LABELS)) {
    const info = state[name];
    const origin = !info
      ? 'Son synthétisé (par défaut)'
      : info.origin === 'user'
        ? `Personnalisé : ${info.file}`
        : `Dossier du launcher : ${info.file}`;
    const pick = button('Choisir…', '', async () => {
      const res = await bridge.pickSound(name);
      if (res.canceled) return;
      if (!res.ok) {
        $('#sound-msg').textContent = res.error;
        Sound.play('error');
        return;
      }
      $('#sound-msg').textContent = '';
      renderSoundSlots(res.sounds);
      setTimeout(() => Sound.preview(name), 150);
    });
    const test = button('Tester', 'ghost', () => Sound.preview(name));
    const reset = button('Réinitialiser', 'ghost', async () => {
      renderSoundSlots(await bridge.resetSound(name));
    });
    reset.disabled = !(info && info.origin === 'user');
    list.appendChild(
      el(
        'li',
        { cls: 'item' },
        el('div', { cls: 'body' }, el('div', { cls: 'name', text: label }), el('div', { cls: 'meta', text: origin })),
        el('div', { cls: 'actions' }, pick, test, reset)
      )
    );
  }
}

// ---------- Console ----------
function toggleConsole(open) {
  const show = open == null ? $('#console').hidden : open;
  $('#console').hidden = !show;
  document.body.classList.toggle('console-open', show);
}
function appendLog(lines) {
  const pre = $('#log');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  for (const line of lines) {
    logLines.push(line);
    if (logLines.length > 5000) logLines.shift();
    const span = el('span', { text: `${line}\n` });
    if (/\b(ERROR|FATAL)\b|Exception|Caused by/.test(line)) span.className = 'err';
    else if (/\bWARN\b/.test(line)) span.className = 'warn';
    else if (line.startsWith('[launcher]')) span.className = 'sys';
    pre.appendChild(span);
  }
  while (pre.childNodes.length > 2000) pre.removeChild(pre.firstChild);
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}
function errorExcerpt() {
  const tail = logLines.slice(-300);
  const first = tail.findIndex((l) => /Exception|Error:|FATAL|Caused by/.test(l));
  return (first >= 0 ? tail.slice(first) : tail.slice(-40)).slice(0, 120).join('\n');
}
async function copyText(text, doneMessage) {
  await bridge.copy(text);
  setStatus(doneMessage);
}

// ---------- Assistant de crash ----------
function fillList(listId, boxId, items) {
  const list = $(listId);
  list.innerHTML = '';
  for (const item of items || []) list.appendChild(el('li', { text: item }));
  if (boxId) $(boxId).hidden = !(items && items.length);
}
function showCrash(report) {
  lastCrash = report;
  $('#crash-title').textContent = report.title;
  $('#crash-text').textContent = report.explanation;
  fillList('#crash-mods', '#crash-mods-box', report.mods);
  fillList('#crash-details', '#crash-details-box', report.details);
  fillList('#crash-tips', null, report.tips);
  Sound.play('error');
  $('#crash-dialog').showModal();
}
function crashReportText() {
  const r = lastCrash;
  return [
    'Simply Launcher : rapport de crash',
    `Build : ${r.instance} (${loaderName(r.loader)} ${r.version})`,
    `Code de sortie : ${r.code}`,
    `Problème : ${r.title}`,
    r.explanation,
    r.mods.length ? `Mods concernés : ${r.mods.join(', ')}` : '',
    r.details.length ? `Détails :\n${r.details.join('\n')}` : '',
    '',
    'Dernières lignes de la console :',
    logLines.slice(-60).join('\n')
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// ---------- Initialisation ----------
async function init() {
  const [state, availableVersions] = await Promise.all([bridge.getState(), bridge.getVersions()]);
  cfg = state.config;
  instances = state.instances;
  system = state.system;
  versions = availableVersions;
  await ensureVersions();

  Sound.setEnabled(cfg.sounds);
  $('#username').value = cfg.username;
  $('#java').value = cfg.javaPath;
  $('#sounds').checked = cfg.sounds;
  $('#eco').checked = cfg.eco;
  $('#hwaccel').checked = cfg.hwAccel;
  $('#panorama').value = cfg.panorama;
  $('#blur').checked = cfg.blur;
  $('#sys-info').textContent =
    `RAM : ${system.totalGb} Go au total, ${system.freeGb} Go libres, ${system.recommendedRam} Go recommandés. ` +
    `Processeur : ${system.cpus} threads.`;

  applyBlur();
  applyAccent();
  renderMode();
  renderMicrosoft();
  renderInstances();
  applyPanorama();
  renderSoundSlots(await bridge.getSounds());
  Wiki.mount({ nav: $('#wiki-nav'), body: $('#wiki-body'), search: $('#wiki-search') });

  if (!(versions.vanilla.length || versions.fabric.length)) {
    setStatus('Impossible de récupérer les versions. Vérifie ta connexion Internet.', true);
  } else if (state.firstRun) {
    setStatus(`Mémoire réglée automatiquement sur ${system.recommendedRam} Go (${system.totalGb} Go détectés sur cette machine).`);
  }

  bindEvents();
}

function bindEvents() {
  // Sons : un clic sur n'importe quel contrôle
  document.addEventListener('click', (e) => {
    const control = e.target.closest('button, select, summary');
    if (control && !control.disabled) Sound.play('click');
    if (e.target.closest('input[type="checkbox"]')) Sound.play('toggle');
  });

  for (const b of $$('.nav button')) b.addEventListener('click', () => showView(b.dataset.view));

  // Compte
  for (const b of $$('[data-mode]')) {
    b.addEventListener('click', async () => {
      cfg = await bridge.setConfig({ mode: b.dataset.mode });
      renderMode();
    });
  }
  $('#username').addEventListener('input', async (e) => {
    cfg.username = e.target.value.trim();
    refreshPlay();
    await bridge.setConfig({ username: cfg.username });
  });
  $('#ms-login').addEventListener('click', async () => {
    setStatus('Connexion en cours…');
    const res = await bridge.loginMicrosoft();
    if (res.ok) {
      cfg.ms = { name: res.name };
      setStatus('Prêt.');
      Sound.play('success');
    } else {
      setStatus(res.error, true);
    }
    renderMicrosoft();
  });
  $('#ms-logout').addEventListener('click', async () => {
    cfg = await bridge.logout();
    renderMicrosoft();
  });

  // Builds
  $('#instance').addEventListener('change', async (e) => {
    instances = await bridge.selectInstance(e.target.value);
    renderInstances();
    renderModsContext();
    applyPanorama();
    profileInstanceId = null; // les profils sont mémorisés par build
  });
  $('#inst-new').addEventListener('click', () => openInstanceDialog('create'));
  $('#inst-edit').addEventListener('click', () => openInstanceDialog('edit'));
  $('#inst-del').addEventListener('click', deleteInstance);
  $('#quick-perf').addEventListener('change', async (e) => {
    instances = await bridge.updateInstance(getInst().id, { perf: e.target.checked });
    renderInstances();
  });
  $('#ram-apply').addEventListener('click', async () => {
    instances = await bridge.updateInstance(getInst().id, { ram: system.recommendedRam });
    renderInstances();
  });
  $('#open-game-dir').addEventListener('click', () => bridge.openFolder(''));
  $('#open-mods').addEventListener('click', () => bridge.openFolder('mods'));

  // Dialogue de build
  for (const b of $$('[data-floader]')) b.addEventListener('click', () => setDialogLoader(b.dataset.floader));
  $('#f-ram').addEventListener('input', (e) => ($('#f-ram-out').textContent = e.target.value));
  $('#f-cancel').addEventListener('click', () => $('#inst-dialog').close());
  $('#f-save').addEventListener('click', saveInstanceDialog);

  // Mods
  $('#mod-search').addEventListener('click', searchMods);
  $('#mod-query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchMods();
  });

  // Packs
  $('#pack-add').addEventListener('click', async () => {
    const count = await bridge.addPacks();
    if (count) loadPacks();
  });
  $('#pack-folder').addEventListener('click', () => bridge.openFolder('resourcepacks'));

  // Réglages
  // Sélecteur de couleur libre : roue native, HEX ou RGB
  $('#accent-color').addEventListener('input', (e) => setAccent(e.target.value));
  $('#accent-hex').addEventListener('input', (e) => {
    let v = e.target.value.trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join('')}`; // #abc -> #aabbcc
    if (HEX_RE.test(v)) setAccent(v);
  });
  $('#accent-hex').addEventListener('blur', () => applyAccent());
  for (const c of ['r', 'g', 'b']) {
    $(`#accent-${c}`).addEventListener('input', () => {
      setAccent(rgbToHex($('#accent-r').value, $('#accent-g').value, $('#accent-b').value));
    });
    $(`#accent-${c}`).addEventListener('blur', () => applyAccent());
  }
  $('#accent-reset').addEventListener('click', () => setAccent(DEFAULT_ACCENT));

  $('#panorama').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ panorama: e.target.value });
    applyPanorama();
  });
  $('#bg-open').addEventListener('click', () => bridge.openBackgrounds());
  $('#video-select').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ video: e.target.value });
    applyPanorama();
  });
  $('#video-add').addEventListener('click', async () => {
    const name = await bridge.addVideo();
    if (!name) return;
    cfg = await bridge.setConfig({ video: name });
    applyPanorama();
  });
  $('#video-open').addEventListener('click', () => bridge.openBackgrounds('videos'));
  Background.onVideoError(() => {
    $('#bg-hint').textContent = 'Impossible de lire cette vidéo. Utilise un .mp4 encodé en H.264, ou choisis-en une autre.';
    Sound.play('error');
  });
  $('#blur').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ blur: e.target.checked });
    applyBlur();
  });
  $('#sound-folder').addEventListener('click', () => bridge.openSounds());

  // Profils
  $('#profiles-preview').addEventListener('click', previewProfiles);
  $('#profiles-install').addEventListener('click', installProfiles);
  $('#sounds').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ sounds: e.target.checked });
    Sound.setEnabled(cfg.sounds);
  });
  $('#eco').addEventListener('change', async (e) => (cfg = await bridge.setConfig({ eco: e.target.checked })));
  $('#hwaccel').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ hwAccel: e.target.checked });
    setStatus('Redémarre le launcher pour appliquer l’accélération matérielle.');
  });
  $('#java').addEventListener('change', async (e) => {
    cfg = await bridge.setConfig({ javaPath: e.target.value.trim() });
  });

  // Console
  $('#console-toggle').addEventListener('click', () => toggleConsole());
  $('#log-close').addEventListener('click', () => toggleConsole(false));
  $('#log-clear').addEventListener('click', () => {
    logLines.length = 0;
    $('#log').textContent = '';
  });
  $('#log-copy').addEventListener('click', () => copyText(logLines.join('\n'), 'Console copiée.'));
  $('#log-copy-error').addEventListener('click', () => copyText(errorExcerpt(), 'Erreur copiée.'));
  $('#log-open').addEventListener('click', () => bridge.openFolder('logs'));

  // Crash
  $('#crash-copy').addEventListener('click', () => copyText(crashReportText(), 'Rapport copié.'));
  $('#crash-console').addEventListener('click', () => {
    $('#crash-dialog').close();
    toggleConsole(true);
  });
  $('#crash-close').addEventListener('click', () => $('#crash-dialog').close());

  // Jeu
  $('#play').addEventListener('click', () => {
    playing = true;
    refreshPlay();
    setProgress(0);
    setStatus('Préparation…');
    appendLog(['[launcher] Nouveau lancement']);
    bridge.launch();
  });

  bridge.on('game:status', (msg) => setStatus(msg));
  bridge.on('game:progress', ({ type, pct }) => {
    setStatus(`${PROGRESS_LABELS[type] || 'Téléchargement'} : ${pct} %`);
    setProgress(pct);
  });
  bridge.on('game:log', (lines) => appendLog(lines));
  bridge.on('game:closed', ({ code }) => {
    playing = false;
    setProgress(0);
    refreshPlay();
    if (code !== 0 && code != null) setStatus(`Minecraft s’est arrêté avec une erreur (code ${code}).`, true);
    else setStatus('Minecraft est fermé. Prêt à rejouer.');
  });
  bridge.on('game:error', (msg) => {
    playing = false;
    setProgress(0);
    setStatus(msg, true);
    Sound.play('error');
    refreshPlay();
  });
  bridge.on('game:crash', showCrash);
  bridge.on('profiles:progress', ({ index, total, name }) => {
    $('#profiles-msg').textContent = `Installation ${index}/${total} : ${name}`;
  });
  bridge.on('app:eco', (on) => {
    document.body.classList.toggle('eco', on);
    Background.setPaused(on);
  });
}

init();
