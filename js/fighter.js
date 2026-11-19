// なんJ格闘技大会 - Fighter State Machine, Physics & Combat Mechanics
(function () {
  'use strict';

  const { STAGE, FIGHTERS, MOVES } = window.NanJ;

  function vibrate(ms) {
    try {
      if (
        navigator &&
        typeof navigator.vibrate === 'function' &&
        navigator.userActivation &&
        navigator.userActivation.hasBeenActive &&
        window.NanJ &&
        window.NanJ.game &&
        window.NanJ.game.screen === 'fighting'
      ) {
        navigator.vibrate(ms);
      }
    } catch (_) {}
  }

  class Fighter {
    constructor(slot, fighterId) {
      this.slot = slot; // 0 = 1P (left), 1 = 2P (right)
      this.setFighter(fighterId);
      this.score = slot === 0 ? 3450 : 2870; // Classic reference-image arcade initial scores!
      this.roundsWon = 0;
      this.resetForRound();
    }

    setFighter(fighterId) {
      this.config = FIGHTERS[fighterId] || FIGHTERS.taro;
      this.id = this.config.id;
    }

    resetForRound() {
      this.x = this.slot === 0 ? 370 : 910;
      this.y = STAGE.GROUND_Y;
      this.vx = 0;
      this.vy = 0;
      this.facing = this.slot === 0 ? 1 : -1;

      this.maxHp = this.config.maxHp;
      this.hp = this.maxHp;
      this.displayHp = this.maxHp; // Smooth delayed damage trail
      this.pow = 25; // Start with a bit of hype!

      // State machine:
      // 'idle' | 'walk' | 'dash' | 'backstep' | 'jump' | 'guard' |
      // 'attack' | 'hitstun' | 'knockdown' | 'wakeup' | 'ko' | 'victory'
      this.state = 'idle';
      this.stateTimer = 0;
      this.animTick = 0;

      // Active attack info
      this.currentMove = null;
      this.moveKey = null;
      this.moveFrame = 0;
      this.moveHitLanded = false;
      this.moveProjectileFired = false;
      this.superStage = 0;

      // Status & combat counters
      this.guardPressAge = 99; // For Just Guard detection
      this.invulnTimer = 0;
      this.tiltTimer = 0; // "効いてる" status!
      this.comboCount = 0;
      this.comboTimer = 0;
      this.hitFlash = 0;
      this.justGuardFlash = 0;
      this.lightChainCount = 0;
      this.resbaCooldown = 0;

      // Double-tap dash tracking
      this.lastDirTap = 0;
      this.lastDirTapTimer = 0;
      this.prevDirX = 0;

      // Input buffer
      this.bufferedAction = null;
      this.bufferTimer = 0;

      // Speech bubble
      this.speechText = '';
      this.speechTimer = 0;
      this.speechAge = 0;
      this.speechStyle = 'normal'; // 'normal' | 'counter' | 'super' | 'tilt'

      // Squash & stretch spring
      this.scaleX = 1.0;
      this.scaleY = 1.0;
    }

    isGrounded() {
      return this.y >= STAGE.GROUND_Y - 0.5;
    }

    say(text, duration = 78, style = 'normal') {
      this.speechText = text;
      this.speechTimer = duration;
      this.speechAge = 0;
      this.speechStyle = style;
    }

    pickLine(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    gainPow(amount) {
      this.pow = Math.min(100, this.pow + amount * this.config.powGainMult);
    }

    getCurrentPose() {
      switch (this.state) {
        case 'ko':
          return 'ko';
        case 'knockdown':
          return this.isGrounded() ? 'ko' : 'hurt';
        case 'victory':
          return 'super';
        case 'hitstun':
          return 'hurt';
        case 'guard':
          return 'guard';
        case 'jump':
          return 'jump';
        case 'attack':
          if (this.currentMove && this.currentMove.pose) return this.currentMove.pose;
          return 'punch';
        case 'dash':
          return 'walk';
        case 'backstep':
          return 'jump';
        case 'walk':
          return Math.floor(this.animTick / 8) % 2 === 0 ? 'walk' : 'idle';
        default:
          return 'idle';
      }
    }

    getHurtbox() {
      const crouching = this.state === 'guard' && this.isGrounded();
      const h = crouching ? 185 : 220;
      const w = 104;
      return {
        x: this.x - w / 2,
        y: this.y - h,
        w,
        h,
      };
    }

    getActiveHitbox() {
      if (this.state !== 'attack' || !this.currentMove || this.currentMove.isProjectile || this.moveHitLanded) {
        return null;
      }
      const m = this.currentMove;
      if (this.moveFrame < m.startup || this.moveFrame >= m.startup + m.active) {
        return null;
      }
      if (!m.hitW) return null;
      const centerX = this.x + this.facing * (m.rangeX * 0.58);
      return {
        x: centerX - m.hitW / 2,
        y: this.y + m.hitY - m.hitH / 2,
        w: m.hitW,
        h: m.hitH,
      };
    }

    canAct() {
      return this.state === 'idle' || this.state === 'walk' || this.state === 'guard';
    }

    canCancelAttack(nextAction) {
      if (this.state !== 'attack' || !this.currentMove || !this.moveHitLanded) return false;
      if (!this.currentMove.cancelable) return false;
      if (this.moveKey === 'light') {
        if (nextAction === 'light' && this.lightChainCount < 2) return true;
        return nextAction === 'heavy' || nextAction === 'resba' || nextAction === 'special';
      }
      if (this.moveKey === 'heavy') {
        return nextAction === 'resba' || nextAction === 'special';
      }
      return false;
    }

    startAttack(moveKey, input, opponent, fx, sound) {
      const m = MOVES[moveKey];
      if (!m) return false;

      if (m.powCost && this.pow < m.powCost) return false;

      // Check Resba Counter window BEFORE firing normal Resba!
      if (moveKey === 'resba' && this.tryResbaCounter(opponent, fx, sound)) {
        return true;
      }

      if (m.powCost) this.pow = Math.max(0, this.pow - m.powCost);

      this.state = 'attack';
      this.stateTimer = 0;
      this.moveKey = moveKey;
      this.currentMove = m;
      this.moveFrame = 0;
      this.moveHitLanded = false;
      this.moveProjectileFired = false;
      this.superStage = 0;

      if (moveKey === 'light') {
        this.lightChainCount++;
      } else {
        this.lightChainCount = 0;
      }

      if (m.lungeX) {
        this.vx = this.facing * m.lungeX;
      }

      // Squash/stretch anticipation
      this.scaleX = 1.12;
      this.scaleY = 0.92;

      if (moveKey === 'superMove') {
        this.invulnTimer = 36;
        fx.triggerSuperFlash(this);
        sound.play('super');
        this.say(this.config.superName, 110, 'super');
        fx.spawnCrowdBurst(4, ['うおおおおおお！！', '奥義きたあああ！', '草ァァァ！！', '神試合定期']);
        vibrate(45);
      } else if (moveKey === 'exSpecial') {
        sound.play('ex');
        this.say(this.config.exName, 85, 'counter');
        fx.spawnDust(this.x, this.y, this.facing, 8);
        vibrate(25);
      } else if (moveKey === 'charge') {
        sound.play('charge');
        this.say(this.pickLine(this.config.chargeLines), 65, 'normal');
      } else if (moveKey === 'resba') {
        this.resbaCooldown = 26;
        sound.play('resba');
        this.say(this.pickLine(this.config.resbaLines), 78, 'normal');
      } else {
        sound.play('whiff');
      }
      return true;
    }

    tryResbaCounter(opponent, fx, sound) {
      // 1. Check if an enemy projectile is approaching within counter range!
      let targetProjIdx = -1;
      for (let i = 0; i < fx.projectiles.length; i++) {
        const pr = fx.projectiles[i];
        if (pr.ownerSlot !== this.slot && !pr.isSuper) {
          const dist = Math.abs(pr.x - this.x);
          const headingTowardMe = (pr.vx > 0 && pr.x <= this.x + 40) || (pr.vx < 0 && pr.x >= this.x - 40);
          if (dist < 250 && headingTowardMe) {
            targetProjIdx = i;
            break;
          }
        }
      }

      // 2. Or check if opponent is mid-Resba / Taunt!
      const oppTaunting =
        opponent.state === 'attack' &&
        (opponent.moveKey === 'resba' || opponent.moveKey === 'charge') &&
        Math.abs(opponent.x - this.x) < 640;

      if (targetProjIdx === -1 && !oppTaunting) return false;

      if (targetProjIdx !== -1) {
        const pr = fx.projectiles[targetProjIdx];
        fx.spawnHitSpark(pr.x, pr.y, true, false, true);
        fx.projectiles.splice(targetProjIdx, 1);
      }

      // Execute glorious RESBA COUNTER!
      this.state = 'attack';
      this.moveKey = 'resba';
      this.currentMove = { ...MOVES.resba, startup: 4, active: 6, recovery: 12 };
      this.moveFrame = 4;
      this.moveProjectileFired = true;
      this.resbaCooldown = 18;
      this.invulnTimer = 14;
      this.gainPow(24);
      this.score += 350;

      const line = this.pickLine(this.config.counterLines);
      this.say(line, 95, 'counter');

      fx.spawnProjectile({
        ownerSlot: this.slot,
        x: this.x + this.facing * 92,
        y: this.y - 155,
        vx: this.facing * 17.5,
        text: line,
        damage: Math.round(135 * this.config.resbaMult),
        chip: 24,
        isCounter: true,
        radius: 48,
        accent: '#facc15',
        life: 95,
      });

      fx.triggerHitstop(9);
      fx.shake(10);
      fx.triggerFlash('#fde047', 0.35);
      fx.spawnPopText(this.x, this.y - 250, 'レスバ返し!!', '#fde047', 38);
      fx.spawnGrassParticles(this.x + this.facing * 70, this.y - 160, 10);
      fx.spawnCrowdBurst(4, ['お前が効いてる定期', 'カウンターうますぎて草', 'はい論破ァ！！', '88888888']);
      sound.play('counter');
      vibrate(35);
      return true;
    }

    update(input, opponent, fx, sound, canControl) {
      this.animTick++;
      this.stateTimer++;
      if (this.invulnTimer > 0) this.invulnTimer--;
      if (this.tiltTimer > 0) this.tiltTimer--;
      if (this.hitFlash > 0) this.hitFlash--;
      if (this.justGuardFlash > 0) this.justGuardFlash--;
      if (this.resbaCooldown > 0) this.resbaCooldown--;
      if (this.speechTimer > 0) {
        this.speechTimer--;
        this.speechAge++;
      }
      if (this.lastDirTapTimer > 0) this.lastDirTapTimer--;
      if (this.bufferTimer > 0) {
        this.bufferTimer--;
        if (this.bufferTimer <= 0) this.bufferedAction = null;
      }

      // Smooth HP drain trail
      if (this.displayHp > this.hp) {
        this.displayHp = Math.max(this.hp, this.displayHp - Math.max(2.5, (this.displayHp - this.hp) * 0.1));
      } else {
        this.displayHp = this.hp;
      }

      // Combo decay when opponent leaves hitstun
      if (this.comboTimer > 0) {
        this.comboTimer--;
        if (this.comboTimer === 0) this.comboCount = 0;
      }

      // Squash & stretch recovery
      this.scaleX += (1.0 - this.scaleX) * 0.22;
      this.scaleY += (1.0 - this.scaleY) * 0.22;

      // Track guard freshness for Just Guard
      if (input.guardJustPressed || (input.dirX === -this.facing && this.prevDirX !== -this.facing)) {
        this.guardPressAge = 0;
      } else {
        this.guardPressAge = Math.min(99, this.guardPressAge + 1);
      }

      // Queue button inputs into 8-frame input buffer
      if (canControl) {
        if (input.specialPressed) {
          this.bufferedAction = 'special';
          this.bufferTimer = 8;
        } else if (input.resbaPressed) {
          this.bufferedAction = 'resba';
          this.bufferTimer = 8;
        } else if (input.heavyPressed) {
          this.bufferedAction = 'heavy';
          this.bufferTimer = 8;
        } else if (input.lightPressed) {
          this.bufferedAction = 'light';
          this.bufferTimer = 8;
        }
      }

      // Face opponent automatically when grounded & neutral
      if (this.isGrounded() && (this.state === 'idle' || this.state === 'walk' || this.state === 'guard')) {
        if (opponent.x > this.x + 6) this.facing = 1;
        else if (opponent.x < this.x - 6) this.facing = -1;
      }

      // Double-tap dash detection
      if (canControl && this.isGrounded() && this.canAct()) {
        if (input.dirX !== 0 && this.prevDirX === 0) {
          if (this.lastDirTap === input.dirX && this.lastDirTapTimer > 0) {
            const forward = input.dirX === this.facing;
            this.state = forward ? 'dash' : 'backstep';
            this.stateTimer = 0;
            this.vx = input.dirX * (forward ? this.config.dashSpeed : this.config.dashSpeed * 0.92);
            if (!forward) {
              this.invulnTimer = 8;
              this.vy = -4.5;
            }
            this.scaleX = 1.15;
            this.scaleY = 0.88;
            fx.spawnDust(this.x, this.y, input.dirX, 6);
            sound.play('dash');
            this.lastDirTap = 0;
            this.lastDirTapTimer = 0;
          } else {
            this.lastDirTap = input.dirX;
            this.lastDirTapTimer = 14;
          }
        }
      }
      this.prevDirX = input.dirX;

      // Consume buffered action if able to act or cancel
      if (canControl && this.bufferedAction) {
        const act = this.bufferedAction;
        const canStartNow = this.canAct() || (this.state === 'jump' && (act === 'light' || act === 'heavy'));
        const canCancelNow = this.canCancelAttack(act);

        if (canStartNow || canCancelNow) {
          const started = this.dispatchAction(act, input, opponent, fx, sound);
          if (started) {
            this.bufferedAction = null;
            this.bufferTimer = 0;
          }
        }
      }

      // State updates
      switch (this.state) {
        case 'idle':
        case 'walk':
        case 'guard': {
          this.lightChainCount = 0;
          if (!canControl) {
            this.state = 'idle';
            this.vx *= 0.72;
            break;
          }

          // Jump
          if (input.up && this.isGrounded()) {
            this.state = 'jump';
            this.stateTimer = 0;
            this.vy = this.config.jumpVel;
            this.vx = input.dirX * this.config.walkSpeed * 1.18;
            this.scaleX = 0.86;
            this.scaleY = 1.18;
            fx.spawnDust(this.x, this.y, 0, 5);
            sound.play('jump');
            break;
          }

          // Dedicated Guard button (or Hold Back when opponent is threatening!)
          const holdingBack = input.dirX === -this.facing;
          const threatClose =
            (opponent.state === 'attack' && Math.abs(opponent.x - this.x) < 340) ||
            fx.projectiles.some((p) => p.ownerSlot !== this.slot && Math.abs(p.x - this.x) < 280);

          if (input.guard || (holdingBack && threatClose)) {
            this.state = 'guard';
            this.vx *= 0.65;
          } else if (input.dirX !== 0) {
            this.state = 'walk';
            const speed = input.dirX === this.facing ? this.config.walkSpeed : this.config.walkSpeed * 0.82;
            this.vx = input.dirX * speed;
          } else {
            this.state = 'idle';
            this.vx *= 0.7;
          }
          break;
        }

        case 'dash': {
          if (this.stateTimer % 3 === 0) fx.spawnAfterimage(this, 'rgba(255, 196, 70, 0.35)');
          if (this.stateTimer >= 12) {
            this.state = 'idle';
            this.vx *= 0.5;
          }
          break;
        }

        case 'backstep': {
          if (this.stateTimer % 3 === 0) fx.spawnAfterimage(this, 'rgba(120, 210, 255, 0.35)');
          if (this.stateTimer >= 14 && this.isGrounded()) {
            this.state = 'idle';
            this.vx *= 0.4;
          }
          break;
        }

        case 'jump': {
          // Slight air control for great mobile playability!
          if (canControl && input.dirX !== 0) {
            this.vx += input.dirX * 0.22;
            this.vx = Math.max(-8.5, Math.min(8.5, this.vx));
          }
          break;
        }

        case 'attack': {
          this.updateAttack(opponent, fx, sound);
          break;
        }

        case 'hitstun': {
          this.vx *= this.isGrounded() ? 0.84 : 0.98;
          this.stateTimer--;
          if (this.stateTimer <= 0 && this.isGrounded()) {
            this.state = 'idle';
          }
          break;
        }

        case 'knockdown': {
          this.vx *= this.isGrounded() ? 0.78 : 0.985;
          if (this.isGrounded()) {
            this.stateTimer--;
            if (this.stateTimer <= 0) {
              this.state = 'wakeup';
              this.stateTimer = 10;
              this.invulnTimer = 18;
              this.scaleX = 1.15;
              this.scaleY = 0.85;
            }
          }
          break;
        }

        case 'wakeup': {
          this.vx *= 0.7;
          this.stateTimer--;
          if (this.stateTimer <= 0) {
            this.state = 'idle';
          }
          break;
        }

        case 'ko': {
          this.vx *= this.isGrounded() ? 0.82 : 0.985;
          break;
        }

        case 'victory': {
          this.vx *= 0.75;
          if (this.stateTimer % 36 === 0 && this.isGrounded()) {
            this.scaleX = 0.92;
            this.scaleY = 1.1;
          }
          break;
        }
      }

      // Physics integration
      const wasAir = !this.isGrounded();
      this.x += this.vx;
      this.y += this.vy;

      if (!this.isGrounded()) {
        this.vy += STAGE.GRAVITY;
      }

      if (this.y >= STAGE.GROUND_Y) {
        this.y = STAGE.GROUND_Y;
        if (wasAir && this.vy > 3) {
          this.scaleX = 1.16;
          this.scaleY = 0.84;
          fx.spawnDust(this.x, this.y, 0, 5);
          if (this.state === 'jump' || (this.state === 'attack' && (this.moveKey === 'airLight' || this.moveKey === 'airHeavy'))) {
            this.state = 'idle';
            this.currentMove = null;
            this.vx *= 0.4;
          } else if (this.state === 'knockdown' || this.state === 'ko') {
            fx.shake(6);
            sound.play('light');
          }
        }
        this.vy = 0;
      }

      // Clamp to stage walls
      this.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, this.x));
    }

    dispatchAction(action, input, opponent, fx, sound) {
      if (!this.isGrounded()) {
        if (action === 'light') return this.startAttack('airLight', input, opponent, fx, sound);
        if (action === 'heavy') return this.startAttack('airHeavy', input, opponent, fx, sound);
        return false;
      }

      if (action === 'light') {
        return this.startAttack('light', input, opponent, fx, sound);
      }
      if (action === 'heavy') {
        if (input.down) return this.startAttack('sweep', input, opponent, fx, sound);
        if (input.dirX === this.facing) return this.startAttack('dashHeavy', input, opponent, fx, sound);
        return this.startAttack('heavy', input, opponent, fx, sound);
      }
      if (action === 'resba') {
        if (this.resbaCooldown > 0) return false;
        return this.startAttack('resba', input, opponent, fx, sound);
      }
      if (action === 'special') {
        if (this.pow >= 100) return this.startAttack('superMove', input, opponent, fx, sound);
        if (this.pow >= 50) return this.startAttack('exSpecial', input, opponent, fx, sound);
        return this.startAttack('charge', input, opponent, fx, sound);
      }
      return false;
    }

    updateAttack(opponent, fx, sound) {
      const m = this.currentMove;
      if (!m) {
        this.state = 'idle';
        return;
      }

      this.moveFrame++;

      if (this.isGrounded()) {
        if (this.moveKey === 'exSpecial' && this.moveFrame >= m.startup && this.moveFrame < m.startup + m.active) {
          this.vx = this.facing * 12.5;
          if (this.moveFrame % 2 === 0) fx.spawnAfterimage(this, 'rgba(255, 165, 30, 0.55)');
        } else {
          this.vx *= 0.82;
        }
      }

      // Projectile launch for Resba
      if (this.moveKey === 'resba' && !this.moveProjectileFired && this.moveFrame >= m.startup) {
        this.moveProjectileFired = true;
        fx.spawnProjectile({
          ownerSlot: this.slot,
          x: this.x + this.facing * 92,
          y: this.y - 155,
          vx: this.facing * m.projectileSpeed,
          text: this.speechText || this.pickLine(this.config.resbaLines),
          damage: Math.round(m.damage * this.config.resbaMult),
          chip: m.chip,
          accent: this.config.bubbleAccent,
          life: 105,
        });
      }

      // Charge POW completion
      if (this.moveKey === 'charge' && this.moveFrame === m.startup + 6) {
        this.gainPow(m.powGain);
        fx.spawnPopText(this.x, this.y - 230, 'POW UP!', '#ffd166', 26);
        fx.spawnGrassParticles(this.x, this.y - 160, 4);
      }

      // Character-specific ULTIMATE SUPERS!
      if (this.moveKey === 'superMove') {
        if (this.moveFrame % 2 === 0) {
          fx.spawnAfterimage(this, 'rgba(255, 220, 60, 0.65)');
        }
        if (this.id === 'taro') {
          // Giant speech-bubble cannon barrage!
          if (this.moveFrame === 12 || this.moveFrame === 18 || this.moveFrame === 24) {
            const lines = ['効いてて草ァ！！！', '顔真っ赤で草ァ！！', 'はい完全論破ァ！！'];
            const idx = this.superStage++;
            fx.spawnProjectile({
              ownerSlot: this.slot,
              x: this.x + this.facing * 95,
              y: this.y - 145 + (idx - 1) * 26,
              vx: this.facing * 18,
              text: lines[idx % lines.length],
              damage: Math.round(92 * this.config.resbaMult),
              chip: 16,
              isSuper: true,
              radius: 58,
              accent: '#f59e0b',
              life: 90,
            });
            fx.shake(8);
            sound.play('resba');
          }
        } else if (this.id === 'jiro') {
          // Surging armored combo + sky uppercut!
          if (this.moveFrame >= 10 && this.moveFrame <= 26) {
            this.vx = this.facing * 15.5;
            if (this.moveFrame === 12 || this.moveFrame === 18 || this.moveFrame === 24) {
              this.moveHitLanded = false;
              this.currentMove = {
                ...m,
                rangeX: 165,
                hitY: -140,
                hitW: 150,
                hitH: 130,
                damage: this.moveFrame === 24 ? 125 : 70,
                pushX: this.moveFrame === 24 ? 18 : 7,
                pushY: this.moveFrame === 24 ? -16 : -2,
                knockdown: this.moveFrame === 24,
                hitstop: this.moveFrame === 24 ? 13 : 5,
              };
            }
          }
        } else if (this.id === 'yakiu') {
          // 33-4 Flaming Meteor Waves!
          if (this.moveFrame === 12 || this.moveFrame === 19 || this.moveFrame === 26) {
            const idx = this.superStage++;
            const labels = ['33-4!!', 'なんでや!!', '猛虎魂!!'];
            fx.spawnProjectile({
              ownerSlot: this.slot,
              x: this.x + this.facing * 85,
              y: this.y - 230 + idx * 15,
              vx: this.facing * (14 + idx * 2),
              vy: 2.2,
              text: labels[idx % labels.length],
              damage: 96,
              chip: 18,
              isSuper: true,
              kind: 'meteor',
              radius: 54,
              accent: '#facc15',
              life: 95,
            });
            fx.shake(9);
            sound.play('heavy');
          }
        } else {
          // Midnight J-Min: 3 Sky-splitting Thread-Crash Lightning Strikes!
          if (this.moveFrame === 10 || this.moveFrame === 18 || this.moveFrame === 26) {
            const idx = this.superStage++;
            const targetX = Math.max(
              STAGE.LEFT + 40,
              Math.min(STAGE.RIGHT - 40, opponent.x + (idx - 1) * 110)
            );
            fx.spawnLightning(this.slot, targetX, 95, '#60a5fa');
            fx.shake(8);
            sound.play('ex');
          }
        }
      }

      const totalFrames = m.startup + m.active + m.recovery;
      if (this.moveFrame >= totalFrames) {
        this.state = this.isGrounded() ? 'idle' : 'jump';
        this.currentMove = null;
        this.moveKey = null;
      }
    }

    receiveHit(opts, attacker, fx, sound) {
      if (this.state === 'ko' || this.invulnTimer > 0) return false;

      // Determine guard
      const isBlocking =
        this.state === 'guard' &&
        this.isGrounded() &&
        !opts.unblockable;

      // Armor check (EX Special absorbs 1 non-super hit!)
      const hasArmor =
        this.state === 'attack' &&
        this.currentMove &&
        this.currentMove.armor &&
        !opts.isSuper;

      const hitX = (this.x + (opts.hitX || attacker.x)) * 0.5;
      const hitY = opts.hitY || this.y - 135;

      if (isBlocking) {
        const isJustGuard = this.guardPressAge <= 7;
        if (isJustGuard) {
          this.justGuardFlash = 16;
          this.gainPow(14);
          this.score += 200;
          this.say(this.pickLine(this.config.justGuardLines), 65, 'counter');
          fx.spawnHitSpark(hitX, hitY, false, true, true);
          fx.spawnPopText(this.x, this.y - 235, 'JUST GUARD!!', '#38bdf8', 30);
          fx.triggerHitstop(7);
          sound.play('justGuard');
          // Push attacker back!
          if (attacker && !opts.isProjectile) {
            attacker.vx = -attacker.facing * 12;
          }
          vibrate(15);
          return true;
        }

        // Normal guard
        const chip = Math.max(0, opts.chip || 0);
        this.hp = Math.max(1, this.hp - chip); // Guard chip never KOs unless super
        if (opts.isSuper && chip > 0) {
          this.hp = Math.max(0, this.hp - chip);
        }
        this.gainPow(5);
        this.vx = -this.facing * (opts.pushX || 6) * 0.65;
        this.stateTimer = opts.blockstun || 10;
        fx.spawnHitSpark(hitX, hitY, false, true, false);
        fx.triggerHitstop(Math.max(3, Math.floor((opts.hitstop || 5) * 0.65)));
        sound.play('block');
        if (attacker && !opts.isProjectile && (this.x <= STAGE.LEFT + 18 || this.x >= STAGE.RIGHT - 18)) {
          attacker.vx = -attacker.facing * (opts.pushX || 7) * 0.85;
        }
        vibrate(10);
        return true;
      }

      // Compute final damage with combo scaling, attacker multiplier, and Tilt ("効いてる") modifier!
      const comboScale = Math.max(0.45, Math.pow(0.86, attacker ? attacker.comboCount : 0));
      const tiltTakenMult = this.tiltTimer > 0 ? 1.25 : 1.0;
      const tiltDealMult = attacker && attacker.tiltTimer > 0 ? 1.15 : 1.0;
      const atkMult = attacker ? attacker.config.atkMult : 1.0;
      let dmg = Math.round(opts.damage * atkMult * tiltDealMult * tiltTakenMult * comboScale);

      if (hasArmor) {
        dmg = Math.round(dmg * 0.5);
        this.hp = Math.max(1, this.hp - dmg);
        this.hitFlash = 8;
        fx.spawnHitSpark(hitX, hitY, false, false, false);
        fx.spawnPopText(this.x, this.y - 220, 'スーパーアーマー!', '#fbbf24', 24);
        sound.play('block');
        return true;
      }

      this.hp = Math.max(0, this.hp - dmg);
      this.hitFlash = 10;
      this.gainPow(Math.min(14, dmg * 0.09));

      if (attacker) {
        attacker.comboCount++;
        attacker.comboTimer = 46;
        attacker.gainPow(opts.powGain || 8);
        attacker.score += dmg * 4 + attacker.comboCount * 50;
      }

      // Inflict "効いてる" Tilt status on Resba hit!
      if (opts.inflictsTilt) {
        this.tiltTimer = 270;
        this.say(this.pickLine(this.config.hurtLines), 75, 'tilt');
        fx.spawnGrassParticles(hitX, hitY, 7);
        fx.spawnPopText(this.x, this.y - 240, '効いてる!!', '#ff4d4d', 30);
      } else if (Math.random() < 0.35 || opts.heavy) {
        this.say(this.pickLine(this.config.hurtLines), 52, 'normal');
      }

      const knockDir = attacker ? (this.x >= attacker.x ? 1 : -1) : -this.facing;
      this.vx = knockDir * (opts.pushX || 8);
      if (opts.pushY) this.vy = opts.pushY;

      // Corner pushback on attacker
      if (attacker && !opts.isProjectile && (this.x <= STAGE.LEFT + 20 || this.x >= STAGE.RIGHT - 20)) {
        attacker.vx = -knockDir * (opts.pushX || 8) * 0.85;
      }

      this.scaleX = 0.84;
      this.scaleY = 1.16;

      // KO check!
      if (this.hp <= 0) {
        this.state = 'ko';
        this.vx = knockDir * 13.5;
        this.vy = -12.5;
        this.say('ぐえー…時間節約や…', 150, 'tilt');
        fx.spawnHitSpark(hitX, hitY, true, false, false);
        fx.spawnPopText(hitX, hitY - 40, 'K.O.!!', '#ff4d4d', 52);
        fx.triggerHitstop(18);
        fx.shake(18);
        fx.triggerFlash('#ffffff', 0.72);
        fx.triggerGong();
        fx.spawnCrowdBurst(6, ['うおおおおおお！！', 'K.O.きたー！！', '33-4不可避', '名勝負で草', '88888888']);
        sound.play('ko');
        sound.play('crowd');
        vibrate([60, 40, 90]);
        return true;
      }

      if (opts.knockdown) {
        this.state = 'knockdown';
        this.stateTimer = 30;
        if (this.vy >= 0) this.vy = -8.5;
      } else {
        this.state = 'hitstun';
        this.stateTimer = opts.hitstun || 16;
      }

      this.currentMove = null;
      this.moveKey = null;

      fx.spawnHitSpark(hitX, hitY, !!opts.heavy || !!opts.isSuper, false, false);
      if (opts.onomatopoeia) {
        fx.spawnPopText(
          hitX + (Math.random() - 0.5) * 30,
          hitY - 25,
          opts.onomatopoeia,
          opts.isSuper ? '#fde047' : opts.heavy ? '#ff7b00' : '#fff3b0',
          opts.isSuper ? 44 : opts.heavy ? 36 : 26
        );
      }
      fx.triggerHitstop(opts.hitstop || 5);
      fx.shake(opts.isSuper ? 14 : opts.heavy ? 9 : 4);
      sound.play(opts.sfx || 'light');
      vibrate(opts.isSuper ? 40 : opts.heavy ? 24 : 12);

      if (attacker && attacker.comboCount >= 3) {
        fx.spawnCrowdBurst(2);
      }
      return true;
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.Fighter = Fighter;
})();
