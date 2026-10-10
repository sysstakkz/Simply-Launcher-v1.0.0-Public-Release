/*
 * Wiki intégré : fiches d'aide consultables hors ligne.
 * Pour ajouter une fiche, ajoute un objet { id, title, blocks } dans une catégorie de CATEGORIES.
 * Types de blocs : p (paragraphe), h (sous-titre), ul (liste), table (head + rows), tip (astuce), code.
 * Le texte est toujours inséré avec textContent : aucun HTML n'est interprété.
 */
const Wiki = (() => {
  const CATEGORIES = [
    {
      name: 'Crafts principaux',
      articles: [
        {
          id: 'crafts-bases',
          title: 'Les bases',
          blocks: [
            { t: 'p', x: 'Les premiers objets à fabriquer dans un monde Survie. Les planches se fabriquent à partir de n’importe quelle bûche.' },
            {
              t: 'table',
              head: ['Objet', 'Recette'],
              rows: [
                ['Planches (×4)', '1 bûche'],
                ['Établi', '4 planches en carré 2×2'],
                ['Bâtons (×4)', '2 planches l’une au-dessus de l’autre'],
                ['Torches (×4)', '1 charbon ou charbon de bois au-dessus de 1 bâton'],
                ['Coffre', '8 planches en anneau (le centre reste vide)'],
                ['Four', '8 blocs de pierre taillée (cobblestone) en anneau'],
                ['Lit', '3 laines de même couleur au-dessus de 3 planches']
              ]
            },
            { t: 'tip', x: 'Un bloc d’établi (3×3) est nécessaire pour presque tout, à part les planches, les bâtons et l’établi lui-même.' }
          ]
        },
        {
          id: 'crafts-outils',
          title: 'Outils et armes',
          blocks: [
            { t: 'p', x: 'Le « matériau » peut être des planches, de la pierre taillée, du fer, de l’or ou des diamants. Les bâtons restent les mêmes.' },
            {
              t: 'table',
              head: ['Objet', 'Recette'],
              rows: [
                ['Pioche', '3 matériaux sur la rangée du haut + 2 bâtons au centre (milieu et bas)'],
                ['Hache', '3 matériaux en L (haut-gauche, haut-centre, milieu-gauche) + 2 bâtons au centre (milieu et bas). Le motif peut être inversé.'],
                ['Pelle', '1 matériau au-dessus de 2 bâtons'],
                ['Houe', '2 matériaux en haut (gauche et centre) + 2 bâtons au centre (milieu et bas)'],
                ['Épée', '2 matériaux l’un au-dessus de l’autre + 1 bâton en dessous']
              ]
            },
            { t: 'tip', x: 'Netherite (1.20 et plus) : on améliore un équipement en diamant à la table de forge, avec un modèle d’amélioration en netherite et un lingot de netherite.' }
          ]
        },
        {
          id: 'crafts-armures',
          title: 'Armures',
          blocks: [
            { t: 'p', x: 'Chaque pièce demande un nombre fixe de matériaux (cuir, fer, or, diamant) :' },
            {
              t: 'table',
              head: ['Pièce', 'Matériaux'],
              rows: [
                ['Casque', '5'],
                ['Plastron', '8'],
                ['Jambières', '7'],
                ['Bottes', '4']
              ]
            },
            { t: 'p', x: 'Il faut donc 24 matériaux pour une armure complète.' }
          ]
        },
        {
          id: 'crafts-utiles',
          title: 'Objets utiles',
          blocks: [
            {
              t: 'table',
              head: ['Objet', 'Recette'],
              rows: [
                ['Seau', '3 lingots de fer en V'],
                ['Bouclier', '6 planches + 1 lingot de fer'],
                ['Arc', '3 bâtons + 3 fils'],
                ['Flèches (×4)', '1 silex, 1 bâton, 1 plume (en colonne)'],
                ['Pomme d’or', '8 lingots d’or autour d’une pomme'],
                ['Boussole', '4 lingots de fer + 1 redstone au centre'],
                ['Table d’enchantement', '1 livre, 2 diamants, 4 obsidienne'],
                ['Enclume', '3 blocs de fer en haut, 1 lingot de fer au centre, 3 lingots de fer en bas']
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Performance',
      articles: [
        {
          id: 'perf-video',
          title: 'Options vidéo qui comptent',
          blocks: [
            { t: 'p', x: 'Dans Minecraft : Options > Paramètres vidéo. Du plus efficace au moins efficace :' },
            {
              t: 'table',
              head: ['Option', 'Conseil'],
              rows: [
                ['Distance d’affichage', 'Le réglage qui pèse le plus. 8 à 12 chunks suffisent sur une machine modeste.'],
                ['Distance de simulation (1.18+)', 'Contrôle jusqu’où les mobs et les cultures sont actifs. 5 à 8 si le jeu rame.'],
                ['FPS max', 'Limite-les à la fréquence de ton écran pour éviter de chauffer pour rien.'],
                ['Graphismes', '« Rapide » allège les feuilles et les transparences.'],
                ['Nuages', 'Rapides ou désactivés.'],
                ['Particules', 'Minimales.'],
                ['Ombres des entités', 'Désactivées.'],
                ['Mélange des biomes', '1 à 3 : une valeur élevée coûte cher pour peu de gain visible.'],
                ['Mipmap', 'Entre 0 et 2.']
              ]
            },
            { t: 'tip', x: 'Le profil « Performance » de l’onglet Profils installe en un clic les mods d’optimisation les plus utiles (Fabric uniquement).' }
          ]
        },
        {
          id: 'perf-launcher',
          title: 'Mémoire, Java et mode perfs',
          blocks: [
            { t: 'h', x: 'Mémoire (RAM)' },
            {
              t: 'ul',
              items: [
                '4 à 6 Go suffisent pour Minecraft vanilla ou avec quelques mods d’optimisation.',
                'Donner plus de RAM n’augmente pas les FPS et peut provoquer de longues micro-pauses.',
                'Laisse toujours 2 à 3 Go libres pour le système : le launcher te recommande une valeur adaptée à ta machine.'
              ]
            },
            { t: 'h', x: 'Version de Java' },
            {
              t: 'ul',
              items: ['Minecraft 1.20.5 et plus : Java 21', 'Minecraft 1.18 à 1.20.4 : Java 17', 'Minecraft 1.16 et moins : Java 8']
            },
            { t: 'h', x: 'Mode perfs' },
            { t: 'p', x: 'Le mode perfs du launcher active des arguments JVM (ramasse-miettes G1GC) réglés pour limiter les à-coups, et fixe la mémoire minimale égale à la mémoire maximale.' },
            { t: 'h', x: 'Mode éco du launcher' },
            { t: 'p', x: 'Pendant que le jeu tourne, le launcher met ses animations en pause, coupe le flou et baisse sa priorité pour laisser toute la puissance à Minecraft.' }
          ]
        }
      ]
    },
    {
      name: 'Astuces PvP',
      articles: [
        {
          id: 'pvp-bases',
          title: 'Combat en 1.9 et plus',
          blocks: [
            {
              t: 'ul',
              items: [
                'Cooldown d’attaque : attends que la jauge soit pleine avant de frapper. Cliquer comme un fou affaiblit tes coups.',
                'Coup critique : frappe en tombant (après un saut), sans sprinter. Il inflige environ 50 % de dégâts en plus.',
                'Sprint reset (W-tap) : relâche puis réappuie sur « avancer » juste avant de frapper pour repousser davantage l’adversaire.',
                'Portée : en Survie, on touche à 3 blocs. Garde ta distance et bouge latéralement (strafe).',
                'Bouclier : il bloque les coups de face ; une hache le désactive pendant environ 5 secondes.',
                'Pommes d’or : régénération et absorption. Mange-les pendant que tu recules, pas en plein échange.',
                'Perles d’Ender : très utiles pour fuir ou fondre sur un adversaire. Garde-en toujours une dans la barre d’inventaire.'
              ]
            },
            { t: 'tip', x: 'Réglages conseillés : FPS élevés, VSync désactivée, distance d’affichage modérée. Le profil « PvP » installe des mods qui stabilisent les FPS et allègent le réseau.' }
          ]
        },
        {
          id: 'pvp-barre',
          title: 'Organiser sa barre d’inventaire',
          blocks: [
            { t: 'p', x: 'Garde les mêmes emplacements d’une partie à l’autre pour que tes gestes deviennent automatiques :' },
            {
              t: 'ul',
              items: [
                'Épée sur la case 1, bouclier ou hache dans la main secondaire / case voisine.',
                'Nourriture de soin (pommes d’or) à portée de pouce.',
                'Perles d’Ender et blocs de construction sur les dernières cases.'
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Commandes de serveur',
      articles: [
        {
          id: 'cmd-vanilla',
          title: 'Commandes de base (vanilla)',
          blocks: [
            { t: 'p', x: 'Ces commandes se tapent dans le chat, précédées de « / ». La plupart demandent d’être opérateur (OP) ou de jouer avec les triches activées.' },
            {
              t: 'table',
              head: ['Commande', 'Effet'],
              rows: [
                ['/gamemode survival | creative | adventure | spectator', 'Change le mode de jeu'],
                ['/tp <joueur> <x y z>', 'Se téléporte à des coordonnées ou vers un joueur'],
                ['/time set day | night', 'Change l’heure'],
                ['/weather clear | rain | thunder', 'Change la météo'],
                ['/give <joueur> <objet> [quantité]', 'Donne un objet'],
                ['/effect give <joueur> <effet> [secondes]', 'Applique un effet de potion'],
                ['/gamerule keepInventory true', 'Garde l’inventaire à la mort'],
                ['/difficulty peaceful | easy | normal | hard', 'Change la difficulté'],
                ['/locate structure <nom>', 'Indique la structure la plus proche (1.19 et plus)'],
                ['/seed', 'Affiche la graine du monde'],
                ['/setworldspawn', 'Définit le point d’apparition du monde'],
                ['/msg <joueur> <message>', 'Message privé (aussi /tell et /w)'],
                ['/list', 'Liste les joueurs connectés']
              ]
            }
          ]
        },
        {
          id: 'cmd-serveur',
          title: 'Commandes de serveur courantes',
          blocks: [
            { t: 'p', x: 'Ces commandes viennent le plus souvent de plugins (par exemple EssentialsX). Elles dépendent donc du serveur : consulte son aide si elles ne répondent pas.' },
            {
              t: 'table',
              head: ['Commande', 'Effet'],
              rows: [
                ['/spawn', 'Retourne au point d’apparition du serveur'],
                ['/sethome  et  /home', 'Enregistre puis rejoint ta maison'],
                ['/tpa <joueur>', 'Demande à se téléporter vers un joueur'],
                ['/warp <nom>', 'Se rend à un point public du serveur']
              ]
            },
            { t: 'tip', x: 'Les commandes d’administration (/op, /ban, /kick, /whitelist) sont réservées aux opérateurs du serveur.' }
          ]
        }
      ]
    },
    {
      name: 'Simply Launcher',
      articles: [
        {
          id: 'sl-perso',
          title: 'Personnaliser le launcher',
          blocks: [
            {
              t: 'ul',
              items: [
                'Profils : coche un ou plusieurs profils (mode hybride), analyse, puis installe. Les doublons et incompatibilités sont retirés automatiquement.',
                'Couleur : Réglages > Apparence, choisis n’importe quelle couleur (sélecteur, HEX ou RGB).',
                'Fond vidéo : Réglages > Apparence > Vidéo (.mp4). La vidéo tourne en boucle, sans son.',
                'Sons : Réglages > Sons de l’interface, remplace chaque son par un fichier .ogg ou .mp3.',
                'Flou : désactive l’effet de verre dépoli dans Réglages si ton ordinateur est juste.'
              ]
            }
          ]
        }
      ]
    }
  ];

  const ALL = CATEGORIES.flatMap((c) => c.articles.map((a) => ({ ...a, category: c.name })));
  const searchable = (a) =>
    [a.title, a.category, ...a.blocks.flatMap((b) => [b.x || '', ...(b.items || []), ...(b.head || []), ...(b.rows || []).flat()])]
      .join(' ')
      .toLowerCase();
  const INDEX = new Map(ALL.map((a) => [a.id, searchable(a)]));

  function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderBlock(block) {
    switch (block.t) {
      case 'h':
        return h('h4', 'wiki-h', block.x);
      case 'ul': {
        const ul = h('ul', 'plain');
        for (const item of block.items) ul.appendChild(h('li', null, item));
        return ul;
      }
      case 'table': {
        const wrap = h('div', 'wiki-table');
        const table = h('table');
        const head = h('tr');
        for (const c of block.head) head.appendChild(h('th', null, c));
        table.appendChild(head);
        for (const row of block.rows) {
          const tr = h('tr');
          row.forEach((cell, i) => tr.appendChild(h('td', i === 0 ? 'wiki-key' : null, cell)));
          table.appendChild(tr);
        }
        wrap.appendChild(table);
        return wrap;
      }
      case 'tip':
        return h('p', 'wiki-tip', block.x);
      case 'code':
        return h('pre', 'wiki-code', block.x);
      default:
        return h('p', null, block.x);
    }
  }

  function mount({ nav, body, search }) {
    let currentId = ALL[0].id;
    let query = '';

    function renderBody() {
      const article = ALL.find((a) => a.id === currentId);
      body.replaceChildren();
      if (!article) {
        body.appendChild(h('p', 'hint', 'Aucune fiche ne correspond à ta recherche.'));
        return;
      }
      body.appendChild(h('p', 'wiki-cat', article.category));
      body.appendChild(h('h3', 'wiki-title', article.title));
      for (const block of article.blocks) body.appendChild(renderBlock(block));
      body.scrollTop = 0;
    }

    function renderNav() {
      nav.replaceChildren();
      const matches = new Set(ALL.filter((a) => !query || INDEX.get(a.id).includes(query)).map((a) => a.id));
      if (matches.size && !matches.has(currentId)) currentId = [...matches][0];
      if (!matches.size) currentId = null;
      for (const cat of CATEGORIES) {
        const shown = cat.articles.filter((a) => matches.has(a.id));
        if (!shown.length) continue;
        nav.appendChild(h('p', 'wiki-group', cat.name));
        for (const a of shown) {
          const b = h('button', a.id === currentId ? 'on' : '', a.title);
          b.type = 'button';
          b.addEventListener('click', () => {
            currentId = a.id;
            renderNav();
            renderBody();
          });
          nav.appendChild(b);
        }
      }
      renderBody();
    }

    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      renderNav();
    });
    renderNav();
  }

  return { mount };
})();
