/**
 * Interface minimale : liaison des contrôles HTML aux callbacks de l'app.
 * Aucune logique de simulation ici.
 */

/** Humidité affichée (%) -> β du modèle de Reiter. */
export const HUMIDITY_RANGE = { min: 0.3, max: 0.58 };
export const humidityToBeta = (pct) => HUMIDITY_RANGE.min + (HUMIDITY_RANGE.max - HUMIDITY_RANGE.min) * (pct / 100);
export const betaToHumidity = (beta) => ((beta - HUMIDITY_RANGE.min) / (HUMIDITY_RANGE.max - HUMIDITY_RANGE.min)) * 100;

/**
 * @param {{ onHumidity: (beta: number) => void, onNew: () => void }} handlers
 */
export function bindControls({ onHumidity, onNew, initialBeta }) {
  const slider = document.getElementById('humidity');
  const output = document.getElementById('humidity-value');
  const btnNew = document.getElementById('btn-new');

  const show = () => {
    output.textContent = `${Math.round(slider.value)} %`;
    // Remplissage de la piste (variable CSS), pour un rendu identique partout.
    slider.style.setProperty('--fill', `${slider.value}%`);
  };

  slider.value = String(Math.round(betaToHumidity(initialBeta)));
  show();
  slider.addEventListener('input', () => {
    show();
    onHumidity(humidityToBeta(Number(slider.value)));
  });
  btnNew.addEventListener('click', onNew);
}

/** Met à jour le petit texte d'état sous le titre. */
export function setStatus(text) {
  document.getElementById('status').textContent = text;
}
