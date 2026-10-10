const fs = require('fs');
const path = require('path');

/** Lit les derniers octets d'un fichier (pour ne pas charger un énorme latest.log). */
function tailFile(file, maxBytes = 300000) {
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/** Retourne le contenu du rapport de crash le plus récent, créé après `since` (ms). */
function newestCrashReport(dir, since) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 1000)
      .sort((a, b) => b.t - a.t);
    return files.length ? tailFile(path.join(dir, files[0].f)) : '';
  } catch {
    return '';
  }
}

const unique = (arr) => [...new Set(arr)];

/** Mods cités comme « suspects » dans un rapport de crash. */
function suspectedMods(text) {
  const m = text.match(/Suspected Mods?:\s*\n?\s*([^\n]+)/);
  if (!m || /^none/i.test(m[1].trim())) return [];
  return unique(
    m[1]
      .split(/,\s*(?=[^,]*\()/)
      .map((s) => s.replace(/,?\s*Version:.*$/i, '').trim())
      .filter(Boolean)
  );
}

const JAVA_BY_CLASS = { 52: 8, 53: 9, 54: 10, 55: 11, 60: 16, 61: 17, 62: 18, 63: 19, 64: 20, 65: 21, 66: 22 };

const RULES = [
  {
    test: /OutOfMemoryError|GC overhead limit exceeded/,
    build: () => ({
      title: 'Minecraft a manqué de mémoire',
      explanation:
        'Le jeu a utilisé toute la RAM qui lui était allouée. Cela arrive avec beaucoup de mods, une grande distance d’affichage ou un pack de textures très lourd.',
      tips: [
        'Augmente la mémoire du build (bouton « Modifier »).',
        'Réduis la distance d’affichage dans les options vidéo.',
        'Retire les mods ou textures les plus lourds.'
      ]
    })
  },
  {
    test: /Could not reserve enough space|Invalid maximum heap size|Invalid initial heap size|too large for 32-bit|Error occurred during initialization of VM/,
    build: () => ({
      title: 'Trop de mémoire demandée à Java',
      explanation:
        'Java n’a pas pu réserver la quantité de RAM demandée. Soit elle dépasse ce que ton ordinateur peut offrir, soit tu utilises un Java 32 bits.',
      tips: [
        'Diminue la mémoire du build (bouton « Modifier »).',
        'Installe un Java 64 bits (Temurin 17 ou 21, par exemple).'
      ]
    })
  },
  {
    test: /UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime/,
    build: (text) => {
      const m = text.match(/class file version (\d+)/);
      const need = m && JAVA_BY_CLASS[Number(m[1])];
      return {
        title: 'Version de Java incompatible',
        explanation: need
          ? `Ce build demande au minimum Java ${need}, mais Java utilisé est trop ancien.`
          : 'La version de Java utilisée est trop ancienne pour ce build.',
        tips: [
          'Minecraft 1.20.5 et plus : Java 21. Minecraft 1.18 à 1.20.4 : Java 17.',
          'Indique le bon Java dans Réglages, section « Performance ».'
        ]
      };
    }
  },
  {
    test: /Duplicate mods? (?:found|detected)|Duplicate mod ID|DuplicateModsFoundException/i,
    build: (text) => {
      const mods = unique([...text.matchAll(/\bmod ['"]?([\w\-.]+)['"]? (?:is )?(?:present|found) (?:in|more)/gi)].map((x) => x[1]));
      return {
        title: 'Un mod est installé en double',
        explanation: 'Fabric a trouvé plusieurs fichiers pour le même mod et refuse de démarrer.',
        mods,
        tips: ['Ouvre l’onglet Mods et supprime la version en trop (garde la plus récente).']
      };
    }
  },
  {
    test: /Incompatible mods found|Mod resolution failed|ModResolutionException|requires (?:any|version)[^\n]*which is missing/i,
    build: (text) => {
      const lines = unique(
        [...text.matchAll(/[^\n]*Mod '[^']+' \([^)]+\)[^\n]*(?:requires|breaks|conflicts|incompatible)[^\n]*/gi)].map((m) =>
          m[0].replace(/^\s*(?:\[[^\]]*\]\s*)*(?:-\s*)?/, '').trim()
        )
      ).slice(0, 6);
      const mods = unique([...text.matchAll(/Mod '([^']+)' \(([^)]+)\)/g)].map((m) => `${m[1]} (${m[2]})`)).slice(0, 8);
      const needsApi = /fabric-api|Fabric API/i.test(text);
      return {
        title: 'Des mods sont en conflit ou il manque une dépendance',
        explanation:
          'Fabric a refusé de démarrer : un ou plusieurs mods ne sont pas compatibles entre eux, ou nécessitent un autre mod absent.',
        mods,
        details: lines,
        tips: [
          ...(needsApi ? ['Installe Fabric API depuis l’onglet Mods.'] : []),
          'Mets à jour les mods listés, ou retire celui qui pose problème.',
          'Vérifie que chaque mod est bien fait pour la version de Minecraft de ce build.'
        ]
      };
    }
  },
  {
    test: /Mixin apply failed|MixinApplyError|InvalidMixinException|Mixin transformation of .* failed|MixinTransformerError/,
    build: (text) => {
      const mods = unique(
        [...text.matchAll(/from mod ([\w\-]+)/g), ...text.matchAll(/\b([\w\-]+)\.mixins?\.json/g)].map((m) => m[1])
      ).slice(0, 6);
      return {
        title: 'Un mod n’arrive pas à modifier le jeu',
        explanation:
          'Un mod a essayé de modifier le code de Minecraft et a échoué. C’est presque toujours un mod prévu pour une autre version, ou deux mods qui se gênent.',
        mods,
        tips: ['Retire ou mets à jour les mods cités.', 'Si besoin, retire les mods un par un pour trouver le coupable.']
      };
    }
  },
  {
    test: /NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|ClassNotFoundException|AbstractMethodError/,
    build: (text) => ({
      title: 'Un mod est incompatible avec cette version',
      explanation:
        'Un mod cherche du code qui n’existe pas dans cette version de Minecraft (ou dans un autre mod). Il est probablement trop ancien, trop récent, ou il lui manque une dépendance.',
      mods: suspectedMods(text),
      tips: ['Mets à jour le mod et ses dépendances (Fabric API notamment).', 'Utilise la bonne version du mod pour la version du jeu.']
    })
  },
  {
    test: /GLFW error|Pixel format not accelerated|WGL: |OpenGL|GLX|EGL_/i,
    build: () => ({
      title: 'Problème d’affichage (OpenGL)',
      explanation: 'Le jeu n’a pas réussi à initialiser l’affichage graphique. Le pilote de la carte graphique est souvent en cause.',
      tips: [
        'Mets à jour le pilote de ta carte graphique.',
        'Si tu as deux cartes (Intel et NVIDIA/AMD), lance Java avec la carte la plus puissante.',
        'Désactive les mods de rendu pour tester.'
      ]
    })
  }
];

/**
 * Analyse le texte des logs et retourne une explication lisible.
 * @returns {{title:string, explanation:string, mods:string[], details:string[], tips:string[]}}
 */
function analyzeCrash(text, code) {
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      const res = rule.build(text);
      return { mods: [], details: [], tips: [], ...res, mods: res.mods && res.mods.length ? res.mods : suspectedMods(text) };
    }
  }

  const desc = text.match(/Description: ([^\n]+)/);
  const causes = [...text.matchAll(/Caused by: ([^\n]+)/g)];
  const lastCause = causes.length ? causes[causes.length - 1][1] : '';
  const exception = text.match(/Exception in thread "[^"]+" ([^\n]+)/);

  return {
    title: 'Minecraft s’est arrêté de façon inattendue',
    explanation: desc
      ? `Le jeu a planté : ${desc[1]}.`
      : `Le jeu s’est fermé avec une erreur (code ${code}). Je n’ai pas reconnu la cause exacte.`,
    mods: suspectedMods(text),
    details: [lastCause, exception && exception[1]].filter(Boolean).slice(0, 3),
    tips: [
      'Copie le rapport et regarde les dernières lignes de la console.',
      'Si tu viens d’ajouter un mod ou un pack de textures, retire-le pour tester.'
    ]
  };
}

module.exports = { analyzeCrash, tailFile, newestCrashReport };
