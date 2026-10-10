/*
 * Profils de mods prêts à l'emploi (Fabric) et filtre anti-conflit.
 *
 * Les mods sont désignés par leur « slug » Modrinth (la fin de l'URL du projet).
 * Pour modifier un profil, il suffit d'éditer les listes ci-dessous.
 * Un slug introuvable ou sans version compatible est simplement signalé à l'utilisateur.
 */
const modrinth = require('./modrinth');

const PROFILES = [
  {
    id: 'performance',
    name: 'Performance',
    icon: '⚡',
    description: 'Plus de FPS, moins de lag, moins de mémoire utilisée.',
    mods: ['sodium', 'lithium', 'ferrite-core', 'modernfix', 'immediatelyfast', 'entityculling', 'krypton', 'dynamic-fps']
  },
  {
    id: 'beaute',
    name: 'Beauté',
    icon: '✨',
    description: 'Shaders, lumières dynamiques et textures connectées.',
    mods: ['sodium', 'iris', 'sodium-extra', 'reeses-sodium-options', 'lambdynamiclights', 'continuity']
  },
  {
    id: 'pvp',
    name: 'PvP',
    icon: '⚔️',
    description: 'Fluidité maximale et confort de combat : FPS stables, réseau allégé, zoom.',
    mods: ['sodium', 'lithium', 'ferrite-core', 'immediatelyfast', 'krypton', 'zoomify']
  }
];

/** Paires de slugs connues pour ne pas fonctionner ensemble (en plus des « incompatible » déclarés par Modrinth). */
const KNOWN_CONFLICTS = [
  ['starlight', 'scalablelux'],
  ['sodium', 'optifabric'],
  ['iris', 'optifabric'],
  ['lambdynamiclights', 'sodium-dynamic-lights']
];

const publicProfiles = () => PROFILES.map(({ id, name, icon, description, mods }) => ({ id, name, icon, description, mods }));
const profileIds = () => PROFILES.map((p) => p.id);

const primaryFile = (version) => version.files.find((f) => f.primary) || version.files[0];

/** Exécute `fn` sur chaque élément, `limit` appels en parallèle au maximum (on reste gentil avec l'API). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const incompatibleIds = (entry) =>
  (entry.version.dependencies || [])
    .filter((d) => d.dependency_type === 'incompatible' && d.project_id)
    .map((d) => d.project_id);

/** Raison pour laquelle `entry` ne peut pas rejoindre `others`, ou null s'il n'y a aucun conflit. */
function findConflict(entry, others) {
  for (const id of incompatibleIds(entry)) {
    const other = others.find((o) => o.id === id);
    if (other) return `incompatible avec ${other.title}`;
  }
  for (const other of others) {
    if (incompatibleIds(other).includes(entry.id)) return `incompatible avec ${other.title}`;
    const pair = KNOWN_CONFLICTS.some(
      ([a, b]) => (a === entry.slug && b === other.slug) || (b === entry.slug && a === other.slug)
    );
    if (pair) return `conflit connu avec ${other.title}`;
  }
  return null;
}

/** Dépendances obligatoires (récursives) d'une version, sans doublon. */
async function resolveDeps(version, ctx, have, depth = 0) {
  const out = [];
  if (depth > 4) return out;
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id || have.has(dep.project_id)) continue;
    have.add(dep.project_id);
    const v = await modrinth.pickVersion(dep.project_id, ctx.mc, ctx.loader);
    if (!v) throw new Error('une dépendance obligatoire n’a pas de version compatible');
    out.push({ id: dep.project_id, title: primaryFile(v).filename, auto: true, version: v });
    out.push(...(await resolveDeps(v, ctx, have, depth + 1)));
  }
  return out;
}

/**
 * Fusionne les profils choisis en une seule liste de mods :
 *  1. doublons supprimés (un mod présent dans plusieurs profils n'est installé qu'une fois) ;
 *  2. mods déjà installés reconnus (même sous un autre nom de fichier) et ignorés ;
 *  3. incompatibilités retirées (déclarées par Modrinth ou connues), le premier mod choisi est prioritaire ;
 *  4. dépendances obligatoires ajoutées.
 */
async function buildPlan(ids, ctx) {
  const chosen = [...new Set(ids)].map((id) => PROFILES.find((p) => p.id === id)).filter(Boolean);
  const listed = chosen.reduce((n, p) => n + p.mods.length, 0);
  const slugs = [...new Set(chosen.flatMap((p) => p.mods))];
  const summary = { install: [], already: [], removed: [], missing: [], merged: listed - slugs.length };
  if (!slugs.length) return { summary, entries: [] };

  const installed = await modrinth.identifyInstalled(ctx.modsDir);
  const [projects, presentProjects] = await Promise.all([
    modrinth.getProjects(slugs),
    modrinth.getProjects([...installed.keys()])
  ]);
  const bySlug = new Map();
  for (const p of projects) {
    bySlug.set(p.slug, p);
    bySlug.set(p.id, p);
  }
  // Mods déjà présents : ils comptent pour la détection de conflits.
  const present = presentProjects.map((p) => ({ id: p.id, slug: p.slug, title: p.title, version: { dependencies: [] } }));

  const resolved = await mapLimit(slugs, 4, async (slug) => {
    const project = bySlug.get(slug);
    if (!project) return { slug, error: 'introuvable sur Modrinth' };
    if (installed.has(project.id)) return { slug, project, already: true };
    const version = await modrinth.pickVersion(project.id, ctx.mc, ctx.loader);
    if (!version) return { slug, project, error: `aucune version pour ${ctx.loader} ${ctx.mc}` };
    return { slug, project, version };
  });

  const kept = [];
  for (const r of resolved) {
    if (r.already) {
      summary.already.push(r.project.title);
    } else if (r.error) {
      summary.missing.push({ name: r.project ? r.project.title : r.slug, reason: r.error });
    } else {
      const entry = { id: r.project.id, slug: r.project.slug, title: r.project.title, version: r.version };
      const reason = findConflict(entry, [...present, ...kept]);
      if (reason) summary.removed.push({ name: entry.title, reason });
      else kept.push(entry);
    }
  }

  const have = new Set([...installed.keys(), ...kept.map((k) => k.id)]);
  const entries = [];
  for (const k of kept) {
    try {
      const deps = await resolveDeps(k.version, ctx, have);
      entries.push(k, ...deps);
    } catch (err) {
      summary.removed.push({ name: k.title, reason: err.message });
    }
  }

  summary.install = entries.map((e) => ({ name: e.title, file: primaryFile(e.version).filename, auto: Boolean(e.auto) }));
  return { summary, entries };
}

const preview = async (ids, ctx) => (await buildPlan(ids, ctx)).summary;

/** Construit le plan puis télécharge chaque mod ; une erreur sur un mod n'arrête pas les autres. */
async function apply(ids, ctx, onProgress = () => {}) {
  const { summary, entries } = await buildPlan(ids, ctx);
  const installed = [];
  const failed = [];
  for (const [i, entry] of entries.entries()) {
    onProgress({ index: i + 1, total: entries.length, name: entry.title });
    try {
      const res = await modrinth.downloadFile(primaryFile(entry.version), ctx.modsDir);
      installed.push(res.name);
    } catch (err) {
      failed.push({ name: entry.title, error: err.message || 'échec du téléchargement' });
    }
  }
  return { ...summary, installed, failed };
}

module.exports = { publicProfiles, profileIds, preview, apply, KNOWN_CONFLICTS };
