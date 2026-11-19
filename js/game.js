// なんJ格闘技大会 - Main Game Loop, Collision Engine & UI Flow Controller
(function () {
  'use strict';

  const {
    STAGE,
    FIGHTERS,
    ROSTER_ORDER,
    LOSE_BENEFITS,
    DIFFICULTY,
    Fighter,
    FighterAI,
    EffectsManager,
    GameRenderer,
    sprites,
    sound,
    input,
  } = window.NanJ;

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  class NanJGame {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      this.renderer = new GameRenderer(this.canvas);
      this.fx = new EffectsManager();

      this.screen = 'loading'; // 'loading' | 'title' | 'select' | 'fighting' | 'result'
      this.mode = 'vs_cpu'; // 'arcade' | 'vs_cpu' | '2p'
      this.difficulty = 'normal';
      this.paused = false;
      this.crowdCommentsEnabled = true;

      this.p1Id = 'taro';
      this.p2Id = 'jiro';
      this.arcadeLadder = [];
      this.arcadeStageIdx = 0;

      this.fighters = [new Fighter(0, 'taro'), new Fighter(1, 'jiro')];
      this.ai1 = new FighterAI('normal'); // For attract demo
      this.ai2 = new FighterAI('normal');

      // Match flow state
      this.phase = 'intro'; // 'intro' | 'fight' | 'round_over' | 'match_over'
      this.phaseTimer = 0;
      this.roundNum = 1;
      this.roundTime = STAGE.ROUND_TIME;
      this.demoCommentTimer = 0;

      // Fixed-step loop timing
      this.lastTime = 0;
      this.accumulator = 0;

      this._bindUI();
      input.bindTouchControls();
      this._boot();
    }

    async _boot() {
      const progressFill = document.getElementById('loading-bar-fill');
      const loadingText = document.getElementById('loading-text');

      await sprites.loadAll((p) => {
        if (progressFill) progressFill.style.width = `${Math.round(p * 100)}%`;
        if (loadingText) loadingText.textContent = `素材読み込み中... ${Math.round(p * 100)}%`;
      });

      this._renderRosterCards();
      this._enterTitle();

      this.lastTime = performance.now();
      requestAnimationFrame((t) => this._loop(t));
    }

    _bindUI() {
      const $ = (id) => document.getElementById(id);

      // Quick Start (Iconic Taro vs Jiro immediately!)
      $('btn-quick-play')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.mode = 'vs_cpu';
        this.p1Id = 'taro';
        this.p2Id = 'jiro';
        this._startMatch();
      });

      $('btn-arcade')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.mode = 'arcade';
        this._enterSelect();
      });

      $('btn-vs-cpu')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.mode = 'vs_cpu';
        this._enterSelect();
      });

      $('btn-vs-2p')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.mode = '2p';
        this._enterSelect();
      });

      $('btn-select-back')?.addEventListener('click', () => {
        sound.play('select');
        this._enterTitle();
      });

      $('btn-select-start')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        if (this.mode === 'arcade') {
          this.arcadeLadder = ROSTER_ORDER.filter((id) => id !== this.p1Id);
          this.arcadeStageIdx = 0;
          this.p2Id = this.arcadeLadder[0];
        }
        this._startMatch();
      });

      // Difficulty selector buttons
      document.querySelectorAll('[data-diff]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sound.init();
          sound.play('select');
          this.difficulty = btn.getAttribute('data-diff');
          this.ai2.setDifficulty(this.difficulty);
          document.querySelectorAll('[data-diff]').forEach((b) => {
            b.classList.toggle('active', b === btn);
          });
        });
      });

      // Top utility bar buttons
      $('btn-mute')?.addEventListener('click', () => {
        sound.init();
        const muted = sound.toggleMute();
        $('btn-mute').textContent = muted ? '🔇' : '🔊';
      });

      $('btn-bgm')?.addEventListener('click', () => {
        sound.init();
        const on = sound.toggleBgm();
        $('btn-bgm').textContent = on ? '🎵ON' : '🎵OFF';
      });

      $('btn-help')?.addEventListener('click', () => {
        sound.init();
        sound.play('select');
        this._toggleModal('modal-help', true);
      });

      $('btn-help-close')?.addEventListener('click', () => {
        sound.play('select');
        this._toggleModal('modal-help', false);
      });

      $('btn-pause')?.addEventListener('click', () => {
        if (this.screen !== 'fighting') return;
        sound.play('select');
        this.setPaused(!this.paused);
      });

      $('btn-resume')?.addEventListener('click', () => {
        sound.play('select');
        this.setPaused(false);
      });

      $('btn-restart-match')?.addEventListener('click', () => {
        sound.play('confirm');
        this.setPaused(false);
        this._startMatch();
      });

      $('btn-quit-title')?.addEventListener('click', () => {
        sound.play('select');
        this.setPaused(false);
        this._enterTitle();
      });

      // Toggle virtual pad manually (helpful on tablets / desktop testing)
      $('btn-pad-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('force-touch-pad');
        sound.play('select');
      });

      // Result screen actions
      $('btn-result-next')?.addEventListener('click', () => {
        sound.play('confirm');
        this.arcadeStageIdx++;
        this.p2Id = this.arcadeLadder[this.arcadeStageIdx];
        this._startMatch(true);
      });

      $('btn-result-rematch')?.addEventListener('click', () => {
        sound.play('confirm');
        this._startMatch();
      });

      $('btn-result-select')?.addEventListener('click', () => {
        sound.play('select');
        this._enterSelect();
      });

      $('btn-result-title')?.addEventListener('click', () => {
        sound.play('select');
        this._enterTitle();
      });

      // Keyboard Escape for pause
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
          const helpOpen = !$('modal-help')?.classList.contains('hidden');
          if (helpOpen) {
            this._toggleModal('modal-help', false);
          } else if (this.screen === 'fighting') {
            this.setPaused(!this.paused);
          }
        }
      });
    }

    _toggleModal(id, show) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
      if (this.screen === 'fighting') {
        this.paused = show;
      }
    }

    setPaused(p) {
      this.paused = p;
      const el = document.getElementById('modal-pause');
      if (el) el.classList.toggle('hidden', !p);
    }

    _showOverlay(name) {
      const map = {
        loading: 'overlay-loading',
        title: 'overlay-title',
        select: 'overlay-select',
        result: 'overlay-result',
      };
      Object.values(map).forEach((id) => {
        document.getElementById(id)?.classList.add('hidden');
      });
      if (map[name]) {
        document.getElementById(map[name])?.classList.remove('hidden');
      }
      document.body.classList.toggle('in-battle', name === 'fighting');
      document.getElementById('btn-pause')?.classList.toggle('hidden', name !== 'fighting');
    }

    _renderRosterCards() {
      const p1Grid = document.getElementById('roster-p1');
      const p2Grid = document.getElementById('roster-p2');
      if (!p1Grid || !p2Grid) return;

      const buildGrid = (container, slot) => {
        container.innerHTML = '';
        for (const id of ROSTER_ORDER) {
          const cfg = FIGHTERS[id];
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'fighter-card';
          card.dataset.fighterId = id;
          card.innerHTML = `
            <div class="fighter-card-thumb">
              <img src="./assets/fighters/${cfg.spriteSet}/idle.png" alt="${cfg.nameJp}" style="filter:${cfg.tintFilter === 'none' ? 'none' : cfg.tintFilter}">
            </div>
            <div class="fighter-card-info">
              <div class="fighter-card-name">${cfg.nameJp}</div>
              <div class="fighter-card-type">${cfg.archetype}</div>
              <div class="fighter-card-super">奥義: ${cfg.superName}</div>
            </div>
          `;
          card.addEventListener('click', () => {
            sound.init();
            sound.play('select');
            if (slot === 0) this.p1Id = id;
            else this.p2Id = id;
            this._syncRosterSelection();
          });
          container.appendChild(card);
        }
      };

      buildGrid(p1Grid, 0);
      buildGrid(p2Grid, 1);
      this._syncRosterSelection();
    }

    _syncRosterSelection() {
      const p2Column = document.getElementById('select-col-p2');
      const diffRow = document.getElementById('select-diff-row');
      const modeTitle = document.getElementById('select-mode-title');

      if (modeTitle) {
        modeTitle.textContent =
          this.mode === 'arcade'
            ? '🏆 なんJ格闘技大会 (3連戦トーナメント)'
            : this.mode === '2p'
              ? '👥 2P ローカル対戦 (PCキーボード)'
              : '⚔️ CPU フリー対戦';
      }
      if (p2Column) {
        p2Column.classList.toggle('hidden', this.mode === 'arcade');
        const label = p2Column.querySelector('.select-col-label');
        if (label) label.textContent = this.mode === '2p' ? '2P ファイター' : 'CPU 対戦相手';
      }
      if (diffRow) {
        diffRow.classList.toggle('hidden', this.mode === '2p');
      }

      document.querySelectorAll('#roster-p1 .fighter-card').forEach((el) => {
        el.classList.toggle('selected-p1', el.dataset.fighterId === this.p1Id);
      });
      document.querySelectorAll('#roster-p2 .fighter-card').forEach((el) => {
        el.classList.toggle('selected-p2', el.dataset.fighterId === this.p2Id);
      });
    }

    _enterTitle() {
      this.screen = 'title';
      this.paused = false;
      this.setPaused(false);
      this._showOverlay('title');

      // Setup live attract-mode battle matching the reference screenshot!
      this.fx.reset();
      this.fighters[0] = new Fighter(0, 'taro');
      this.fighters[1] = new Fighter(1, 'jiro');
      this.fighters[0].say('効いてて草ァ！！', 120, 'normal');
      this.fighters[1].say('お前が効いてる定期', 120, 'normal');
      this.roundTime = 56;
      sound.startBgm('title');
    }

    _enterSelect() {
      this.screen = 'select';
      this.paused = false;
      this._syncRosterSelection();
      this._showOverlay('select');
    }

    _startMatch(keepScore = false) {
      this.screen = 'fighting';
      this.paused = false;
      this.setPaused(false);
      this._showOverlay('fighting');
      input.resetTouch();

      const prevScore = keepScore ? this.fighters[0].score : 3450;
      this.fighters[0] = new Fighter(0, this.p1Id);
      this.fighters[1] = new Fighter(1, this.p2Id);
      this.fighters[0].score = prevScore;
      this.fighters[1].score = 2870;

      // Scale arcade difficulty smoothly across stages!
      if (this.mode === 'arcade') {
        const diffMap = ['easy', 'normal', 'hard'];
        const baseIdx = diffMap.indexOf(this.difficulty);
        const stageDiff = diffMap[Math.min(2, Math.max(0, baseIdx + (this.arcadeStageIdx === 2 ? 1 : 0)))];
        this.ai2.setDifficulty(stageDiff);
      } else {
        this.ai2.setDifficulty(this.difficulty);
      }

      this.roundNum = 1;
      this._startRound();
      sound.startBgm('battle');
    }

    _startRound() {
      this.fx.reset();
      this.fighters[0].resetForRound();
      this.fighters[1].resetForRound();
      this.roundTime = STAGE.ROUND_TIME;
      this.phase = 'intro';
      this.phaseTimer = 92;

      const stageTag =
        this.mode === 'arcade'
          ? `第${this.arcadeStageIdx + 1}回戦 vs ${this.fighters[1].config.nameJp}`
          : `${this.fighters[0].config.nameJp} VS ${this.fighters[1].config.nameJp}`;

      this.fx.showBanner(`ROUND ${this.roundNum}`, stageTag, 56, '#ffb703');
      // Iconic opening speech bubbles right as the round begins!
      this.fighters[0].say(this.fighters[0].config.introQuote, 96, 'normal');
      this.fighters[1].say(this.fighters[1].config.introQuote, 96, 'normal');
      this.fx.spawnCrowdBurst(3, ['うおおおおお！', '始まったで！', 'リアルタイム実況中']);
    }

    _loop(now) {
      const delta = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.accumulator += delta;

      while (this.accumulator >= STAGE.FIXED_DT) {
        this._fixedUpdate();
        this.accumulator -= STAGE.FIXED_DT;
      }

      this.renderer.render({
        fighters: this.fighters,
        fx: this.fx,
        roundTime: this.roundTime,
        mode: this.mode,
        hideHud: this.screen === 'loading',
        crowdCommentsEnabled: this.crowdCommentsEnabled,
      });

      this._updateMobilePowButton();
      requestAnimationFrame((t) => this._loop(t));
    }

    _updateMobilePowButton() {
      const btn = document.getElementById('btn-touch-special');
      if (!btn || this.screen !== 'fighting') return;
      const pow = this.fighters[0].pow;
      const label = btn.querySelector('.btn-sub');
      btn.classList.toggle('super-ready', pow >= 100);
      btn.classList.toggle('ex-ready', pow >= 50 && pow < 100);
      if (label) {
        label.textContent = pow >= 100 ? '超必殺!!' : pow >= 50 ? 'EX技' : '気合';
      }
    }

    _fixedUpdate() {
      if (this.paused || this.screen === 'loading') {
        input.endFrame();
        return;
      }

      // Live attract-mode shadow battle behind Title / Character Select!
      if (this.screen === 'title' || this.screen === 'select') {
        this._updateAttractDemo();
        input.endFrame();
        return;
      }

      if (this.screen !== 'fighting') {
        this.fx.update();
        input.endFrame();
        return;
      }

      // Update effects & handle hitstop freeze
      const frozen = this.fx.update();
      if (frozen) {
        input.endFrame();
        return;
      }

      const p1 = this.fighters[0];
      const p2 = this.fighters[1];

      // Phase handling
      if (this.phase === 'intro') {
        this.phaseTimer--;
        if (this.phaseTimer === 34) {
          this.fx.showBanner('FIGHT!!', '実況スタート！', 38, '#ff5a1f');
          this.fx.triggerGong();
          sound.play('gong');
        }
        if (this.phaseTimer <= 0) {
          this.phase = 'fight';
        }
        p1.update(this.ai1.getEmptyInput(), p2, this.fx, sound, false);
        p2.update(this.ai2.getEmptyInput(), p1, this.fx, sound, false);
        input.endFrame();
        return;
      }

      if (this.phase === 'round_over') {
        this.phaseTimer--;
        p1.update(this.ai1.getEmptyInput(), p2, this.fx, sound, false);
        p2.update(this.ai2.getEmptyInput(), p1, this.fx, sound, false);
        this._separateFighters(p1, p2);
        if (this.phaseTimer <= 0) {
          if (p1.roundsWon >= STAGE.ROUNDS_TO_WIN || p2.roundsWon >= STAGE.ROUNDS_TO_WIN) {
            this._showMatchResult();
          } else {
            this.roundNum++;
            this._startRound();
          }
        }
        input.endFrame();
        return;
      }

      // Active fight!
      const is2P = this.mode === '2p';
      const inp1 = input.getPlayerInput(0, is2P);
      const inp2 = is2P ? input.getPlayerInput(1, true) : this.ai2.decide(p2, p1, this.fx, false);

      p1.update(inp1, p2, this.fx, sound, true);
      p2.update(inp2, p1, this.fx, sound, true);

      this._separateFighters(p1, p2);
      this._resolveCombat(p1, p2);

      // Ambient live commentary trickle
      this.demoCommentTimer++;
      if (this.demoCommentTimer >= 165) {
        this.demoCommentTimer = 0;
        this.fx.spawnCrowdComment();
      }

      // Round timer
      this.roundTime = Math.max(0, this.roundTime - STAGE.FIXED_DT);

      // Check KO or Time Up!
      if (p1.hp <= 0 || p2.hp <= 0 || this.roundTime <= 0) {
        this._finishRound();
      }

      input.endFrame();
    }

    _updateAttractDemo() {
      const frozen = this.fx.update();
      if (frozen) return;

      const p1 = this.fighters[0];
      const p2 = this.fighters[1];

      // Keep fighters healthy in infinite attract demo!
      if (p1.hp < p1.maxHp * 0.35) p1.hp = p1.maxHp * 0.85;
      if (p2.hp < p2.maxHp * 0.35) p2.hp = p2.maxHp * 0.85;

      const inp1 = this.ai1.decide(p1, p2, this.fx, true);
      const inp2 = this.ai2.decide(p2, p1, this.fx, true);
      p1.update(inp1, p2, this.fx, sound, true);
      p2.update(inp2, p1, this.fx, sound, true);
      this._separateFighters(p1, p2);
      this._resolveCombat(p1, p2);

      this.demoCommentTimer++;
      if (this.demoCommentTimer >= 140) {
        this.demoCommentTimer = 0;
        this.fx.spawnCrowdComment();
      }
    }

    _separateFighters(p1, p2) {
      if (p1.state === 'ko' || p2.state === 'ko') return;
      const minSep = 104;
      const dx = p2.x - p1.x;
      const dy = Math.abs(p2.y - p1.y);
      if (Math.abs(dx) < minSep && dy < 150) {
        const push = (minSep - Math.abs(dx)) * 0.5;
        const dir = dx >= 0 ? 1 : -1;
        p1.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, p1.x - dir * push));
        p2.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, p2.x + dir * push));
      }
    }

    _resolveCombat(p1, p2) {
      const list = [
        [p1, p2],
        [p2, p1],
      ];

      // 1. Melee hitbox checks
      for (const [atk, def] of list) {
        const hb = atk.getActiveHitbox();
        if (!hb) continue;
        const hurt = def.getHurtbox();
        if (rectsOverlap(hb, hurt)) {
          const m = atk.currentMove;
          const ono = m.onomatopoeia
            ? m.onomatopoeia[Math.floor(Math.random() * m.onomatopoeia.length)]
            : null;
          const hit = def.receiveHit(
            {
              damage: m.damage,
              chip: m.chip,
              hitstun: m.hitstun,
              blockstun: m.blockstun,
              pushX: m.pushX,
              pushY: m.pushY,
              powGain: m.powGain,
              hitstop: m.hitstop,
              knockdown: m.knockdown,
              heavy: atk.moveKey !== 'light' && atk.moveKey !== 'airLight',
              isSuper: atk.moveKey === 'superMove',
              sfx: m.sfx,
              onomatopoeia: ono,
              hitX: hb.x + hb.w / 2,
              hitY: hb.y + hb.h / 2,
            },
            atk,
            this.fx,
            sound
          );
          if (hit) {
            atk.moveHitLanded = true;
          }
        }
      }

      // 2. Projectile vs Projectile CLASH (レスバ相殺!)
      for (let i = 0; i < this.fx.projectiles.length; i++) {
        const a = this.fx.projectiles[i];
        if (a.hitsLeft <= 0) continue;
        for (let j = i + 1; j < this.fx.projectiles.length; j++) {
          const b = this.fx.projectiles[j];
          if (b.hitsLeft <= 0 || a.ownerSlot === b.ownerSlot) continue;
          if (Math.abs(a.x - b.x) < a.radius + b.radius && Math.abs(a.y - b.y) < 75) {
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            this.fx.spawnHitSpark(cx, cy, true, false, false);
            this.fx.spawnGrassParticles(cx, cy, 6);
            this.fx.spawnPopText(cx, cy - 34, 'レスバ相殺!!', '#fde047', 30);
            sound.play('clash');
            const aPow = (a.isSuper ? 3 : a.isCounter ? 2 : 1);
            const bPow = (b.isSuper ? 3 : b.isCounter ? 2 : 1);
            if (aPow <= bPow) a.hitsLeft = 0;
            if (bPow <= aPow) b.hitsLeft = 0;
          }
        }
      }

      // 3. Projectile vs Fighter
      for (const pr of this.fx.projectiles) {
        if (pr.hitsLeft <= 0 || pr.hitCooldown > 0) continue;
        const atk = this.fighters[pr.ownerSlot];
        const def = this.fighters[1 - pr.ownerSlot];
        const hurt = def.getHurtbox();
        const pb = {
          x: pr.x - pr.radius,
          y: pr.y - pr.radius * 0.72,
          w: pr.radius * 2,
          h: pr.radius * 1.44,
        };
        if (rectsOverlap(pb, hurt)) {
          const hit = def.receiveHit(
            {
              damage: pr.damage,
              chip: pr.chip,
              hitstun: pr.isSuper ? 24 : 20,
              blockstun: 13,
              pushX: pr.isSuper ? 12 : pr.isCounter ? 13 : 9,
              pushY: pr.isCounter || pr.isSuper ? -7 : -3,
              powGain: pr.isSuper ? 0 : 9,
              hitstop: pr.isSuper ? 8 : pr.isCounter ? 9 : 5,
              knockdown: pr.isCounter || pr.isSuper,
              heavy: pr.isCounter || pr.isSuper,
              isSuper: pr.isSuper,
              isProjectile: true,
              inflictsTilt: pr.inflictsTilt,
              sfx: pr.isCounter || pr.isSuper ? 'heavy' : 'light',
              onomatopoeia: pr.isCounter ? '論破ァ!!' : pr.isSuper ? '草ァァ!!' : '効いてる!!',
              hitX: pr.x,
              hitY: pr.y,
            },
            atk,
            this.fx,
            sound
          );
          if (hit) {
            pr.hitsLeft--;
            pr.hitCooldown = 8;
          }
        }
      }

      // 4. Midnight J-Min Lightning Strikes
      for (const l of this.fx.lightningStrikes) {
        if (l.warning > 0 || l.hitDone) continue;
        const atk = this.fighters[l.ownerSlot];
        const def = this.fighters[1 - l.ownerSlot];
        if (Math.abs(def.x - l.x) < 88) {
          l.hitDone = true;
          def.receiveHit(
            {
              damage: l.damage,
              chip: 20,
              hitstun: 26,
              blockstun: 14,
              pushX: 8,
              pushY: -11,
              powGain: 0,
              hitstop: 7,
              knockdown: true,
              heavy: true,
              isSuper: true,
              isProjectile: true,
              inflictsTilt: true,
              sfx: 'heavy',
              onomatopoeia: '鯖落ち!!',
              hitX: l.x,
              hitY: def.y - 120,
            },
            atk,
            this.fx,
            sound
          );
        }
      }
    }

    _finishRound() {
      this.phase = 'round_over';
      this.phaseTimer = 115;

      const p1 = this.fighters[0];
      const p2 = this.fighters[1];
      const isTimeUp = this.roundTime <= 0 && p1.hp > 0 && p2.hp > 0;

      if (isTimeUp) {
        sound.play('gong');
        this.fx.triggerGong();
      }

      const r1 = p1.hp / p1.maxHp;
      const r2 = p2.hp / p2.maxHp;

      if (Math.abs(r1 - r2) < 0.0001) {
        this.fx.showBanner('DRAW', '引き分け！ 両者とも効いてない判定', 95, '#94a3b8');
      } else if (r1 > r2) {
        p1.roundsWon++;
        p1.state = 'victory';
        p1.score += 1000 + Math.floor(this.roundTime) * 20;
        p1.say(p1.config.introQuote, 110, 'counter');
        this.fx.showBanner(
          isTimeUp ? 'TIME UP!' : 'K.O.!!',
          `${p1.config.nameJp} の勝利！`,
          98,
          '#facc15'
        );
      } else {
        p2.roundsWon++;
        p2.state = 'victory';
        p2.score += 1000 + Math.floor(this.roundTime) * 20;
        p2.say(p2.config.introQuote, 110, 'counter');
        this.fx.showBanner(
          isTimeUp ? 'TIME UP!' : 'K.O.!!',
          `${p2.config.nameJp} の勝利！`,
          98,
          '#ff6b1a'
        );
      }
    }

    _showMatchResult() {
      this.screen = 'result';
      this._showOverlay('result');

      const p1 = this.fighters[0];
      const p2 = this.fighters[1];
      const p1Won = p1.roundsWon >= p2.roundsWon;

      const titleEl = document.getElementById('result-title');
      const subEl = document.getElementById('result-subtitle');
      const quoteEl = document.getElementById('result-quote');
      const scoreEl = document.getElementById('result-score');
      const portraitEl = document.getElementById('result-portrait');
      const loseCard = document.getElementById('result-lose-benefits');
      const nextBtn = document.getElementById('btn-result-next');

      const hasNextArcadeStage =
        this.mode === 'arcade' && p1Won && this.arcadeStageIdx < this.arcadeLadder.length - 1;
      const isArcadeChampion =
        this.mode === 'arcade' && p1Won && this.arcadeStageIdx >= this.arcadeLadder.length - 1;

      if (p1Won) {
        sound.play('victory');
        if (titleEl) {
          titleEl.textContent = isArcadeChampion
            ? '🏆 大会優勝！！ なんJ最強！！'
            : this.mode === '2p'
              ? `🏆 1P ${p1.config.nameJp} の勝利！`
              : '🏆 YOU WIN!! 完全論破！';
          titleEl.className = 'result-title win';
        }
        if (subEl) {
          subEl.textContent = isArcadeChampion
            ? `${p1.config.nameJp} が全対戦相手を論破し頂点に立った！`
            : `${p1.config.nameJp} が ${p2.config.nameJp} を撃破！`;
        }
        if (quoteEl) quoteEl.textContent = `「${p1.config.winQuote}」`;
        if (portraitEl) {
          portraitEl.src = `./assets/fighters/${p1.config.spriteSet}/super.png`;
          portraitEl.style.filter = p1.config.tintFilter === 'none' ? 'none' : p1.config.tintFilter;
        }
        if (loseCard) loseCard.classList.add('hidden');
      } else {
        sound.play('defeat');
        if (titleEl) {
          titleEl.textContent =
            this.mode === '2p'
              ? `🏆 2P ${p2.config.nameJp} の勝利！`
              : '💀 YOU LOSE… 効いてて草';
          titleEl.className = 'result-title lose';
        }
        if (subEl) {
          subEl.textContent = `${p2.config.nameJp} に完全論破されてしまった…`;
        }
        if (quoteEl) quoteEl.textContent = `「${p1.config.loseQuote}」`;
        if (portraitEl) {
          portraitEl.src = `./assets/fighters/${p1.config.spriteSet}/ko.png`;
          portraitEl.style.filter = p1.config.tintFilter === 'none' ? 'none' : p1.config.tintFilter;
        }
        // Show the hilarious signboard rewards from the reference image!
        if (loseCard) {
          loseCard.classList.remove('hidden');
          const list = loseCard.querySelector('.benefits-list');
          if (list) {
            list.innerHTML = LOSE_BENEFITS.map(
              (b) => `<li><span>${b.icon}</span><div><strong>${b.title}</strong><small>${b.desc}</small></div></li>`
            ).join('');
          }
        }
      }

      if (scoreEl) {
        scoreEl.textContent = `SCORE: ${String(Math.floor(p1.score)).padStart(6, '0')}`;
      }
      if (nextBtn) {
        nextBtn.classList.toggle('hidden', !hasNextArcadeStage);
        if (hasNextArcadeStage) {
          const nextOpp = FIGHTERS[this.arcadeLadder[this.arcadeStageIdx + 1]];
          nextBtn.textContent = `次の対戦へ (vs ${nextOpp.nameJp}) ▶`;
        }
      }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.NanJ.game = new NanJGame();
  });
})();
