/**
 * Composition de la scène à l'écran (Canvas 2D) :
 *   ciel nocturne -> halo (bloom) -> flocon -> éclats -> neige lointaine.
 *
 * Le halo est obtenu sans filtre CSS (peu fiable sur Safari) : la texture
 * du flocon est réduite deux fois puis réagrandie en mode additif, ce qui
 * revient à un flou gaussien grossier, très bon marché.
 */
import { FlakeTexture } from './flake-texture.js';

export class Scene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../sim/hexgrid.js').HexGrid} grid
   */
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Texture plus légère sur petits écrans / appareils modestes.
    const small = Math.min(screen.width, screen.height) < 500 || (navigator.hardwareConcurrency || 4) <= 4;
    this.texture = new FlakeTexture(grid, small ? 560 : 680);

    const T = this.texture.size;
    this.bloomA = makeCanvas(T / 4);
    this.bloomB = makeCanvas(T / 12);

    this.sky = makeCanvas(1);
    this.sparkles = [];
    this.sparkleSprite = makeSparkleSprite(64);
    this.snow = [];
    this.time = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this._paintSky(w, h);
    this._seedSnow(w, h);
  }

  /**
   * Zone (en pixels écran) où s'affiche le flocon : un carré centré,
   * légèrement remonté pour laisser la place aux contrôles en bas.
   */
  get flakeRect() {
    const { width: w, height: h } = this.canvas;
    const uiSpace = Math.min(h * 0.24, 200 * this.dpr);
    const size = Math.min(w * 0.96, (h - uiSpace) * 0.94);
    return { x: (w - size) / 2, y: (h - uiSpace - size) / 2 + 8 * this.dpr, size };
  }

  /** Remet à zéro les effets liés au flocon précédent. */
  reset() {
    this.sparkles.length = 0;
    this.texture._lastR = -1;
  }

  /**
   * @param {object} sim état de la simulation
   * @param {number} dt secondes écoulées depuis l'image précédente
   * @param {number} glowSteps durée de la lueur en pas de simulation
   */
  render(sim, dt, glowSteps) {
    this.time += dt;
    const { ctx, canvas, texture } = this;
    const { x, y, size } = this.flakeRect;

    texture.update(sim, glowSteps);
    this._spawnSparkles(sim);

    // Ciel.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.sky, 0, 0);
    this._drawSnow(dt, 0.55);

    // Halo : deux niveaux de flou additionnés.
    const T = texture.size;
    const a = this.bloomA.getContext('2d');
    a.clearRect(0, 0, this.bloomA.width, this.bloomA.height);
    a.drawImage(texture.canvas, 0, 0, T, T, 0, 0, this.bloomA.width, this.bloomA.height);
    const b = this.bloomB.getContext('2d');
    b.clearRect(0, 0, this.bloomB.width, this.bloomB.height);
    b.drawImage(this.bloomA, 0, 0, this.bloomB.width, this.bloomB.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';
    const breathe = 0.9 + 0.1 * Math.sin(this.time * 0.6); // respiration très lente
    ctx.globalAlpha = 0.55 * breathe;
    ctx.drawImage(this.bloomB, x - size * 0.04, y - size * 0.04, size * 1.08, size * 1.08);
    ctx.globalAlpha = 0.45 * breathe;
    ctx.drawImage(this.bloomA, x, y, size, size);

    // Le flocon lui-même.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(texture.canvas, x, y, size, size);

    // Éclats.
    this._drawSparkles(dt, x, y, size / T);

    // Quelques flocons lointains passent devant, très flous.
    ctx.globalCompositeOperation = 'source-over';
    this._drawSnow(dt, 1, true);
    ctx.globalAlpha = 1;
  }

  // --- Éclats ---------------------------------------------------------

  _spawnSparkles(sim) {
    const cands = this.texture.sparkleCandidates;
    if (!cands.length || this.sparkles.length > 40) return;
    // Préférence pour les pointes : les cellules gelées les plus lointaines.
    const d = sim.grid.dist;
    for (let k = 0; k < 2; k++) {
      const i = cands[(Math.random() * cands.length) | 0];
      if (d[i] < sim.crystalRadius * 0.7 || Math.random() > 0.35) continue;
      const p = this.texture.cellToTexture(i);
      this.sparkles.push({ x: p.x, y: p.y, age: 0, life: 0.9 + Math.random() * 1.2, size: 0.6 + Math.random() * 0.8, rot: Math.random() * Math.PI });
    }
  }

  _drawSparkles(dt, ox, oy, scale) {
    const { ctx, sparkleSprite: sprite } = this;
    ctx.globalCompositeOperation = 'lighter';
    const base = 26 * this.dpr;
    for (let k = this.sparkles.length - 1; k >= 0; k--) {
      const sp = this.sparkles[k];
      sp.age += dt;
      if (sp.age >= sp.life) {
        this.sparkles.splice(k, 1);
        continue;
      }
      const t = sp.age / sp.life;
      const env = Math.sin(Math.PI * t) ** 2; // apparition et extinction douces
      const sz = base * sp.size * (0.6 + 0.4 * env);
      ctx.globalAlpha = env * 0.9;
      ctx.save();
      ctx.translate(ox + sp.x * scale, oy + sp.y * scale);
      ctx.rotate(sp.rot + t * 0.3);
      ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // --- Ciel et neige lointaine -----------------------------------------

  _paintSky(w, h) {
    this.sky.width = w;
    this.sky.height = h;
    const c = this.sky.getContext('2d');
    const g = c.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, '#0f1d3a');
    g.addColorStop(0.45, '#0a1428');
    g.addColorStop(1, '#03060f');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Étoiles fixes, à peine visibles.
    const n = Math.round((w * h) / 9000);
    for (let k = 0; k < n; k++) {
      const r = Math.random();
      c.globalAlpha = 0.15 + r * r * 0.55;
      c.fillStyle = r > 0.9 ? '#cfe3ff' : '#8fa8d6';
      const s = (r > 0.95 ? 1.6 : 0.9) * this.dpr;
      c.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    c.globalAlpha = 1;
  }

  _seedSnow(w, h) {
    this.snow = [];
    const n = Math.round(Math.min(70, (w * h) / 30000));
    for (let k = 0; k < n; k++) {
      const z = Math.random(); // profondeur : 0 lointain, 1 proche
      this.snow.push({ x: Math.random() * w, y: Math.random() * h, z, phase: Math.random() * 6.28, front: z > 0.93 });
    }
  }

  _drawSnow(dt, alpha, front = false) {
    const { ctx } = this;
    const { width: w, height: h } = this.canvas;
    ctx.fillStyle = '#c8dcff';
    for (const f of this.snow) {
      if (f.front !== front) continue;
      const speed = (6 + f.z * 22) * this.dpr;
      f.y += speed * dt;
      f.x += Math.sin(this.time * 0.4 + f.phase) * 4 * this.dpr * dt;
      if (f.y > h + 10) {
        f.y = -10;
        f.x = Math.random() * w;
      }
      const r = (0.6 + f.z * (front ? 3.5 : 1.4)) * this.dpr;
      ctx.globalAlpha = alpha * (front ? 0.12 : 0.1 + f.z * 0.25);
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(1, Math.round(size));
  return c;
}

/** Éclat : petite étoile à six rayons fins (clin d'œil au cristal) + cœur doux. */
function makeSparkleSprite(size) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const m = size / 2;
  const core = g.createRadialGradient(m, m, 0, m, m, m * 0.35);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(180,220,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  g.translate(m, m);
  for (let k = 0; k < 3; k++) {
    const len = k === 0 ? m : m * 0.6;
    const ray = g.createLinearGradient(-len, 0, len, 0);
    ray.addColorStop(0, 'rgba(190,225,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    ray.addColorStop(1, 'rgba(190,225,255,0)');
    g.fillStyle = ray;
    g.fillRect(-len, -0.9, len * 2, 1.8);
    g.rotate(Math.PI / 3);
  }
  return c;
}
