/**
 * lib/sound.js
 * Motor de áudio procedural (Web Audio API) — sem arquivos, sem copyright.
 * SFX synth/cyberpunk + música pulsante em loop. Singleton.
 *
 * Uso:
 *   import { sound } from '../lib/sound';
 *   sound.play('click');        // efeito sonoro
 *   sound.toggleMute();         // liga/desliga tudo
 *   sound.isMuted();            // estado atual
 *   sound.startMusic();         // inicia a trilha (após gesto do usuário)
 */

const STORAGE_KEY = 'urban-secure:muted';

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicOn = false;
    this._musicTimer = null;
    this._step = 0;

    if (typeof window !== 'undefined') {
      try { this.muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
    }
  }

  // Inicializa o AudioContext (precisa ser chamado após um gesto do usuário)
  _ensure() {
    if (typeof window === 'undefined') return false;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.16; // música ao fundo, discreta
        this.musicGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.5;
        this.sfxGain.connect(this.master);
      } catch { return false; }
    }
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); }
    return true;
  }

  isMuted() { return this.muted; }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0'); } catch {}
    if (this._ensure() && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 1, now + 0.15);
    }
    return this.muted;
  }

  // ── SFX procedurais ──────────────────────────────────────
  _beep({ freq = 440, type = 'square', dur = 0.08, gain = 0.3, sweep = 0, delay = 0 }) {
    if (!this._ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (!this._ensure()) return;
    switch (name) {
      case 'click':
        this._beep({ freq: 660, type: 'square', dur: 0.06, gain: 0.22, sweep: 120 });
        break;
      case 'hover':
        this._beep({ freq: 880, type: 'sine', dur: 0.04, gain: 0.12 });
        break;
      case 'success': // mint concluído — acorde ascendente
        [523, 659, 784, 1047].forEach((f, i) =>
          this._beep({ freq: f, type: 'triangle', dur: 0.18, gain: 0.26, delay: i * 0.09 }));
        break;
      case 'transaction': // sweep futurista
        this._beep({ freq: 200, type: 'sawtooth', dur: 0.35, gain: 0.22, sweep: 600 });
        this._beep({ freq: 400, type: 'square', dur: 0.12, gain: 0.14, delay: 0.18 });
        break;
      case 'error': // descida
        this._beep({ freq: 320, type: 'sawtooth', dur: 0.3, gain: 0.24, sweep: -180 });
        break;
      case 'bootTick':
        this._beep({ freq: 1200, type: 'square', dur: 0.03, gain: 0.10 });
        break;
      case 'bootConnected':
        [440, 660, 880].forEach((f, i) =>
          this._beep({ freq: f, type: 'triangle', dur: 0.14, gain: 0.20, delay: i * 0.07 }));
        break;
      default:
        this._beep({ freq: 600, type: 'square', dur: 0.06, gain: 0.2 });
    }
  }

  // ── Música pulsante em loop (synth cyberpunk) ────────────
  startMusic() {
    if (!this._ensure() || this.musicOn) return;
    this.musicOn = true;
    const stepDur = 0.26; // ~115 BPM em colcheias

    // escala menor (Lá menor) para a vibe cyberpunk
    const bass = [110, 110, 146.83, 130.81];           // A2 A2 D3 C3
    const arp  = [220, 261.63, 329.63, 440, 329.63, 261.63]; // arpejo Am

    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      const s = this._step;

      // baixo pulsante (a cada 2 steps)
      if (s % 2 === 0) {
        const f = bass[(s / 2) % bass.length];
        this._voice({ freq: f, type: 'sawtooth', dur: 0.5, gain: 0.5, target: this.musicGain, lp: 600 });
      }
      // kick sutil no tempo
      if (s % 4 === 0) {
        this._kick();
      }
      // arpejo brilhante
      const af = arp[s % arp.length];
      this._voice({ freq: af, type: 'square', dur: 0.22, gain: 0.12, target: this.musicGain, lp: 2400 });

      // hi-hat offbeat
      if (s % 2 === 1) this._noise(0.03, 0.05);

      this._step = (s + 1) % 48;
      this._musicTimer = setTimeout(tick, stepDur * 1000);
    };
    tick();
  }

  stopMusic() {
    this.musicOn = false;
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
  }

  _voice({ freq, type, dur, gain, target, lp }) {
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    let node = osc;
    if (lp) {
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = lp;
      osc.connect(filt); node = filt;
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); g.connect(target);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  _kick() {
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    g.gain.setValueAtTime(0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t0); osc.stop(t0 + 0.2);
  }

  _noise(dur, gain) {
    const t0 = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 7000;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(this.musicGain);
    src.start(t0); src.stop(t0 + dur);
  }
}

// Singleton
export const sound = typeof window !== 'undefined' ? (window.__urbanSound || (window.__urbanSound = new SoundEngine())) : new SoundEngine();
