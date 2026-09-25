// Tiny procedural sound effects (WebAudio, no asset files): short synthesized
// blips, thuds and noise bursts with a retro feel. Positional attenuation is
// a simple distance falloff.

type Sfx = 'swing' | 'hit' | 'mine' | 'stone' | 'pickup' | 'hurt' | 'jump' | 'explode' | 'bow' | 'magic' | 'door' | 'craft' | 'place' | 'die' | 'splat' | 'drink' | 'chop' | 'land' | 'horn' | 'omen' | 'flap' | 'screech' | 'gust' | 'splash';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.5;
  private last = new Map<string, number>();

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const s = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter();
    s.buffer = this.noise;
    fl.type = filter;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
  }

  /** Play a sound; `dist` (metres) attenuates it. */
  play(name: Sfx, dist = 0) {
    if (!this.ctx || !this.master || !this.noise) return;
    const now = this.ctx.currentTime;
    // Rate-limit identical sounds (e.g. many hits in one frame).
    if (now - (this.last.get(name) ?? -1) < 0.03) return;
    this.last.set(name, now);
    const v = Math.max(0, 1 - dist / 40);
    if (v <= 0) return;
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'swing': this.burst(0.12, 0.25 * v, 'bandpass', 1800 * r, 600, 0); break;
      case 'hit': this.tone('square', 180 * r, 60, 0.1, 0.25 * v); this.burst(0.08, 0.3 * v, 'lowpass', 2000, 300); break;
      case 'mine': this.burst(0.07, 0.35 * v, 'bandpass', 900 * r, 400); this.tone('triangle', 240 * r, 120, 0.06, 0.15 * v); break;
      case 'stone': this.burst(0.09, 0.4 * v, 'bandpass', 2400 * r, 900); this.tone('square', 420 * r, 300, 0.04, 0.08 * v); break;
      case 'chop': this.burst(0.08, 0.35 * v, 'lowpass', 1200 * r, 300); this.tone('triangle', 160 * r, 90, 0.08, 0.2 * v); break;
      case 'pickup': this.tone('square', 660 * r, 990 * r, 0.06, 0.08 * v); break;
      case 'hurt': this.tone('sawtooth', 220 * r, 90, 0.2, 0.22 * v); break;
      case 'jump': this.tone('square', 260, 520, 0.08, 0.06 * v); break;
      case 'land': this.burst(0.06, 0.2 * v, 'lowpass', 500, 150); break;
      case 'explode': this.burst(0.8, 0.8 * v, 'lowpass', 1600, 60); this.tone('sine', 90, 30, 0.6, 0.6 * v); break;
      case 'bow': this.tone('triangle', 520 * r, 180, 0.12, 0.18 * v); this.burst(0.06, 0.15 * v, 'highpass', 3000, 2000); break;
      case 'magic': this.tone('sine', 900 * r, 1800 * r, 0.18, 0.12 * v); this.tone('sine', 1350 * r, 2400 * r, 0.14, 0.06 * v, 0.03); break;
      case 'door': this.tone('sawtooth', 110 * r, 80, 0.18, 0.08 * v); this.burst(0.1, 0.15 * v, 'bandpass', 700, 400); break;
      case 'craft': this.tone('square', 523, 523, 0.07, 0.07); this.tone('square', 784, 784, 0.1, 0.07, 0.07); break;
      case 'place': this.burst(0.06, 0.3 * v, 'lowpass', 900, 200); break;
      case 'die': this.tone('square', 300 * r, 70, 0.35, 0.18 * v); this.burst(0.3, 0.2 * v, 'lowpass', 1500, 200); break;
      case 'splat': this.burst(0.12, 0.3 * v, 'lowpass', 1400 * r, 200); this.tone('sine', 140 * r, 60, 0.1, 0.2 * v); break;
      case 'horn': this.tone('sawtooth', 110, 104, 1.1, 0.22 * v); this.tone('sawtooth', 165, 158, 1.1, 0.14 * v, 0.05); this.tone('square', 82, 80, 1.2, 0.1 * v); break;
      case 'omen': this.tone('sine', 220, 196, 1.6, 0.18 * v); this.tone('sine', 233, 208, 1.6, 0.12 * v, 0.2); this.tone('triangle', 110, 98, 2, 0.14 * v, 0.1); break;
      case 'flap': this.burst(0.14, 0.18 * v, 'lowpass', 700 * r, 200); break;
      case 'screech': this.tone('sawtooth', 1400 * r, 700, 0.5, 0.14 * v); this.tone('square', 1900 * r, 900, 0.4, 0.06 * v, 0.05); this.burst(0.3, 0.12 * v, 'highpass', 3000, 1500); break;
      case 'gust': this.burst(0.45, 0.35 * v, 'bandpass', 500 * r, 1800); this.burst(0.3, 0.2 * v, 'highpass', 2500, 800, 0.1); break;
      case 'splash': this.burst(0.35, 0.3 * v, 'lowpass', 2200 * r, 300); this.burst(0.2, 0.15 * v, 'highpass', 3000, 1200, 0.05); break;
      case 'drink': for (let i = 0; i < 3; i++) this.tone('sine', 300 + i * 80, 500 + i * 80, 0.06, 0.1, i * 0.08); break;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
}
