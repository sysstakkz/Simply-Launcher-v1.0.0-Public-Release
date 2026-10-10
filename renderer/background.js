/*
 * Arrière-plan de l'interface.
 *  - « blocks » : panorama animé généré (collines en blocs qui défilent, couleur liée à l'accent)
 *  - « images » : images de l'utilisateur (dossier des fonds), en fondu enchaîné
 *  - « video »  : fond animé .mp4 de l'utilisateur (boucle sans fin, toujours muet)
 *  - « off »    : aucun fond
 */
const Background = (() => {
  const canvas = document.getElementById('bg');
  const ctx = canvas.getContext('2d');
  const imgLayer = document.getElementById('bg-img');
  const video = document.getElementById('bg-video');
  let onVideoError = null;

  const SCALE = 0.5; // rendu en demi-résolution : look pixelisé et moins de GPU
  const BLOCK = 14;
  let mode = 'blocks';
  let paused = false;
  let running = false;
  let lastFrame = 0;
  let time = 0;
  let accent = [242, 193, 78];
  let layers = [];
  let clouds = [];

  let images = [];
  let imageIndex = 0;
  let slots = [];
  let rotateTimer = null;

  function rng(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeLayer(seed, base, color, speed) {
    const rand = rng(seed);
    const n = 120;
    const heights = [];
    let h = 0;
    for (let i = 0; i < n; i++) {
      h += Math.round((rand() - 0.5) * 3);
      h = Math.max(-4, Math.min(4, h));
      heights.push(h);
    }
    // Raccord invisible entre la fin et le début.
    for (let i = 0; i < 10; i++) heights[n - 10 + i] = Math.round(heights[n - 10 + i] * (1 - (i + 1) / 10) + heights[0] * ((i + 1) / 10));
    return { heights, base, color, speed };
  }

  function buildScene() {
    layers = [
      makeLayer(11, 0.58, 'rgba(36, 74, 86, 0.55)', 5),
      makeLayer(23, 0.70, 'rgba(24, 54, 65, 0.8)', 11),
      makeLayer(37, 0.83, 'rgba(12, 28, 34, 0.95)', 22)
    ];
    const rand = rng(5);
    clouds = Array.from({ length: 7 }, () => ({ x: rand(), y: 0.08 + rand() * 0.28, w: 4 + Math.floor(rand() * 6), speed: 2 + rand() * 3 }));
  }

  function refreshTheme() {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (m) accent = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function resize() {
    canvas.width = Math.ceil(window.innerWidth * SCALE);
    canvas.height = Math.ceil(window.innerHeight * SCALE);
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a1a20');
    sky.addColorStop(0.7, '#10262e');
    sky.addColorStop(1, `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.22)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (const c of clouds) {
      const x = (((c.x * w + time * c.speed) % (w + 200)) + w + 200) % (w + 200) - 100;
      ctx.fillRect(Math.round(x / BLOCK) * BLOCK, Math.round((c.y * h) / BLOCK) * BLOCK, c.w * BLOCK, BLOCK);
    }

    for (const layer of layers) {
      const n = layer.heights.length;
      const offset = time * layer.speed;
      const start = Math.floor(offset / BLOCK);
      const shift = offset % BLOCK;
      const baseY = Math.round((h * layer.base) / BLOCK) * BLOCK;
      ctx.fillStyle = layer.color;
      for (let x = -1, col = 0; x * BLOCK < w + BLOCK; x++, col++) {
        const index = (((start + col) % n) + n) % n;
        const top = baseY + layer.heights[index] * BLOCK;
        ctx.fillRect(x * BLOCK - shift, top, BLOCK, h - top);
      }
    }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - lastFrame < 42) return; // ~24 images/s
    time += (now - lastFrame) / 1000;
    lastFrame = now;
    draw();
  }

  function startLoop() {
    if (running || paused || mode !== 'blocks') return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; }

  // --- Images ---
  function ensureSlots() {
    if (slots.length) return;
    slots = [document.createElement('div'), document.createElement('div')];
    slots.forEach((s) => imgLayer.appendChild(s));
  }
  function showImage() {
    if (!images.length) return;
    ensureSlots();
    const next = slots[imageIndex % 2];
    const prev = slots[(imageIndex + 1) % 2];
    next.style.backgroundImage = `url("${images[imageIndex % images.length]}")`;
    next.classList.add('show');
    prev.classList.remove('show');
    imageIndex++;
  }
  function stopImages() {
    clearInterval(rotateTimer);
    rotateTimer = null;
    slots.forEach((s) => s.classList.remove('show'));
  }

  // --- Vidéo ---
  function startVideo(url) {
    video.muted = true; // toujours muet
    video.defaultMuted = true;
    video.loop = true; // boucle sans fin
    video.playsInline = true;
    video.src = url;
    video.style.display = 'block';
    if (!paused) video.play().catch(() => {});
  }
  function stopVideo() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.style.display = 'none';
  }

  /**
   * @param {'blocks'|'images'|'video'|'off'} newMode
   * @param {string[]} imageUrls images disponibles pour le mode « images »
   * @param {string} videoUrl vidéo à lire pour le mode « video »
   * @returns {number} nombre d'éléments utilisés (0 : repli sur le panorama généré ou aucun fond)
   */
  function setMode(newMode, imageUrls = [], videoUrl = '') {
    mode = newMode;
    stopLoop();
    stopImages();
    stopVideo();
    canvas.style.display = 'none';
    imgLayer.style.display = 'none';

    if (mode === 'images' && imageUrls.length) {
      images = imageUrls;
      imageIndex = 0;
      imgLayer.style.display = 'block';
      showImage();
      rotateTimer = setInterval(showImage, 15000);
      return images.length;
    }
    if (mode === 'video' && videoUrl) {
      startVideo(videoUrl);
      return 1;
    }
    if (mode === 'off') return 0;

    // « blocks », ou « images » / « video » sans contenu : on retombe sur le panorama généré.
    const requested = mode;
    mode = 'blocks';
    canvas.style.display = 'block';
    draw();
    startLoop();
    return requested === 'blocks' ? 1 : 0;
  }

  function setPaused(value) {
    paused = Boolean(value);
    if (paused) stopLoop();
    else if (mode === 'blocks') startLoop();
    if (mode === 'video') {
      if (paused) video.pause();
      else video.play().catch(() => {});
    }
    if (paused) clearInterval(rotateTimer);
    else if (mode === 'images' && images.length) {
      clearInterval(rotateTimer);
      rotateTimer = setInterval(showImage, 15000);
    }
  }

  function init() {
    buildScene();
    refreshTheme();
    resize();
    window.addEventListener('resize', () => { resize(); if (mode === 'blocks') draw(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopLoop();
        if (mode === 'video') video.pause();
      } else if (!paused) {
        if (mode === 'blocks') startLoop();
        if (mode === 'video') video.play().catch(() => {});
      }
    });
    // Vidéo illisible (codec non pris en charge, fichier abîmé) : retour au panorama généré.
    video.addEventListener('error', () => {
      if (mode !== 'video' || !video.getAttribute('src')) return;
      setMode('blocks');
      if (onVideoError) onVideoError();
    });
  }

  init();
  return {
    setMode,
    setPaused,
    refreshTheme,
    redraw: () => mode === 'blocks' && draw(),
    onVideoError: (fn) => { onVideoError = fn; }
  };
})();
