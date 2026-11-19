// なんJ格闘技大会 - Reactive CPU AI & Attract-Mode Demo AI
(function () {
  'use strict';

  const { DIFFICULTY } = window.NanJ;

  class FighterAI {
    constructor(difficultyId = 'normal') {
      this.setDifficulty(difficultyId);
      this.thinkTimer = 0;
      this.intent = 'approach';
      this.intentTimer = 0;
      this.guardHold = 0;
      this.prevGuard = false;
    }

    setDifficulty(difficultyId) {
      this.cfg = DIFFICULTY[difficultyId] || DIFFICULTY.normal;
    }

    getEmptyInput() {
      return {
        dirX: 0,
        up: false,
        down: false,
        guard: false,
        guardJustPressed: false,
        lightPressed: false,
        heavyPressed: false,
        resbaPressed: false,
        specialPressed: false,
      };
    }

    decide(me, opp, fx, demoMode = false) {
      const inp = this.getEmptyInput();
      const dist = Math.abs(opp.x - me.x);
      const toward = opp.x >= me.x ? 1 : -1;

      if (this.guardHold > 0) {
        this.guardHold--;
        inp.guard = true;
        inp.guardJustPressed = !this.prevGuard;
        this.prevGuard = true;
        return inp;
      }

      // 1. Check incoming Resba projectile -> Counter Resba OR Guard OR Jump!
      const incomingProj = fx.projectiles.find(
        (p) =>
          p.ownerSlot !== me.slot &&
          Math.abs(p.x - me.x) < 230 &&
          ((p.vx > 0 && p.x < me.x + 20) || (p.vx < 0 && p.x > me.x - 20))
      );

      if (incomingProj && this.thinkTimer <= 0) {
        const r = Math.random();
        if (!incomingProj.isSuper && r < (demoMode ? 0.55 : this.cfg.counterResbaRate)) {
          inp.resbaPressed = true;
          this.thinkTimer = this.cfg.reactionFrames + 8;
          this.prevGuard = false;
          return inp;
        }
        if (r < (demoMode ? 0.8 : this.cfg.counterResbaRate + this.cfg.guardRate * 0.6)) {
          inp.guard = true;
          inp.guardJustPressed = !this.prevGuard;
          this.guardHold = 12;
          this.prevGuard = true;
          return inp;
        }
        if (me.isGrounded() && r < 0.92) {
          inp.up = true;
          inp.dirX = toward;
          this.thinkTimer = 16;
          this.prevGuard = false;
          return inp;
        }
      }

      // 2. React to opponent melee attack at close range
      if (opp.state === 'attack' && !opp.currentMove?.isProjectile && dist < 195 && this.thinkTimer <= 0) {
        if (Math.random() < (demoMode ? 0.45 : this.cfg.guardRate)) {
          inp.guard = true;
          inp.guardJustPressed = !this.prevGuard;
          this.guardHold = 10 + Math.floor(Math.random() * 8);
          this.prevGuard = true;
          return inp;
        }
      }

      // 3. Combo follow-up when our light/heavy landed!
      if (me.state === 'attack' && me.moveHitLanded && me.currentMove?.cancelable) {
        if (Math.random() < (demoMode ? 0.55 : this.cfg.comboRate)) {
          if (me.moveKey === 'light') {
            if (me.lightChainCount < 2 && Math.random() < 0.45) {
              inp.lightPressed = true;
            } else {
              inp.heavyPressed = true;
            }
          } else if (me.moveKey === 'heavy') {
            if (me.pow >= 50 && Math.random() < this.cfg.superRate * 0.65) {
              inp.specialPressed = true;
            } else {
              inp.resbaPressed = true;
            }
          }
          this.prevGuard = false;
          return inp;
        }
      }

      this.thinkTimer = Math.max(0, this.thinkTimer - 1);
      this.intentTimer = Math.max(0, this.intentTimer - 1);

      if (this.intentTimer <= 0) {
        const r = Math.random();
        if (dist > 340) {
          this.intent = r < 0.52 ? 'approach' : r < 0.8 ? 'resba' : 'charge';
        } else if (dist > 175) {
          this.intent = r < 0.48 ? 'approach' : r < 0.72 ? 'resba' : r < 0.88 ? 'jumpIn' : 'retreat';
        } else {
          this.intent = r < this.cfg.aggression ? 'attack' : r < 0.86 ? 'retreat' : 'jumpIn';
        }
        this.intentTimer = 14 + Math.floor(Math.random() * 20);
      }

      // Execute intent
      if (this.thinkTimer <= 0) {
        // Super / EX opportunity
        if (!demoMode && me.pow >= 100 && dist < 520 && Math.random() < this.cfg.superRate * 0.14) {
          inp.specialPressed = true;
          this.thinkTimer = 28;
          this.prevGuard = false;
          return inp;
        }

        if (this.intent === 'attack' && dist < 175) {
          const r = Math.random();
          if (me.pow >= 50 && r < 0.14 && !demoMode) {
            inp.specialPressed = true;
          } else if (r < 0.52) {
            inp.lightPressed = true;
          } else if (r < 0.78) {
            inp.heavyPressed = true;
            if (Math.random() < 0.35) inp.down = true;
            else if (Math.random() < 0.35) inp.dirX = toward;
          } else {
            inp.resbaPressed = true;
          }
          this.thinkTimer = this.cfg.reactionFrames + 6;
        } else if (this.intent === 'resba' && dist > 180 && me.resbaCooldown <= 0) {
          inp.resbaPressed = true;
          this.thinkTimer = this.cfg.reactionFrames + 18;
          this.intent = 'approach';
        } else if (this.intent === 'charge' && dist > 380 && me.pow < 85 && !demoMode) {
          if (me.pow < 50) {
            inp.specialPressed = true;
            this.thinkTimer = 26;
          }
          this.intent = 'approach';
        } else if (this.intent === 'jumpIn' && me.isGrounded()) {
          inp.up = true;
          inp.dirX = toward;
          this.thinkTimer = 14;
          this.intent = 'attack';
        }
      }

      // Air attack when jumping near opponent
      if (!me.isGrounded() && me.vy > -4 && dist < 175 && me.state === 'jump') {
        if (Math.random() < 0.35) inp.heavyPressed = true;
      }

      // Movement
      if (this.intent === 'approach') {
        inp.dirX = toward;
      } else if (this.intent === 'retreat') {
        inp.dirX = -toward;
      }

      this.prevGuard = inp.guard;
      return inp;
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.FighterAI = FighterAI;
})();
