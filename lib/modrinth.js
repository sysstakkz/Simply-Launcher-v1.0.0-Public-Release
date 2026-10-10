const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = 'https://api.modrinth.com/v2';
// Modrinth demande un User-Agent qui identifie l'application.
const HEADERS = { 'User-Agent': 'SimplyLauncher/1.2.0 (launcher Minecraft open source)' };

async function api(route, init = {}) {
  const res = await fetch(API + route, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Modrinth a répondu ${res.status}`);
  return res.json();
}

/** Recherche de mods filtrée par version et loader du build actif. */
async function search({ query, version, loader, offset = 0 }) {
  const facets = [['project_type:mod']];
  if (version) facets.push([`versions:${version}`]);
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);

  const params = new URLSearchParams({
    query: query || '',
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(offset),
    index: query ? 'relevance' : 'downloads'
  });
  const data = await api(`/search?${params}`);
  return {
    total: data.total_hits,
    hits: data.hits.map((h) => ({
      id: h.project_id,
      title: h.title,
      description: h.description,
      author: h.author,
      downloads: h.downloads,
      icon: h.icon_url || ''
    }))
  };
}

async function pickVersion(projectId, mc, loader) {
  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([mc])
  });
  const versions = await api(`/project/${projectId}/version?${params}`);
  if (!versions.length) return null;
  return versions.find((v) => v.version_type === 'release') || versions[0];
}

async function downloadFile(file, modsDir) {
  const target = path.join(modsDir, path.basename(file.filename));
  if (fs.existsSync(target)) return { name: file.filename, skipped: true };

  const res = await fetch(file.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const expected = file.hashes && file.hashes.sha1;
  if (expected) {
    const actual = crypto.createHash('sha1').update(buffer).digest('hex');
    if (actual !== expected) throw new Error('Fichier corrompu (empreinte SHA-1 différente).');
  }
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(target, buffer);
  return { name: file.filename, skipped: false };
}

/**
 * Installe un mod et ses dépendances obligatoires dans `modsDir`.
 * @returns {Promise<{name:string, skipped:boolean}[]>}
 */
async function installProject(projectId, { mc, loader, modsDir }, seen = new Set(), depth = 0) {
  if (seen.has(projectId) || depth > 4) return [];
  seen.add(projectId);

  const version = await pickVersion(projectId, mc, loader);
  if (!version) {
    throw new Error(`Aucune version compatible avec ${loader} ${mc}.`);
  }
  const file = version.files.find((f) => f.primary) || version.files[0];
  const done = [await downloadFile(file, modsDir)];

  for (const dep of version.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      done.push(...(await installProject(dep.project_id, { mc, loader, modsDir }, seen, depth + 1)));
    }
  }
  return done;
}

/** Infos de plusieurs projets (identifiants ou slugs) en un seul appel. */
async function getProjects(refs) {
  if (!refs.length) return [];
  return api(`/projects?${new URLSearchParams({ ids: JSON.stringify(refs) })}`);
}

/**
 * Reconnaît les mods déjà présents dans `modsDir` grâce à l'empreinte SHA-1 de leurs fichiers.
 * @returns {Promise<Map<string,string>>} identifiant de projet -> nom de fichier
 */
async function identifyInstalled(modsDir) {
  const found = new Map();
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter((f) => /\.jar(\.disabled)?$/i.test(f));
  } catch {
    return found;
  }
  const byHash = new Map();
  for (const f of files) {
    try {
      byHash.set(crypto.createHash('sha1').update(fs.readFileSync(path.join(modsDir, f))).digest('hex'), f);
    } catch {}
  }
  if (!byHash.size) return found;
  try {
    const data = await api('/version_files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: [...byHash.keys()], algorithm: 'sha1' })
    });
    for (const [hash, version] of Object.entries(data)) found.set(version.project_id, byHash.get(hash));
  } catch {}
  return found;
}

module.exports = { search, installProject, pickVersion, downloadFile, getProjects, identifyInstalled };
