/**
 * Flocons — point d'entrée.
 *
 * Boucle principale : le pacer fait avancer la simulation, la scène la
 * dessine. La simulation n'a aucune dépendance au DOM ; seule cette
 * boucle relie les deux, ce qui permettra de la déplacer dans un Web Worker
 * (en envoyant s / frozen / freezeStep) ou dans un shader.
 */
import './style.css';
import { ReiterSimulation } from './sim/reiter.js';
import { GrowthPacer } from './sim/pacer.js';
import { Scene } from './render/scene.js';
import { bindControls, humidityToBeta, setStatus } from './ui/controls.js';

const INITIAL_BETA = humidityToBeta(40);

const sim = new ReiterSimulation({ radius: 150, params: { beta: INITIAL_BETA } });
const pacer = new GrowthPacer({ cellsPerSecond: 4 });
const canvas = document.getElementById('scene');
const scene = new Scene(canvas, sim.grid);

/** Numéro lisible du flocon, dérivé de sa graine. */
const flakeName = () => `Flocon n° ${String(sim.seed % 1000000).padStart(6, '0')}`;

function newFlake() {
  sim.reset();
  pacer.reset();
  scene.reset();
  setStatus(flakeName());
}

bindControls({
  initialBeta: INITIAL_BETA,
  onHumidity: (beta) => sim.setHumidity(beta),
  onNew: newFlake,
});

window.addEventListener('resize', () => scene.resize());

let last = performance.now();
let wasComplete = false;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  pacer.tick(sim, dt);
  // La lueur dure ~1,2 s quelle que soit la cadence de la simulation.
  const glowSteps = Math.max(8, pacer.stepsPerSecond * 1.2);
  scene.render(sim, dt, glowSteps);

  if (sim.complete !== wasComplete) {
    wasComplete = sim.complete;
    setStatus(sim.complete ? `${flakeName()} · achevé` : flakeName());
  }
  requestAnimationFrame(frame);
}

newFlake();
requestAnimationFrame(frame);

// Accès de débogage depuis la console.
window.flocons = { sim, pacer, scene };
