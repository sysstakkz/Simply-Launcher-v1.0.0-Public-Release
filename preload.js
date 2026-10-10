const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['game:status', 'game:progress', 'game:closed', 'game:error', 'game:log', 'game:crash', 'app:eco', 'profiles:progress'];
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // État et réglages
  getState: invoke('state:get'),
  setConfig: invoke('config:set'),
  getVersions: invoke('versions:get'),
  copy: invoke('clipboard:write'),

  // Comptes
  loginMicrosoft: invoke('auth:microsoft'),
  logout: invoke('auth:logout'),

  // Instances (builds)
  createInstance: invoke('instances:create'),
  updateInstance: invoke('instances:update'),
  selectInstance: invoke('instances:select'),
  deleteInstance: invoke('instances:delete'),
  openFolder: invoke('instances:open'), // '', 'mods', 'resourcepacks', 'logs', 'saves'

  // Modrinth et mods installés
  searchMods: invoke('mods:search'),
  installMod: invoke('mods:install'),
  listMods: invoke('mods:list'),
  toggleMod: invoke('mods:toggle'),
  deleteMod: invoke('mods:delete'),

  // Packs de textures
  listPacks: invoke('packs:list'),
  savePacks: invoke('packs:save'),
  addPacks: invoke('packs:add'),

  // Profils de mods
  listProfiles: invoke('profiles:list'),
  previewProfiles: invoke('profiles:preview'),
  installProfiles: invoke('profiles:install'),

  // Fonds d'écran (images et vidéos .mp4)
  listBackgrounds: invoke('bg:list'),
  openBackgrounds: invoke('bg:open'), // '' ou 'videos'
  listVideos: invoke('bg:videos'),
  addVideo: invoke('bg:addVideo'),

  // Sons d'interface personnalisés
  getSounds: invoke('sounds:get'),
  pickSound: invoke('sounds:pick'),
  resetSound: invoke('sounds:reset'),
  openSounds: invoke('sounds:open'),

  // Jeu
  launch: invoke('game:launch'),

  on: (channel, callback) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => callback(data));
  }
});
