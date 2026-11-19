// なんJ格闘技大会 - Visual Effects, Speech Bubbles, Projectiles & Live Commentary
(function () {
  'use strict';

  const { STAGE, CROWD_COMMENTS } = window.NanJ;

  class EffectsManager {
    constructor() {
      this.eventSink = null;
      this.reset();
    }

    _emit(ev) {
      if (this.eventSink) this.eventSink(ev);
    }

    reset() {
      this.particles = [];
      this.sparks = [];
      this.popTexts = [];
      this.projectiles = [];
      this.crowdComments = [];
      this.afterimages = [];
      this.lightningStrikes = [];
      this.screenShake = 0;
      this.hitstop = 0;
      this.superFlash = null; // { timer, maxTimer, fighterName, superName, side, accent }
      this.banner = null; // { text, sub, timer, maxTimer, color }
      this.gongPulse = 0;
      this.crowdHype = 0; // 0..1
      this.zoom = 1.0;
      this.targetZoom = 1.0;
      this.flashAlpha = 0;
      this.flashColor = '#ffffff';
    }

    shake(amount) {
      this.screenShake = Math.max(this.screenShake, amount);
      this._emit(['sk', Math.round(amount * 10) / 10]);
    }

    triggerHitstop(frames) {
      this.hitstop = Math.max(this.hitstop, frames);
    }

    triggerGong() {
      this.gongPulse = 1.0;
      this.crowdHype = Math.min(1, this.crowdHype + 0.65);
      this._emit(['gn']);
    }

    triggerFlash(color = '#ffffff', alpha = 0.55) {
      this.flashColor = color;
      this.flashAlpha = Math.max(this.flashAlpha, alpha);
      this._emit(['fl', color, Math.round(alpha * 100) / 100]);
    }

    showBanner(text, sub = '', duration = 70, color = '#ffb703') {
      this.banner = { text, sub, timer: duration, maxTimer: duration, color };
      this._emit(['bn', text, sub, duration, color]);
    }

    triggerSuperFlash(fighter, skipCrowd = false) {
      this.superFlash = {
        timer: 32,
        maxTimer: 32,
        fighterName: fighter.config.nameJp,
        superName: fighter.config.superName,
        side: fighter.slot,
        accent: fighter.config.accentColor,
        spriteSet: fighter.config.spriteSet,
      };
      this.hitstop = 28;
      this.screenShake = Math.max(this.screenShake, 12);
      this.crowdHype = 1.0;
      this._emit(['sf', fighter.slot]);
      if (!skipCrowd) {
        this.spawnCrowdBurst(4);
      }
    }

    spawnHitSpark(x, y, heavy = false, blocked = false, justGuard = false) {
      this._emit(['sp', Math.round(x), Math.round(y), heavy ? 1 : 0, blocked ? 1 : 0, justGuard ? 1 : 0]);
      const count = justGuard ? 16 : heavy ? 18 : 10;
      const color = justGuard
        ? '#38bdf8'
        : blocked
          ? '#93c5fd'
          : heavy
            ? '#ff6b1a'
            : '#ffd166';
      this.sparks.push({
        x,
        y,
        r: justGuard ? 16 : heavy ? 18 : 10,
        maxR: justGuard ? 82 : heavy ? 92 : 52,
        life: justGuard ? 14 : heavy ? 14 : 10,
        maxLife: justGuard ? 14 : heavy ? 14 : 10,
        color,
        rays: heavy ? 10 : 7,
        rot: Math.random() * Math.PI,
      });

      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const spd = (heavy ? 5.5 : 3.5) + Math.random() * (heavy ? 8 : 5);
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.5,
          size: (heavy ? 5 : 3.5) + Math.random() * 5,
          color: i % 2 === 0 ? color : '#fff8dc',
          life: 14 + Math.floor(Math.random() * 14),
          maxLife: 28,
          gravity: 0.25,
          shape: i % 3 === 0 ? 'star' : 'circle',
        });
      }
    }

    spawnDust(x, y, dir = 0, count = 6) {
      this._emit(['du', Math.round(x), Math.round(y), dir, count]);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * 34,
          y: y - Math.random() * 10,
          vx: -dir * (1.2 + Math.random() * 2.5) + (Math.random() - 0.5) * 2.2,
          vy: -0.8 - Math.random() * 2.4,
          size: 7 + Math.random() * 10,
          color: 'rgba(186, 212, 224, 0.55)',
          life: 16 + Math.floor(Math.random() * 12),
          maxLife: 28,
          gravity: -0.02,
          shape: 'smoke',
        });
      }
    }

    spawnGrassParticles(x, y, count = 8) {
      this._emit(['gr', Math.round(x), Math.round(y), count]);
      const chars = ['草', 'w', 'W', '草ァ', '💢'];
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2.5 + Math.random() * 6.5;
        this.popTexts.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 3.5,
          text: chars[Math.floor(Math.random() * chars.length)],
          color: '#a3e635',
          stroke: '#142611',
          size: 20 + Math.floor(Math.random() * 12),
          life: 32 + Math.floor(Math.random() * 14),
          maxLife: 46,
          gravity: 0.16,
          scalePop: true,
        });
      }
    }

    spawnPopText(x, y, text, color = '#ffe066', size = 34) {
      this._emit(['pt', Math.round(x), Math.round(y), text, color, size]);
      this.popTexts.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -2.6,
        text,
        color,
        stroke: '#1a120b',
        size,
        life: 36,
        maxLife: 36,
        gravity: 0.04,
        scalePop: true,
      });
    }

    spawnAfterimage(fighter, tint = 'rgba(255, 190, 60, 0.45)') {
      this._emit(['ai', fighter.slot, tint]);
      this.afterimages.push({
        x: fighter.x,
        y: fighter.y,
        facing: fighter.facing,
        pose: fighter.getCurrentPose(),
        spriteSet: fighter.config.spriteSet,
        scaleX: fighter.scaleX,
        scaleY: fighter.scaleY,
        tint,
        life: 11,
        maxLife: 11,
      });
    }

    spawnProjectile(opts) {
      this.projectiles.push({
        ownerSlot: opts.ownerSlot,
        x: opts.x,
        y: opts.y,
        vx: opts.vx,
        vy: opts.vy || 0,
        text: opts.text,
        damage: opts.damage,
        chip: opts.chip || 12,
        isCounter: !!opts.isCounter,
        isSuper: !!opts.isSuper,
        radius: opts.radius || (opts.isSuper ? 56 : opts.isCounter ? 44 : 36),
        accent: opts.accent || '#ff7a1f',
        life: opts.life || 110,
        maxLife: opts.life || 110,
        hitsLeft: opts.hitsLeft || 1,
        hitCooldown: 0,
        inflictsTilt: opts.inflictsTilt !== false,
        kind: opts.kind || 'bubble', // 'bubble' | 'meteor' | 'beam'
      });
    }

    spawnLightning(ownerSlot, x, damage, accent = '#60a5fa') {
      this.lightningStrikes.push({
        ownerSlot,
        x,
        damage,
        accent,
        warning: 18,
        active: 14,
        hitDone: false,
      });
    }

    spawnCrowdComment(customText = null) {
      if (this.crowdComments.length >= 12) return;
      const text = customText || CROWD_COMMENTS[Math.floor(Math.random() * CROWD_COMMENTS.length)];
      this._emit(['cc', text]);
      this.crowdComments.push({
        text,
        x: STAGE.WIDTH + 30,
        y: 128 + Math.random() * 145,
        vx: -(2.6 + Math.random() * 2.2),
        size: 18 + Math.floor(Math.random() * 6),
        alpha: 0.72,
      });
    }

    spawnCrowdBurst(count = 3, customLines = null) {
      this.crowdHype = Math.min(1, this.crowdHype + 0.45);
      for (let i = 0; i < count; i++) {
        const line = customLines && customLines[i % customLines.length]
          ? customLines[i % customLines.length]
          : null;
        this.spawnCrowdComment(line);
      }
    }

    update(options = null) {
      const ignoreHitstop = !!(options && options.ignoreHitstop);
      const clientVisualOnly = !!(options && options.clientVisualOnly);

      // Screen shake & flash always decay smoothly even during hitstop
      if (this.screenShake > 0) {
        this.screenShake = Math.max(0, this.screenShake * 0.84 - 0.2);
      }
      if (this.flashAlpha > 0) {
        this.flashAlpha = Math.max(0, this.flashAlpha - 0.045);
      }
      if (this.gongPulse > 0) {
        this.gongPulse = Math.max(0, this.gongPulse - 0.02);
      }
      this.crowdHype = Math.max(0, this.crowdHype - 0.008);
      this.zoom += (this.targetZoom - this.zoom) * 0.14;

      if (this.superFlash) {
        this.superFlash.timer--;
        if (this.superFlash.timer <= 0) this.superFlash = null;
      }

      if (this.banner) {
        this.banner.timer--;
        if (this.banner.timer <= 0) this.banner = null;
      }

      // Live comments keep scrolling smoothly
      for (let i = this.crowdComments.length - 1; i >= 0; i--) {
        const c = this.crowdComments[i];
        c.x += c.vx;
        if (c.x < -360) this.crowdComments.splice(i, 1);
      }

      if (!ignoreHitstop && this.hitstop > 0) {
        this.hitstop--;
        return true; // Freeze gameplay simulation during hitstop
      }

      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.life--;
        s.r += (s.maxR - s.r) * 0.32;
        if (s.life <= 0) this.sparks.splice(i, 1);
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life--;
        if (p.life <= 0) this.particles.splice(i, 1);
      }

      for (let i = this.popTexts.length - 1; i >= 0; i--) {
        const t = this.popTexts[i];
        t.x += t.vx;
        t.y += t.vy;
        t.vy += t.gravity;
        t.life--;
        if (t.life <= 0) this.popTexts.splice(i, 1);
      }

      for (let i = this.afterimages.length - 1; i >= 0; i--) {
        this.afterimages[i].life--;
        if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
      }

      if (clientVisualOnly) {
        // Light extrapolation between host snapshots; host owns creation & deletion
        for (const pr of this.projectiles) {
          pr.x += pr.vx;
          pr.y += pr.vy;
        }
        return false;
      }

      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        pr.x += pr.vx;
        pr.y += pr.vy;
        if (pr.hitCooldown > 0) pr.hitCooldown--;
        pr.life--;
        if (
          pr.life <= 0 ||
          pr.hitsLeft <= 0 ||
          pr.x < -160 ||
          pr.x > STAGE.WIDTH + 160 ||
          pr.y > STAGE.GROUND_Y + 60
        ) {
          this.projectiles.splice(i, 1);
        }
      }

      for (let i = this.lightningStrikes.length - 1; i >= 0; i--) {
        const l = this.lightningStrikes[i];
        if (l.warning > 0) {
          l.warning--;
        } else {
          l.active--;
          if (l.active <= 0) this.lightningStrikes.splice(i, 1);
        }
      }

      return false;
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.EffectsManager = EffectsManager;
})();
