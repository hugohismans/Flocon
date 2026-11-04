/**
 * Cadence de la simulation.
 *
 * La vitesse de croissance du modèle varie énormément avec l'humidité
 * (×10 entre air sec et air saturé). Pour une expérience contemplative
 * régulière, on ne fixe pas un nombre de pas par image mais une vitesse
 * visible : un rayon du cristal qui grandit d'environ N cellules par
 * seconde. Le pacer mesure le taux de croissance récent (cellules / pas) et
 * en déduit combien de pas exécuter, sans dépasser un budget de temps.
 */
export class GrowthPacer {
  /** @param {{cellsPerSecond?: number, budgetMs?: number}} opts */
  constructor({ cellsPerSecond = 4, budgetMs = 9 } = {}) {
    this.cellsPerSecond = cellsPerSecond;
    this.budgetMs = budgetMs;
    this.reset();
  }

  reset() {
    this.carry = 0; // fraction de pas reportée d'une image à l'autre
    this.history = []; // échantillons {step, radius}
    this.rate = 0.04; // estimation initiale (cellules / pas)
    this.stepsPerSecond = this.cellsPerSecond / this.rate;
  }

  /** Mesure le taux de croissance sur une fenêtre glissante (~400 pas). */
  _measure(sim) {
    const h = this.history;
    const last = h[h.length - 1];
    if (!last || sim.step - last.step >= 20) h.push({ step: sim.step, radius: sim.crystalRadius });
    while (h.length > 2 && sim.step - h[0].step > 400) h.shift();
    const first = h[0];
    const dStep = sim.step - first.step;
    if (dStep >= 60) {
      const sample = Math.max(0.004, (sim.crystalRadius - first.radius) / dStep);
      this.rate += (sample - this.rate) * 0.15;
    }
  }

  /**
   * Fait avancer la simulation pour une image.
   * @returns {number} nombre de pas effectués
   */
  tick(sim, dt) {
    if (sim.complete) return 0;
    this._measure(sim);
    // Le germe démarre plus lentement, puis la croissance s'installe.
    this.stepsPerSecond = Math.min(1500, this.cellsPerSecond / this.rate);
    this.carry += this.stepsPerSecond * Math.min(dt, 0.1);
    const want = Math.floor(this.carry);
    this.carry -= want;

    const t0 = performance.now();
    let done = 0;
    while (done < want && !sim.complete) {
      sim.advance(1);
      done++;
      if ((done & 3) === 0 && performance.now() - t0 > this.budgetMs) {
        this.carry = 0; // l'appareil ne suit pas : on ralentit plutôt que saccader
        break;
      }
    }
    return done;
  }
}
