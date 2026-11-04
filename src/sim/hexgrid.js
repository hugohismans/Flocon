/**
 * Géométrie de la grille hexagonale.
 *
 * Coordonnées axiales (q, r), stockées dans un tableau carré de côté
 * W = 2N + 1 : index = (r + N) * W + (q + N). Seules les cellules du
 * « disque hexagonal » de rayon N (distance hexagonale ≤ N) sont utilisées ;
 * ce domaine est exactement invariant par rotation de 60°, ce qui garantit
 * que la symétrie d'ordre 6 du flocon émerge de la grille elle-même.
 *
 * Aucune dépendance au DOM : ce module peut tourner dans un Web Worker.
 */
export class HexGrid {
  /** @param {number} radius rayon N du domaine, en cellules */
  constructor(radius) {
    this.N = radius;
    this.W = 2 * radius + 1;
    this.count = this.W * this.W;
    this.center = this.index(0, 0);

    const W = this.W;
    // Décalages d'index des 6 voisins axiaux :
    // (+1,0) (-1,0) (0,+1) (0,-1) (-1,+1) (+1,-1)
    this.neighborOffsets = Int32Array.of(1, -1, W, -W, W - 1, -W + 1);

    // Distance hexagonale de chaque cellule au centre (65535 = hors domaine).
    this.dist = new Uint16Array(this.count).fill(0xffff);
    for (let r = -radius; r <= radius; r++) {
      for (let q = -radius; q <= radius; q++) {
        const d = HexGrid.distance(q, r);
        if (d <= radius) this.dist[this.index(q, r)] = d;
      }
    }
  }

  index(q, r) {
    return (r + this.N) * this.W + (q + this.N);
  }

  /** Coordonnées axiales d'un index. */
  coords(i) {
    return { q: (i % this.W) - this.N, r: Math.floor(i / this.W) - this.N };
  }

  /** Distance hexagonale (nombre de pas) entre l'origine et (q, r). */
  static distance(q, r) {
    return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  }

  /**
   * Parcourt les lignes du disque de rayon R. Le callback reçoit l'index de
   * début et de fin (inclus) de chaque ligne : c'est la forme la plus rapide
   * pour les boucles chaudes, qui itèrent ensuite sur un intervalle contigu.
   */
  forEachRow(R, fn) {
    const N = this.N, W = this.W;
    for (let r = -R; r <= R; r++) {
      const qmin = Math.max(-R, -R - r);
      const qmax = Math.min(R, R - r);
      const start = (r + N) * W + (qmin + N);
      fn(start, start + (qmax - qmin), r);
    }
  }

  /**
   * Conversion axiale -> plan (hexagones « pointe en haut », taille 1 =
   * distance centre-sommet). Les voisins sont à √3 l'un de l'autre.
   */
  static toPlane(q, r) {
    return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
  }

  /** Conversion plan -> cellule axiale la plus proche (arrondi cubique). */
  static fromPlane(x, y) {
    const fq = (Math.sqrt(3) / 3) * x - y / 3;
    const fr = (2 / 3) * y;
    const fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return { q, r };
  }
}
