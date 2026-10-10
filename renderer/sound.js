/*
 * Sons de l'interface.
 * - Par défaut, de courts « clics » sont synthétisés (aucun fichier à fournir).
 * - Chaque son peut être remplacé par un fichier .ogg ou .mp3 : voir Réglages > Sons de l'interface,
 *   ou dépose click / toggle / success / error (.ogg ou .mp3) dans renderer/sounds/custom/.
 *   Le processus principal indique quels fichiers existent (setFiles).
 */
const Sound = (() => {
  const NAMES = ['click', 'toggle', 'success', 'error'];
  let ctx = null;
  let enabled = true;
  const files = {}; // nom -> { audio, ok }

  function setFiles(map = {}) {
    for (const name of NAMES) {
      const info = map[name];
      if (!info || !info.url) {
        files[name] = null;
        continue;
      }
      const audio = new Audio(info.url);
      audio.preload = 'auto';
      const slot = { audio, ok: false };
      audio.addEventListener('canplaythrough', () => (slot.ok = true), { once: true });
      audio.addEventListener('error', () => (slot.ok = false), { once: true });
      files[name] = slot;
    }
  }

  function audioContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq, to = freq, dur = 0.06, type = 'square', vol = 0.06, delay = 0 }) {
    const c = audioContext();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const synth = {
    click: () => tone({ freq: 540, to: 240, dur: 0.05 }),
    toggle: () => tone({ freq: 380, to: 520, dur: 0.07, type: 'triangle', vol: 0.09 }),
    success: () => {
      tone({ freq: 523, dur: 0.1, type: 'triangle', vol: 0.09 });
      tone({ freq: 784, dur: 0.16, type: 'triangle', vol: 0.09, delay: 0.09 });
    },
    error: () => {
      tone({ freq: 190, to: 120, dur: 0.16, type: 'sawtooth', vol: 0.07 });
      tone({ freq: 150, to: 90, dur: 0.18, type: 'sawtooth', vol: 0.07, delay: 0.1 });
    }
  };

  function play(name, force = false) {
    if (!enabled && !force) return;
    const file = files[name];
    if (file && file.ok) {
      const clone = file.audio.cloneNode();
      clone.volume = 0.6;
      clone.play().catch(() => {});
      return;
    }
    try {
      if (synth[name]) synth[name]();
    } catch {}
  }

  return {
    play,
    preview: (name) => play(name, true), // pour le bouton « Tester » : joue même si les sons sont coupés
    setFiles,
    setEnabled: (value) => { enabled = Boolean(value); },
    isEnabled: () => enabled
  };
})();
