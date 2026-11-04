/**
 * Rastérisation de la grille hexagonale dans une texture (canvas hors écran).
 *
 * Une table pixel -> cellule est précalculée une fois ; à chaque image on
 * calcule une couleur par cellule du disque actif, puis on recopie ces
 * couleurs dans les pixels. Ce découpage (état -> couleurs -> pixels) est
 * celui qu'on retrouverait dans un fragment shader si l'on passe à WebGL.
 *
 * Ne lit que l'état public de la simulation (s, frozen, receptive,
 * freezeStep, step, activeRadius) : la simulation pourrait vivre ailleurs.
 */
import { HexGrid } from '../sim/hexgrid.js';
import { ONE } from '../sim/reiter.js';

/** Couleur RGBA -> entier 32 bits little-endian (ordre ImageData). */
const rgba = (r, g, b, a) => ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Palette glacée.
const ICE_EDGE = [214, 240, 255]; // bord fraîchement gelé
const ICE_CORE = [118, 172, 236]; // glace ancienne, plus profonde
const VAPOR = [70, 110, 190]; // brume de vapeur
const VAPOR_ALPHA = 20;

export class FlakeTexture {
  /**
   * @param {HexGrid} grid
   * @param {number} size côté de la texture en pixels
   */
  constructor(grid, size) {
    this.grid = grid;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(size, size);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.cellColor = new Uint32Array(grid.count);
    /** Cellules venant de geler pendant le dernier rendu (pour les éclats). */
    this.sparkleCandidates = [];

    this._buildPixelMap();
    this._buildVignette();
  }

  /**
   * Table pixel -> index de cellule (-1 hors domaine). Le plan est tourné
   * de 90° pour qu'une branche pointe vers le haut, comme sur les photos.
   */
  _buildPixelMap() {
    const { size, grid } = this;
    const N = grid.N;
    // Unités du plan par pixel : le domaine (sommets à √3·N) tient dans la texture.
    this.unitsPerPixel = (Math.sqrt(3) * N + 1) / (size / 2);
    const k = this.unitsPerPixel;
    this.map = new Int32Array(size * size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (py + 0.5 - size / 2) * k; // rotation de 90°
        const y = -(px + 0.5 - size / 2) * k;
        const { q, r } = HexGrid.fromPlane(x, y);
        const inside = HexGrid.distance(q, r) <= N;
        this.map[py * size + px] = inside ? grid.index(q, r) : -1;
      }
    }
  }

  /** Position (en pixels de texture) du centre d'une cellule. */
  cellToTexture(i) {
    const { q, r } = this.grid.coords(i);
    const { x, y } = HexGrid.toPlane(q, r);
    const k = this.unitsPerPixel;
    return { x: -y / k + this.size / 2, y: x / k + this.size / 2 };
  }

  /** Atténuation radiale de la brume, pour ne jamais voir le bord hexagonal. */
  _buildVignette() {
    const { grid } = this;
    const N = grid.N;
    this.vignette = new Float32Array(grid.count);
    for (let i = 0; i < grid.count; i++) {
      if (grid.dist[i] > N) continue;
      const { q, r } = grid.coords(i);
      const { x, y } = HexGrid.toPlane(q, r);
      const d = Math.hypot(x, y) / (1.5 * N); // 1 ≈ bord intérieur du domaine
      const t = clamp01((1 - d) / 0.85);
      this.vignette[i] = t * t * (3 - 2 * t);
    }
  }

  /**
   * Met à jour la texture depuis l'état de la simulation.
   * @param {object} sim état de la simulation (lecture seule)
   * @param {number} glowSteps durée de la lueur des cellules fraîches, en pas
   */
  update(sim, glowSteps) {
    const { s, frozen, receptive, freezeStep } = sim;
    const now = sim.step;
    const color = this.cellColor;
    const vig = this.vignette;
    const invOne = 1 / ONE;
    const beta = Math.max(0.05, sim.params.beta);
    const invGlow = 1 / Math.max(1, glowSteps);
    const W = this.grid.W;
    const sparkles = this.sparkleCandidates;
    sparkles.length = 0;

    // Toute la grille est couverte par les pixels ; hors du disque actif la
    // vapeur est uniforme, on calcule donc un rayon un peu plus large.
    const R = Math.min(this.grid.N, sim.activeRadius + 2);
    if (R !== this._lastR) {
      // La couleur hors disque actif ne change pas : on la calcule une fois.
      this._fillAmbient();
      this._lastR = R;
    }

    this.grid.forEachRow(R, (start, end) => {
      for (let i = start; i <= end; i++) {
        const m = s[i] * invOne;
        if (frozen[i]) {
          const age = now - freezeStep[i];
          // Bord du cristal : cellule gelée touchant au moins une cellule
          // libre. Il accroche la lumière (liseré brillant).
          const nf = frozen[i + 1] + frozen[i - 1] + frozen[i + W] + frozen[i - W] + frozen[i + W - 1] + frozen[i - W + 1];
          const rim = (6 - nf) / 6;
          // Épaisseur : la glace ancienne (nervures centrales des branches,
          // cœur du flocon) est plus épaisse, donc plus lumineuse.
          const thick = 1 - Math.exp(-age / 1400);
          // Lueur des cellules récemment gelées, qui s'apaise ensuite.
          const glow = Math.exp(-age * invGlow);
          // Glace fine = bleu profond translucide ; épaisse ou en bord = clair.
          const light = clamp01(0.18 + 0.5 * thick * thick + 1.6 * rim);
          let r = lerp(ICE_CORE[0], ICE_EDGE[0], light);
          let g = lerp(ICE_CORE[1], ICE_EDGE[1], light);
          let b = lerp(ICE_CORE[2], ICE_EDGE[2], light);
          r += (255 - r) * glow;
          g += (255 - g) * glow;
          b += (255 - b) * glow;
          const a = 105 + 70 * thick + 120 * rim + 60 * glow;
          color[i] = rgba(r, g, b, a > 255 ? 255 : a);
          if (age === 0) sparkles.push(i);
        } else if (receptive[i]) {
          // Couche limite : la masse captée sert de couverture partielle,
          // ce qui adoucit le front de croissance (anticrénelage naturel).
          const c = clamp01(m);
          color[i] = rgba(ICE_EDGE[0], ICE_EDGE[1], ICE_EDGE[2], 150 * c * c);
        } else {
          // Vapeur libre : brume très discrète, plus sombre là où le
          // cristal l'a consommée (on « voit » la zone appauvrie).
          const v = clamp01(m / (beta * 1.15));
          color[i] = rgba(VAPOR[0], VAPOR[1], VAPOR[2], VAPOR_ALPHA * v * v * vig[i]);
        }
      }
    });

    // Recopie couleurs -> pixels.
    const map = this.map, px = this.pixels;
    for (let p = 0, n = px.length; p < n; p++) {
      const i = map[p];
      px[p] = i < 0 ? 0 : color[i];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  _fillAmbient() {
    const { grid, vignette } = this;
    const a = VAPOR_ALPHA / 1.15 ** 2;
    for (let i = 0; i < grid.count; i++) {
      this.cellColor[i] = grid.dist[i] <= grid.N ? rgba(VAPOR[0], VAPOR[1], VAPOR[2], a * vignette[i]) : 0;
    }
  }
}
