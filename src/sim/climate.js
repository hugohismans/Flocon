/**
 * Climat : traduit les réglages « parlants » du joueur (humidité en %,
 * température en °C) en paramètres du modèle de Reiter.
 *
 * La température suit, en 2D, le diagramme de Nakaya : la forme des
 * cristaux alterne quand l'air se refroidit (plaques → aiguilles → plaques
 * → dendrites → plaques). Chaque régime est un point d'ancrage ; entre deux
 * ancrages les paramètres sont interpolés, ce qui donne des formes
 * intermédiaires et des transitions douces si l'on bouge le curseur pendant
 * la croissance (le flocon garde alors la trace de son « voyage »).
 *
 * Module pur, sans DOM.
 */

/** Humidité (0–100 %) -> β, vapeur ambiante. */
export const HUMIDITY_RANGE = { min: 0.3, max: 0.58 };
export const humidityToBeta = (pct) => HUMIDITY_RANGE.min + (HUMIDITY_RANGE.max - HUMIDITY_RANGE.min) * (pct / 100);

/** Plage de température proposée au joueur, en °C. */
export const TEMPERATURE_RANGE = { min: -25, max: -1 };

/**
 * Ancrages du diagramme de Nakaya.
 *   gamma : apport en couche limite (élevé = plaques pleines)
 *   side  : seuil de gel des flancs (k = 2 voisins) ; élevé = aiguilles
 *   tip   : seuil des pointes (k = 1)
 */
const ANCHORS = [
  { t: -1, name: 'Plaques', gamma: 0.02, side: 1.0, tip: 1.0 },
  { t: -3, name: 'Plaques', gamma: 0.011, side: 1.1, tip: 1.0 },
  { t: -6, name: 'Aiguilles', gamma: 0.0, side: 4.5, tip: 0.9 },
  { t: -11, name: 'Secteurs', gamma: 0.004, side: 1.2, tip: 1.0 },
  { t: -15, name: 'Dendrites', gamma: 0.0008, side: 1.0, tip: 1.0 },
  { t: -20, name: 'Étoiles', gamma: 0.0003, side: 2.8, tip: 1.0 },
  { t: -25, name: 'Plaques', gamma: 0.01, side: 1.2, tip: 1.0 },
];

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * @param {number} celsius
 * @returns {{gamma: number, thresholds: number[], name: string}}
 */
export function temperatureToParams(celsius) {
  const t = Math.min(TEMPERATURE_RANGE.max, Math.max(TEMPERATURE_RANGE.min, celsius));
  let a = ANCHORS[0], b = ANCHORS[ANCHORS.length - 1];
  for (let k = 0; k < ANCHORS.length - 1; k++) {
    if (t <= ANCHORS[k].t && t >= ANCHORS[k + 1].t) {
      a = ANCHORS[k];
      b = ANCHORS[k + 1];
      break;
    }
  }
  const k = a.t === b.t ? 0 : (a.t - t) / (a.t - b.t);
  // Lissage : les régimes « tiennent » autour de leur ancrage.
  const e = k * k * (3 - 2 * k);
  const side = lerp(a.side, b.side, e);
  const tip = lerp(a.tip, b.tip, e);
  return {
    gamma: lerp(a.gamma, b.gamma, e),
    thresholds: [1, tip, side, 1, 1, 1, 1],
    name: e < 0.5 ? a.name : b.name,
  };
}
