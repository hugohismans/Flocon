/**
 * Son — notes cristallines douces (Web Audio API, aucun fichier audio).
 *
 * Chaque note imite une petite lame de verre : une fondamentale et deux
 * partiels inharmoniques (rapports 2,76 et 5,40, modes d'une barre libre)
 * qui s'éteignent plus vite, le tout dans une réverbération synthétique.
 * Les hauteurs sont prises dans une gamme pentatonique : aucune
 * combinaison de notes ne peut sonner faux.
 *
 * Le navigateur n'autorise l'audio qu'après un geste du joueur : on crée
 * le contexte au premier toucher / clic (unlock).
 */

// Gamme pentatonique majeure de ré, sur deux octaves et demie (Hz).
const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
const SCALE = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98, 100].map(midiToHz);

const STORAGE_KEY = 'flocons.muted';

export class Chimes {
  constructor() {
    this.ctx = null;
    this.muted = readMuted();
    this.lastNoteTime = 0;
    this.lastIndex = -1;
    this.tokens = 3; // limiteur de densité : ~3 notes par seconde au plus
  }

  /** À appeler depuis un geste du joueur. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // Réverbération : réponse impulsionnelle stéréo de bruit décroissant.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.6;
    this.dry.connect(this.master);

    // Souffle (injection de vapeur) : bruit filtré en boucle, gain à 0.
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx, 2);
    noise.loop = true;
    this.breathFilter = ctx.createBiquadFilter();
    this.breathFilter.type = 'bandpass';
    this.breathFilter.frequency.value = 900;
    this.breathFilter.Q.value = 0.8;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breathPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let node = noise.connect(this.breathFilter).connect(this.breathGain);
    if (this.breathPan) node = node.connect(this.breathPan);
    node.connect(this.dry);
    node.connect(this.reverb);
    noise.start();
  }

  setMuted(muted) {
    this.muted = muted;
    writeMuted(muted);
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.08);
  }

  /** Appelée à chaque image : recharge le limiteur de densité. */
  update(dt) {
    this.tokens = Math.min(3, this.tokens + dt * 2.5);
  }

  /**
   * Un embranchement vient de naître.
   * @param {number} pan position horizontale -1..1
   * @param {number} radial distance au centre 0..1 (centre = grave)
   */
  branch(pan, radial) {
    if (!this._ready() || this.tokens < 1) return;
    const now = this.ctx.currentTime;
    if (now - this.lastNoteTime < 0.14) return;
    this.tokens -= 1;
    this.lastNoteTime = now;
    // Hauteur : plus la branche est loin du cœur, plus la note est aiguë,
    // avec un léger hasard et sans répéter deux fois la même note.
    let idx = Math.round(radial * (SCALE.length - 4) + Math.random() * 3);
    idx = Math.max(0, Math.min(SCALE.length - 1, idx));
    if (idx === this.lastIndex) idx = Math.max(0, idx - 1 - ((Math.random() * 2) | 0));
    this.lastIndex = idx;
    this._note(SCALE[idx], now, 0.05 + Math.random() * 0.03, 2.4, pan);
  }

  /** Le flocon est figé : arpège lent et lumineux. */
  freezeChord() {
    if (!this._ready()) return;
    const now = this.ctx.currentTime + 0.05;
    [0, 2, 4, 7, 9].forEach((k, n) => {
      this._note(SCALE[k] / 2, now + n * 0.11, 0.07, 4.5, (n - 2) * 0.25);
      this._note(SCALE[k], now + n * 0.11 + 0.02, 0.035, 3.5, (2 - n) * 0.2);
    });
  }

  /** Souffle doux pendant l'injection de vapeur. */
  breath(active, pan = 0) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this.breathGain.gain.setTargetAtTime(active ? 0.05 : 0, t, active ? 0.12 : 0.25);
    if (this.breathPan) this.breathPan.pan.setTargetAtTime(pan, t, 0.1);
    this.breathFilter.frequency.setTargetAtTime(active ? 1300 : 700, t, 0.3);
  }

  _ready() {
    return this.ctx && !this.muted && this.ctx.state === 'running';
  }

  /** Une note de « verre » : fondamentale + partiels inharmoniques. */
  _note(freq, t, gain, decay, pan) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    let tail = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(p);
      tail = p;
    }
    tail.connect(this.dry);
    tail.connect(this.reverb);

    const partials = [
      [1, 1, decay],
      [2.76, 0.32, decay * 0.45],
      [5.4, 0.12, decay * 0.22],
    ];
    for (const [ratio, amp, dec] of partials) {
      const f = freq * ratio;
      if (f > 16000) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(gain * amp, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + dec + 0.05);
    }
  }
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function makeNoise(ctx, seconds) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(m) {
  try {
    localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}
