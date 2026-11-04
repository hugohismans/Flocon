/**
 * Interface minimale : liaison des contrôles HTML aux callbacks de l'app.
 * Aucune logique de simulation ici, seulement l'affichage des valeurs.
 */
import { temperatureToParams } from '../sim/climate.js';

/** Vitesse (0–100) -> rayon gagné par seconde, en échelle logarithmique. */
const SPEED = { min: 1.2, max: 14, ref: 4 };
export const speedToCellsPerSecond = (v) => SPEED.min * (SPEED.max / SPEED.min) ** (v / 100);
const cellsPerSecondToSpeed = (c) => (Math.log(c / SPEED.min) / Math.log(SPEED.max / SPEED.min)) * 100;

const $ = (id) => document.getElementById(id);

/** Lie un curseur : affichage formaté + remplissage de piste + callback. */
function bindSlider(id, initial, format, onChange) {
  const slider = $(id);
  const output = $(`${id}-value`);
  const min = Number(slider.min), max = Number(slider.max);
  const show = () => {
    const v = Number(slider.value);
    output.textContent = format(v);
    slider.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
  };
  slider.value = String(initial);
  show();
  slider.addEventListener('input', () => {
    show();
    onChange(Number(slider.value));
  });
}

/**
 * @param {object} o
 * @param {number} o.humidity  valeur initiale en %
 * @param {number} o.temperature valeur initiale en °C
 * @param {number} o.cellsPerSecond vitesse initiale
 */
export function bindControls(o) {
  bindSlider('humidity', o.humidity, (v) => `${Math.round(v)} %`, o.onHumidity);
  bindSlider(
    'temperature',
    o.temperature,
    (v) => `${temperatureToParams(v).name} · ${v.toFixed(v % 1 ? 1 : 0).replace('-', '−').replace('.', ',')} °C`,
    o.onTemperature,
  );
  bindSlider(
    'speed',
    Math.round(cellsPerSecondToSpeed(o.cellsPerSecond)),
    (v) => `×${(speedToCellsPerSecond(v) / SPEED.ref).toFixed(1).replace('.', ',')}`,
    (v) => o.onSpeed(speedToCellsPerSecond(v)),
  );
  $('btn-freeze').addEventListener('click', o.onFreeze);
  $('btn-new').addEventListener('click', o.onNew);

  const sound = $('btn-sound');
  const showSound = (muted) => {
    sound.setAttribute('aria-pressed', String(muted));
    sound.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
    sound.classList.toggle('muted', muted);
  };
  showSound(o.muted);
  sound.addEventListener('click', () => showSound(o.onToggleSound()));
}

/** Active / désactive le bouton Geler selon l'état du flocon. */
export function setFrozenUI(frozen) {
  const b = $('btn-freeze');
  b.disabled = frozen;
  b.textContent = frozen ? 'Figé' : 'Geler';
}

/** Met à jour le petit texte d'état sous le titre. */
export function setStatus(text) {
  $('status').textContent = text;
}

/** Masque l'indication de toucher après la première utilisation. */
export function hideHint() {
  $('hint').classList.add('hidden');
}
