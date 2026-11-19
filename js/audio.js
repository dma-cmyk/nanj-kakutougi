// なんJ格闘技大会 - Web Audio Retro Arcade SFX & BGM Engine
(function () {
  'use strict';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.bgmGain = null;
      this.sfxGain = null;
      this.muted = false;
      this.bgmEnabled = true;
      this.bgmTimer = null;
      this.bgmStep = 0;
      this.bgmMode = 'battle'; // 'title' | 'battle' | 'boss'
      this.unlocked = false;
      this.playSink = null;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.72;
        this.master.connect(this.ctx.destination);

        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.bgmEnabled ? 0.24 : 0;
        this.bgmGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.85;
        this.sfxGain.connect(this.master);
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = true;
    }

    setMuted(m) {
      this.muted = m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(m ? 0 : 0.72, this.ctx.currentTime, 0.02);
      }
    }

    toggleMute() {
      this.setMuted(!this.muted);
      return this.muted;
    }

    toggleBgm() {
      this.bgmEnabled = !this.bgmEnabled;
      if (this.bgmGain && this.ctx) {
        this.bgmGain.gain.setTargetAtTime(this.bgmEnabled ? 0.24 : 0, this.ctx.currentTime, 0.03);
      }
      return this.bgmEnabled;
    }

    _noiseBuffer(duration) {
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buf;
    }

    _tone(type, freqStart, freqEnd, duration, gainPeak, delay = 0, target = null) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, now);
      if (freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainPeak, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(target || this.sfxGain);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    _noise(duration, filterFreq, gainPeak, delay = 0, filterType = 'bandpass') {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(duration);
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, now);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(gainPeak, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      src.start(now);
      src.stop(now + duration + 0.02);
    }

    play(name) {
      if (this.playSink) this.playSink(name);
      if (!this.unlocked || !this.ctx || this.muted) return;
      if (this.ctx.state !== 'running') return;

      switch (name) {
        case 'whiff':
          this._noise(0.08, 1300, 0.16, 0, 'bandpass');
          this._tone('triangle', 340, 140, 0.07, 0.12);
          break;
        case 'light':
          this._noise(0.09, 1800, 0.42, 0, 'highpass');
          this._tone('square', 280, 90, 0.08, 0.34);
          this._tone('triangle', 520, 180, 0.06, 0.25);
          break;
        case 'heavy':
          this._noise(0.18, 650, 0.65, 0, 'lowpass');
          this._tone('sawtooth', 190, 42, 0.18, 0.55);
          this._tone('square', 420, 110, 0.11, 0.35);
          break;
        case 'block':
          this._tone('square', 520, 260, 0.08, 0.28);
          this._noise(0.07, 2600, 0.24, 0, 'highpass');
          break;
        case 'justGuard':
          this._tone('sine', 1200, 1850, 0.16, 0.42);
          this._tone('triangle', 880, 1760, 0.2, 0.32, 0.03);
          this._noise(0.06, 4000, 0.2, 0, 'highpass');
          break;
        case 'jump':
          this._tone('triangle', 220, 560, 0.13, 0.22);
          break;
        case 'dash':
          this._noise(0.11, 900, 0.25, 0, 'bandpass');
          this._tone('sine', 240, 480, 0.09, 0.16);
          break;
        case 'resba':
          // Comic taunt pop + cheeky arpeggio
          this._tone('square', 440, 660, 0.07, 0.28);
          this._tone('square', 660, 880, 0.09, 0.28, 0.05);
          this._tone('triangle', 330, 520, 0.12, 0.2, 0.02);
          break;
        case 'counter':
          // Dramatic RESBA COUNTER CLASH!
          this._tone('sawtooth', 523, 1046, 0.14, 0.42);
          this._tone('square', 784, 1568, 0.22, 0.38, 0.05);
          this._tone('sine', 1046, 2093, 0.28, 0.32, 0.1);
          this._noise(0.16, 2200, 0.35, 0, 'bandpass');
          break;
        case 'clash':
          this._tone('triangle', 920, 340, 0.14, 0.34);
          this._noise(0.12, 2400, 0.36, 0, 'bandpass');
          break;
        case 'charge':
          this._tone('triangle', 320, 740, 0.24, 0.22);
          this._tone('sine', 480, 960, 0.26, 0.18, 0.04);
          break;
        case 'ex':
          this._tone('sawtooth', 260, 780, 0.2, 0.38);
          this._tone('square', 520, 1040, 0.24, 0.32, 0.04);
          this._noise(0.16, 1500, 0.3, 0, 'bandpass');
          break;
        case 'super':
          // Classic arcade super flash chime!
          [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
            this._tone('square', f, f * 1.03, 0.24, 0.26, idx * 0.045);
            this._tone('sine', f * 2, f * 2, 0.28, 0.18, idx * 0.045);
          });
          this._noise(0.28, 1200, 0.36, 0.02, 'lowpass');
          break;
        case 'gong':
          // Brass tournament gong!
          [165, 247, 349, 494, 622].forEach((f, idx) => {
            this._tone(idx % 2 === 0 ? 'triangle' : 'sine', f, f * 0.96, 1.15 - idx * 0.12, 0.26 / (idx + 1));
          });
          this._noise(0.45, 950, 0.34, 0, 'bandpass');
          break;
        case 'ko':
          this._noise(0.45, 500, 0.72, 0, 'lowpass');
          this._tone('sawtooth', 220, 38, 0.55, 0.6);
          this._tone('square', 330, 55, 0.42, 0.35, 0.05);
          // Gong echo
          [155, 233, 330].forEach((f, idx) => {
            this._tone('triangle', f, f * 0.94, 1.3, 0.24 / (idx + 1), 0.12);
          });
          break;
        case 'crowd':
          this._noise(0.55, 1100, 0.24, 0, 'bandpass');
          this._noise(0.45, 1800, 0.14, 0.08, 'bandpass');
          break;
        case 'select':
          this._tone('square', 620, 880, 0.07, 0.22);
          break;
        case 'confirm':
          this._tone('square', 523, 523, 0.07, 0.24);
          this._tone('square', 784, 1046, 0.16, 0.26, 0.06);
          break;
        case 'victory':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this._tone('square', f, f, 0.22, 0.24, i * 0.11);
            this._tone('triangle', f * 0.5, f * 0.5, 0.28, 0.22, i * 0.11);
          });
          break;
        case 'defeat':
          [392, 349.23, 311.13, 261.63].forEach((f, i) => {
            this._tone('triangle', f, f * 0.97, 0.26, 0.25, i * 0.15);
          });
          break;
      }
    }

    startBgm(mode = 'battle') {
      this.bgmMode = mode;
      if (this.bgmTimer) return;
      this.bgmStep = 0;

      // Energetic 90s Neo-Geo / Street Fighter night-stage style pentatonic rock riff!
      const bassBattle = [
        110, 0, 110, 130.8, 146.8, 0, 130.8, 110,
        98, 0, 98, 110, 130.8, 0, 146.8, 164.8,
        110, 0, 110, 130.8, 146.8, 164.8, 146.8, 130.8,
        87.3, 0, 98, 0, 110, 130.8, 146.8, 0,
      ];
      const leadBattle = [
        440, 0, 523.25, 0, 587.33, 659.25, 587.33, 523.25,
        440, 0, 392, 440, 523.25, 0, 0, 0,
        659.25, 0, 587.33, 523.25, 440, 523.25, 587.33, 0,
        523.25, 440, 392, 329.63, 440, 0, 0, 0,
      ];
      const leadTitle = [
        330, 0, 440, 0, 523.25, 0, 493.88, 0,
        440, 0, 392, 0, 330, 0, 0, 0,
        293.66, 0, 392, 0, 440, 0, 523.25, 0,
        493.88, 0, 440, 0, 392, 0, 0, 0,
      ];

      this.bgmTimer = setInterval(() => {
        if (!this.ctx || this.muted || !this.bgmEnabled || this.ctx.state !== 'running') return;
        const step = this.bgmStep % 32;
        this.bgmStep++;

        const isTitle = this.bgmMode === 'title';
        const bass = bassBattle[step];
        const lead = isTitle ? leadTitle[step] : leadBattle[step];

        if (bass > 0) {
          this._tone('sawtooth', bass, bass * 0.99, 0.12, isTitle ? 0.14 : 0.24, 0, this.bgmGain);
        }
        if (lead > 0) {
          this._tone('square', lead, lead, 0.13, isTitle ? 0.12 : 0.17, 0, this.bgmGain);
        }
        // Arcade kick & hi-hat pulse
        if (!isTitle) {
          if (step % 4 === 0) {
            this._tone('sine', 120, 42, 0.08, 0.28, 0, this.bgmGain);
          }
          if (step % 4 === 2) {
            this._noise(0.04, 4200, 0.06, 0, 'highpass');
          }
        }
      }, 145);
    }

    stopBgm() {
      if (this.bgmTimer) {
        clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.sound = new SoundEngine();
})();
