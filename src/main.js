/**
 * Flocons — point d'entrée.
 *
 * Boucle principale : le pacer fait avancer la simulation, la scène la
 * dessine, le son réagit aux embranchements. La simulation n'a aucune
 * dépendance au DOM ; seule cette boucle relie les modules, ce qui
 * permettra de la déplacer dans un Web Worker (en envoyant s / frozen /
 * freezeStep, et en recevant réglages et injections comme messages).
 */
import './style.css';
import { ReiterSimulation } from './sim/reiter.js';
import { GrowthPacer } from './sim/pacer.js';
import { humidityToBeta, temperatureToParams } from './sim/climate.js';
import { Scene } from './render/scene.js';
import { Chimes } from './audio/chimes.js';
import { bindControls, hideHint, setFrozenUI, setStatus } from './ui/controls.js';

// --- Réglages initiaux --------------------------------------------------
const settings = { humidity: 40, temperature: -15, cellsPerSecond: 4 };

const INJECT_RADIUS = 7; // rayon de la bouffée de vapeur, en cellules
const INJECT_RATE = 1.1; // masse injectée par seconde au centre de la bouffée
const FREEZE_WAVE_S = 1.8; // durée de l'onde de gel
const FREEZE_FADE_S = 1.4; // durée de la disparition de la brume

const sim = new ReiterSimulation({
  radius: 150,
  params: { beta: humidityToBeta(settings.humidity), ...temperatureToParams(settings.temperature) },
});
const pacer = new GrowthPacer({ cellsPerSecond: settings.cellsPerSecond });
const canvas = document.getElementById('scene');
const scene = new Scene(canvas, sim.grid);
const chimes = new Chimes();

// --- État de la boucle ------------------------------------------------
let time = 0;
let frozenAt = -1; // instant (s) où le flocon a été figé
let visualExtra = 0; // pas « visuels » écoulés depuis le gel (lueurs)
const pointer = { active: false, x: 0, y: 0 };

/** Numéro lisible du flocon, dérivé de sa graine. */
const flakeName = () => `Flocon n° ${String(sim.seed % 1000000).padStart(6, '0')}`;

function newFlake() {
  sim.reset();
  pacer.reset();
  scene.reset();
  frozenAt = -1;
  visualExtra = 0;
  setFrozenUI(false);
  setStatus(flakeName());
}

bindControls({
  ...settings,
  muted: chimes.muted,
  onHumidity: (pct) => sim.setHumidity(humidityToBeta(pct)),
  onTemperature: (t) => sim.setClimate(temperatureToParams(t)),
  onSpeed: (cps) => (pacer.cellsPerSecond = cps),
  onFreeze: () => sim.freeze(),
  onNew: newFlake,
  onToggleSound: () => {
    chimes.unlock();
    chimes.setMuted(!chimes.muted);
    return chimes.muted;
  },
});

// --- Toucher : injection de vapeur -----------------------------------
// L'audio ne peut démarrer qu'après un geste : n'importe quel premier toucher.
window.addEventListener('pointerdown', () => chimes.unlock(), { capture: true });

canvas.addEventListener('pointerdown', (e) => {
  pointer.active = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
const release = () => {
  pointer.active = false;
  scene.setTouch(null);
  chimes.breath(false);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

function applyInjection(dt) {
  if (!pointer.active || sim.complete) {
    if (pointer.active) release();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const cx = pointer.x - rect.left, cy = pointer.y - rect.top;
  scene.setTouch(cx, cy);
  const cell = scene.screenToCell(cx, cy);
  if (cell && sim.injectVapor(cell.q, cell.r, INJECT_RADIUS, INJECT_RATE * dt)) {
    chimes.breath(true, cell.pan);
    hideHint();
  } else {
    chimes.breath(false);
  }
}

// --- Mise en page : le flocon occupe l'espace laissé par l'interface -----
const panel = document.getElementById('panel');
const title = document.querySelector('.title');
function layout() {
  const top = title.getBoundingClientRect().bottom + 8;
  const panelTop = panel.getBoundingClientRect().top;
  document.documentElement.style.setProperty('--panel-h', `${panel.offsetHeight}px`);
  const bottom = window.innerHeight - panelTop + 30; // + place pour l'indication
  scene.setReserved(top, bottom);
  scene.resize();
}
new ResizeObserver(layout).observe(panel);
window.addEventListener('resize', layout);

// --- Boucle ----------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  applyInjection(dt);
  pacer.tick(sim, dt);
  chimes.update(dt);

  // Embranchements -> notes (une par image au plus, le son se limite seul).
  const events = sim.drainEvents();
  if (events.length) {
    const e = events[events.length - 1];
    chimes.branch(scene.panOfCell(e.cell), sim.grid.dist[e.cell] / (sim.grid.N - 8));
  }

  // Passage à l'état figé (bouton Geler ou bord atteint).
  if (sim.complete && frozenAt < 0) {
    frozenAt = time;
    chimes.freezeChord();
    setFrozenUI(true);
    setStatus(`${flakeName()} · figé`);
    release();
  }

  // Effets : la lueur continue de s'apaiser après le gel, l'onde parcourt
  // le cristal et la brume se dissipe.
  const sps = Math.max(30, pacer.stepsPerSecond);
  if (sim.complete) visualExtra += sps * dt;
  const since = frozenAt < 0 ? -1 : time - frozenAt;
  scene.render(sim, dt, {
    clock: sim.step + visualExtra,
    glowSteps: Math.max(8, sps * 1.2), // ~1,2 s quelle que soit la cadence
    fade: since < 0 ? 0 : Math.min(1, since / FREEZE_FADE_S),
    wave: since < 0 || since > FREEZE_WAVE_S ? -1 : since / FREEZE_WAVE_S,
  });

  requestAnimationFrame(frame);
}

layout();
newFlake();
requestAnimationFrame(frame);

// Accès de débogage depuis la console.
window.flocons = { sim, pacer, scene, chimes };
