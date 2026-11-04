/**
 * Simulation de croissance d'un cristal de glace — modèle de Reiter (2005).
 *
 * Chaque cellule hexagonale porte une quantité d'eau s :
 *   - s ≥ 1 : la cellule est gelée (fait partie du cristal) ;
 *   - une cellule est « réceptive » si elle est gelée ou voisine du cristal ;
 *     c'est la couche limite où la vapeur se dépose.
 *
 * À chaque pas, s est séparé en deux parts :
 *   v = s + γ   sur les cellules réceptives (eau captée, + apport γ) ;
 *   u = s       sur les autres (vapeur libre, qui diffuse).
 * La vapeur diffuse : u' = u + α/12 · (Σ voisins u − 6u), puis s = u' + v.
 * Les cellules réceptives ne cèdent rien (u = 0) mais reçoivent la vapeur de
 * leurs voisines : c'est l'instabilité de Mullins–Sekerka qui fait naître
 * les branches. Le bord du domaine est maintenu à β (humidité ambiante).
 *
 * Paramètres :
 *   β (beta)  humidité ambiante — quantité de vapeur disponible ;
 *   γ (gamma) apport constant de vapeur sur la couche limite — favorise les
 *             plaques pleines (γ élevé) plutôt que les dendrites (γ faible) ;
 *   α (alpha) coefficient de diffusion (stable pour α ≤ 2).
 *
 * Optimisation : on ne calcule qu'un disque « actif » autour du cristal
 * (rayon du cristal + marge) ; au-delà, la vapeur est à l'équilibre β.
 *
 * Ce module ne touche pas au DOM : son état (tableaux typés) peut être
 * transféré tel quel à un Web Worker ou à des textures de shader.
 */
import { HexGrid } from './hexgrid.js';
import { mulberry32, randomSeed, SmoothDrift } from './random.js';

/**
 * Les masses sont stockées en virgule fixe (entiers, ONE = 1.0). Ainsi la
 * somme des 6 voisins est exacte et ne dépend pas de l'ordre d'addition :
 * deux cellules symétriques par rotation reçoivent rigoureusement la même
 * valeur. En flottant, les erreurs d'arrondi (≈1e-7) suffisent à briser la
 * symétrie, car l'instabilité dendritique les amplifie. Ici, seul le bruit
 * volontaire (paramètre `noise`) rend le flocon imparfait.
 */
export const ONE = 1 << 22; // marge confortable : s ≤ 511 dans un Int32

export const DEFAULT_PARAMS = {
  beta: 0.4, // humidité ambiante
  gamma: 0.0012, // apport de vapeur en couche limite
  alpha: 1.0, // diffusion
  noise: 0.00003, // imperfections locales (relatif ; l’instabilité les amplifie fortement)
  driftBeta: 0.06, // amplitude de la dérive lente de β (relative)
  driftGamma: 0.5, // amplitude de la dérive lente de γ (relative)
  driftPeriod: 2600, // période caractéristique de la dérive, en pas
  plateGamma: 0.02, // apport supplémentaire pendant la phase « noyau »
};

export class ReiterSimulation {
  /**
   * @param {object} opts
   * @param {number} [opts.radius=150] rayon de la grille en cellules
   * @param {number} [opts.margin=36] marge du disque actif autour du cristal
   * @param {object} [opts.params] voir DEFAULT_PARAMS
   */
  constructor({ radius = 150, margin = 36, params = {} } = {}) {
    this.grid = new HexGrid(radius);
    this.margin = margin;
    this.params = { ...DEFAULT_PARAMS, ...params };

    const n = this.grid.count;
    this.s = new Int32Array(n); // masse d'eau par cellule (virgule fixe)
    this.s2 = new Int32Array(n); // tampon d'écriture (double buffering)
    this.u = new Int32Array(n); // part diffusante (temporaire)
    this.frozen = new Uint8Array(n); // 1 = gelée
    this.receptive = new Uint8Array(n); // 1 = gelée ou voisine du cristal
    this.freezeStep = new Int32Array(n); // pas auquel la cellule a gelé
    this._newlyFrozen = new Int32Array(n);

    this.reset();
  }

  /** Recommence un flocon depuis un germe unique. */
  reset(seed = randomSeed()) {
    const { beta } = this.params;
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.noiseState = (seed ^ 0x9e3779b9) >>> 0 || 1;
    this.driftB = new SmoothDrift(this.rand, this.params.driftPeriod);
    this.driftG = new SmoothDrift(this.rand, this.params.driftPeriod * 0.7);
    this.plateRadius = 3 + Math.floor(this.rand() * 10);

    this.step_ = 0;
    this.frozenCount = 0;
    this.crystalRadius = 0;
    this.complete = false;
    this.currentBeta = beta;
    this.currentGamma = this.params.gamma;
    this._lastR = 0;

    const b = Math.round(beta * ONE);
    this.s.fill(b);
    this.s2.fill(b);
    this.frozen.fill(0);
    this.receptive.fill(0);
    this.freezeStep.fill(-1);

    // Germe : une seule cellule gelée au centre.
    const c = this.grid.center;
    this.s[c] = this.s2[c] = ONE;
    this._freeze(c);
  }

  get step() {
    return this.step_;
  }

  /** Rayon du disque réellement calculé. */
  get activeRadius() {
    return Math.min(this.grid.N - 1, this.crystalRadius + this.margin);
  }

