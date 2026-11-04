/**
 * Aléa reproductible : un flocon est entièrement déterminé par sa graine
 * (et les réglages du joueur), ce qui permettra de le rejouer ou de le
 * sauvegarder plus tard.
 */

/** Générateur pseudo-aléatoire rapide (mulberry32), renvoie [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine aléatoire 32 bits. */
export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * Dérive lente et douce dans [-1, 1] : somme de sinusoïdes de fréquences
 * et phases tirées au hasard. Elle modélise le parcours du flocon à travers
 * le nuage : toutes les branches traversent les mêmes conditions au même
 * moment, d'où des flocons uniques mais symétriques.
 */
export class SmoothDrift {
  /**
   * @param {() => number} rand générateur [0, 1)
   * @param {number} period période caractéristique, en pas de simulation
   */
  constructor(rand, period, harmonics = 3) {
    this.waves = [];
    let total = 0;
    for (let k = 0; k < harmonics; k++) {
      const amp = 1 / (k + 1);
      total += amp;
      this.waves.push({
        amp,
        freq: ((0.6 + rand() * 0.8) * (k + 1)) / period,
        phase: rand() * Math.PI * 2,
      });
    }
    for (const w of this.waves) w.amp /= total;
  }

  at(t) {
    let v = 0;
    for (const w of this.waves) v += w.amp * Math.sin(2 * Math.PI * w.freq * t + w.phase);
    return v;
  }
}
