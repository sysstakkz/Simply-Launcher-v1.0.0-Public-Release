# Simply Launcher 1.0

Launcher Minecraft Java : hors ligne (pseudo), licence Microsoft, Fabric, builds isolés, Modrinth.

## Prérequis
1. Node.js 18 ou plus récent.
2. Java installé (21 pour Minecraft 1.20.5+, 17 pour 1.18 à 1.20.4, 8 pour 1.16 et moins).

## Lancer
```bash
npm install
npm start
```
Installateur : `npm run dist` (résultat dans `dist/`).

## Fonctionnalités
- **Builds (instances)** : chaque build a son propre dossier de jeu (mods, mondes, options, logs), ses réglages
  (loader, version, RAM, mode perfs, arguments JVM) et est décrit dans `instances.json`.
  Les bibliothèques et ressources de Minecraft sont partagées entre les builds pour éviter de tout retélécharger.
- **Mods Modrinth** : recherche filtrée par version et loader du build actif, installation en un clic avec
  dépendances obligatoires (Fabric API incluse), vérification SHA-1, activer/désactiver/supprimer.
- **Packs de textures** : activer, désactiver, ordonner (écrit dans `options.txt`), ajout de .zip.
- **Mode perfs** : arguments JVM G1GC optimisés, mémoire minimale = maximale.
- **RAM automatique** : détectée au premier lancement et recommandée ensuite si le build s'en écarte.
- **Console** : sortie du jeu en direct, « Copier l'erreur », « Tout copier », accès au dossier des logs.
- **Assistant de crash** : analyse `latest.log`, le rapport de crash et la sortie du jeu, puis explique en
  français (mémoire, Java, mods en conflit, Mixin, pilotes graphiques…).
- **Mode éco** : met en pause les animations du launcher et baisse sa priorité quand le jeu tourne.
  L'accélération matérielle de l'interface se désactive dans Réglages (redémarrage requis).
- **Profils de mods** (nouveau) : « Performance », « Beauté » et « PvP », cochables ensemble (mode hybride).
  Le launcher fusionne les listes via l'API Modrinth : doublons supprimés, mods déjà installés reconnus
  (empreinte SHA-1), incompatibilités déclarées par Modrinth ou connues retirées, dépendances ajoutées.
  « Analyser » montre le plan avant d'installer. Les listes sont modifiables dans `lib/profiles.js`.
- **Wiki intégré** (nouveau) : crafts principaux, options de performance, astuces PvP, commandes de serveur.
  Les fiches se modifient dans `renderer/wiki.js`.
- **Apparence** : couleur d'accentuation libre (sélecteur, HEX ou RGB), panorama animé en blocs, images ou
  fond vidéo .mp4 (boucle, muet), interface « verre dépoli » (flou désactivable).
- **Sons** : effets désactivables et remplaçables par tes fichiers .ogg / .mp3.

## Fonds d'écran personnalisés
- **Images** : dépose des .png/.jpg/.webp dans le dossier des fonds (Réglages > Apparence > Dossier des fonds).
  Un sous-dossier portant le nom d'une version (ex. `1.20.1`) sert de fond pour les builds de cette version.
- **Vidéo** : choisis « Vidéo (.mp4) » puis « Ajouter une vidéo (.mp4) » (ou dépose le fichier dans le sous-dossier
  `backgrounds/videos`). Elle tourne en boucle, toujours sans son, et se met en pause en mode éco ou quand la
  fenêtre est masquée. Privilégie un fichier léger encodé en H.264. Si la vidéo est illisible, le panorama généré
  reprend automatiquement.

## Sons
Par défaut, de courts sons sont synthétisés. Pour utiliser les tiens : Réglages > Sons de l'interface > « Choisir… »
(.ogg ou .mp3, 5 Mo max), ou dépose `click`, `toggle`, `success` ou `error` (.ogg / .mp3) dans
`renderer/sounds/custom/` (voir le LISEZ-MOI de ce dossier). Les fichiers choisis dans les Réglages sont copiés dans
`.simplylauncher/sounds/custom/` et sont prioritaires.

## Où sont les fichiers ?
Dossier `.simplylauncher` (AppData/Roaming sous Windows) : `config.json`, `instances.json`,
`instances/<id>/` (un dossier de jeu par build), `minecraft/` (fichiers partagés), `backgrounds/`
(`backgrounds/videos/` pour les .mp4), `sounds/custom/`.
Tes anciennes couleurs d'accentuation sont converties automatiquement en couleur libre.