  /**
   * Change l'humidité ambiante. Pour que le joueur voie l'effet tout de
   * suite, la vapeur libre est mise à l'échelle partout (les zones déjà
   * appauvries autour du cristal le restent proportionnellement).
   */
  setHumidity(beta) {
    const old = this.params.beta;
    this.params.beta = beta;
    if (old <= 0) return;
    const k = beta / old;
    const { s, receptive } = this;
    this.grid.forEachRow(this.activeRadius + 1, (start, end) => {
      for (let i = start; i <= end; i++) if (!receptive[i]) s[i] = Math.round(s[i] * k);
    });
  }

  /** Avance la simulation de `count` pas. Renvoie le nombre de cellules gelées. */
  advance(count = 1) {
    let frozenNow = 0;
    for (let k = 0; k < count && !this.complete; k++) frozenNow += this._step();
    return frozenNow;
  }

  /** Un pas de l'automate de Reiter. */
  _step() {
    const p = this.params;
    const t = this.step_;
    // Conditions du moment : réglage du joueur + dérive lente propre au flocon.
    const betaF = p.beta * (1 + p.driftBeta * this.driftB.at(t));
    const gammaF = Math.max(0, p.gamma * (1 + p.driftGamma * this.driftG.at(t)));
    this.currentBeta = betaF;
    this.currentGamma = gammaF;
    // Phase « noyau » : tant que le cristal est petit, un fort apport en
    // couche limite le fait croître en plaque hexagonale pleine, comme le
    // petit prisme dont naît tout vrai flocon. Les branches partent ensuite
    // de ses six sommets. Le rayon du noyau varie d'un flocon à l'autre.
    let plate = 0;
    if (this.crystalRadius < this.plateRadius) {
      plate = p.plateGamma * (1 - this.crystalRadius / this.plateRadius);
    }
    const beta = Math.round(betaF * ONE);
    const gamma = Math.round((gammaF + plate) * ONE);

    const { N, W } = this.grid;
    const s = this.s, s2 = this.s2, u = this.u;
    const frozen = this.frozen, receptive = this.receptive;
    const R = this.activeRadius;
    if (R > this._lastR) this._expandActive(R, beta);
    const a12 = p.alpha / 12;
    const noiseAmp = p.noise * 2;
    let x = this.noiseState;

    // 1) Part diffusante u sur le disque R+1. L'anneau extérieur (R+1)
    //    sert de condition aux limites : vapeur ambiante β.
    for (let r = -(R + 1); r <= R + 1; r++) {
      const qmin = Math.max(-(R + 1), -(R + 1) - r);
      const qmax = Math.min(R + 1, R + 1 - r);
      const start = (r + N) * W + (qmin + N);
      const end = start + (qmax - qmin);
      if (r === -(R + 1) || r === R + 1) {
        for (let i = start; i <= end; i++) u[i] = beta;
      } else {
        for (let i = start + 1; i < end; i++) u[i] = receptive[i] ? 0 : s[i];
        u[start] = beta;
        u[end] = beta;
      }
    }

    // 2) Diffusion + dépôt sur le disque R.
    let nNew = 0;
    const newly = this._newlyFrozen;
    for (let r = -R; r <= R; r++) {
      const qmin = Math.max(-R, -R - r);
      const qmax = Math.min(R, R - r);
      const start = (r + N) * W + (qmin + N);
      const end = start + (qmax - qmin);
      for (let i = start; i <= end; i++) {
        const ui = u[i];
        const sum = u[i + 1] + u[i - 1] + u[i + W] + u[i - W] + u[i + W - 1] + u[i - W + 1];
        // Produit unique d'un entier exact par une constante : résultat
        // identique pour toutes les cellules équivalentes par symétrie.
        let ns = ui + Math.round(a12 * (sum - 6 * ui));
        if (receptive[i]) {
          ns += s[i] + gamma;
          if (!frozen[i]) {
            // Imperfection locale : légère fluctuation de la vapeur captée.
            // C'est elle qui rend chaque flocon (très légèrement) imparfait.
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            if (noiseAmp) ns = Math.round(ns * (1 + noiseAmp * ((x >>> 0) / 4294967296 - 0.5)));
            if (ns >= ONE) newly[nNew++] = i;
          }
        }
        s2[i] = ns;
      }
    }
    this.noiseState = x;

    // Échange des tampons.
    this.s = s2;
    this.s2 = s;

    // 3) Gel synchrone des nouvelles cellules.
    for (let k = 0; k < nNew; k++) this._freeze(newly[k]);
    this.step_++;

    // Le cristal approche du bord : la croissance s'arrête naturellement.
    if (this.crystalRadius >= this.grid.N - 8) this.complete = true;
    return nNew;
  }

  /**
   * Le disque actif s'agrandit : les cellules qui y entrent prennent la
   * valeur ambiante du moment (elles n'étaient pas simulées jusque-là).
   */
  _expandActive(R, beta) {
    const { dist } = this.grid;
    const last = this._lastR;
    this.grid.forEachRow(R, (start, end) => {
      for (let i = start; i <= end; i++) if (dist[i] > last) this.s[i] = beta;
      // (beta est ici déjà en virgule fixe)
    });
    this._lastR = R;
  }

  _freeze(i) {
    this.frozen[i] = 1;
    this.receptive[i] = 1;
    this.freezeStep[i] = this.step_;
    const off = this.grid.neighborOffsets;
    for (let k = 0; k < 6; k++) this.receptive[i + off[k]] = 1;
    this.frozenCount++;
    const d = this.grid.dist[i];
    if (d > this.crystalRadius) this.crystalRadius = d;
  }
}
