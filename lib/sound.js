/**
 * lib/sound.js
 * Motor de SFX procedural (Web Audio API) — sem arquivos, sem copyright. Singleton.
 * A trilha musical do app é o player nativo do Audius (components/AudiusPlayer.jsx),
 * controlado pelo mesmo botão de mute.
 *
 * Uso:
 *   import { sound } from '../lib/sound';
 *   sound.play('click');        // efeito sonoro
 *   sound.toggleMute();         // liga/desliga tudo (SFX + Audius)
 *   sound.isMuted();            // estado atual
 */

const STORAGE_KEY = 'urban-secure:muted';

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.muted = false;

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
}

// Singleton
export const sound = typeof window !== 'undefined' ? (window.__urbanSound || (window.__urbanSound = new SoundEngine())) : new SoundEngine();
