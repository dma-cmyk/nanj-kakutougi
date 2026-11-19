// なんJ格闘技大会 - Main Game Loop, Collision Engine & UI Flow Controller
(function () {
  'use strict';

  const {
    STAGE,
    FIGHTERS,
    ROSTER_ORDER,
    LOSE_BENEFITS,
    DIFFICULTY,
    MOVES,
    Fighter,
    FighterAI,
    EffectsManager,
    GameRenderer,
    OnlineManager,
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

      this.screen = 'loading'; // 'loading' | 'title' | 'select' | 'online' | 'fighting' | 'result'
      this.mode = 'vs_cpu'; // 'arcade' | 'vs_cpu' | '2p' | 'online'
      this.difficulty = 'normal';
      this.paused = false;
      this.crowdCommentsEnabled = true;

      this.p1Id = 'taro';
      this.p2Id = 'jiro';
      this.localSlot = 0; // 0 = 1P, 1 = 2P (online guest)
      this.arcadeLadder = [];
      this.arcadeStageIdx = 0;

      this.fighters = [new Fighter(0, 'taro'), new Fighter(1, 'jiro')];
      this.ai1 = new FighterAI('normal'); // For attract demo
      this.ai2 = new FighterAI('normal');

      // Online P2P multiplayer manager
      this.net = new OnlineManager();
      this._netTick = 0;
      this._netEvents = [];
      this._lastAppliedRound = 1;
      this._copyToastTimer = null;

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
      this._bindOnlineCallbacks();
      input.bindTouchControls();
      window.addEventListener('beforeunload', () => {
        this.net.disconnect(true);
      });
      this._boot();
    }

    async _boot() {
      const progressFill = document.getElementById('loading-bar-fill');
      const loadingText = document.getElementById('loading-text');

      await sprites.loadAll((p) => {
        if (progressFill) progressFill.style.width = `${Math.round(p * 100)}%`;
        if (loadingText) loadingText.textContent = `素材読み込み中... ${Math.round(p * 100)}%`;
      });

      let inviteRoom = null;
      try {
        const raw = new URLSearchParams(window.location.search).get('room');
        if (raw && raw.trim()) inviteRoom = raw.trim();
      } catch (_) {}

      this._renderRosterCards();
      this._enterTitle(!inviteRoom);

      // Auto-join online room if invite link (?room=XXXX) was opened!
      if (inviteRoom) {
        this._enterOnline(inviteRoom);
      }

      this.lastTime = performance.now();
      requestAnimationFrame((t) => this._loop(t));

      // Keep online matches ticking smoothly even if browser throttles a background tab's rAF
      setInterval(() => {
        if (this.mode === 'online' && this.screen === 'fighting' && !this.paused) {
          const now = performance.now();
          if (now - this.lastTime > 45) {
            this._stepClock(now);
          }
        }
      }, 25);
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

      $('btn-online')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this._enterOnline();
      });

      // Online lobby controls
      $('btn-online-back')?.addEventListener('click', () => {
        sound.play('select');
        this.net.disconnect(true);
        this._enterTitle();
      });

      $('btn-online-quickmatch')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.net.startQuickMatch(this.net.localFighterId);
      });

      $('btn-online-create')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        const custom = $('input-online-code')?.value || '';
        this.net.createRoom(this.net.localFighterId, custom);
      });

      const triggerJoinByCode = () => {
        sound.init();
        sound.play('confirm');
        const code = $('input-online-code')?.value || '';
        this.net.joinRoomByCode(code, this.net.localFighterId);
      };

      $('btn-online-join')?.addEventListener('click', triggerJoinByCode);
      $('input-online-code')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerJoinByCode();
        }
      });

      $('btn-online-cancel')?.addEventListener('click', () => {
        sound.play('select');
        this.net.disconnect(false);
        this._renderOnlineUI({ status: 'idle', message: '待機をキャンセルしました。別の方法を選べます。' });
      });

      $('btn-copy-invite')?.addEventListener('click', () => {
        sound.play('select');
        this._copyToClipboard(this.net.getInviteUrl(), '招待URLをコピーしました！友達に送ってください');
      });

      $('btn-copy-code')?.addEventListener('click', () => {
        sound.play('select');
        this._copyToClipboard(this.net.roomCode, `ルームID「${this.net.roomCode}」をコピーしました！`);
      });

      $('btn-online-ready')?.addEventListener('click', () => {
        sound.init();
        sound.play('confirm');
        this.net.toggleReady();
      });

      $('btn-online-leave')?.addEventListener('click', () => {
        sound.play('select');
        this.net.disconnect(true);
        this._renderOnlineUI({ status: 'idle', message: 'ルームから退出しました' });
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
        const modalOpen = !$('modal-pause')?.classList.contains('hidden');
        this.setPaused(!modalOpen);
      });

      $('btn-resume')?.addEventListener('click', () => {
        sound.play('select');
        this.setPaused(false);
      });

      $('btn-restart-match')?.addEventListener('click', () => {
        if (this.mode === 'online') return;
        sound.play('confirm');
        this.setPaused(false);
        this._startMatch();
      });

      $('btn-quit-title')?.addEventListener('click', () => {
        sound.play('select');
        this.setPaused(false);
        if (this.mode === 'online') this.net.disconnect(true);
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
        if (this.mode === 'online') {
          if (this.net.isConnected()) {
            this.net.requestRematch();
          } else {
            this._enterOnline();
          }
          return;
        }
        this._startMatch();
      });

      $('btn-result-select')?.addEventListener('click', () => {
        sound.play('select');
        if (this.mode === 'online') {
          if (this.net.isConnected()) {
            this.net.requestBackToLobby();
          } else {
            this._enterOnline();
          }
          return;
        }
        this._enterSelect();
      });

      $('btn-result-title')?.addEventListener('click', () => {
        sound.play('select');
        if (this.mode === 'online') this.net.disconnect(true);
        this._enterTitle();
      });

      // Keyboard Escape for pause
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
          const helpOpen = !$('modal-help')?.classList.contains('hidden');
          if (helpOpen) {
            this._toggleModal('modal-help', false);
          } else if (this.screen === 'fighting') {
            const modalOpen = !$('modal-pause')?.classList.contains('hidden');
            this.setPaused(!modalOpen);
          }
        }
      });
    }

    _toggleModal(id, show) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
      if (this.screen === 'fighting' && this.mode !== 'online') {
        this.paused = show;
      }
    }

    setPaused(p) {
      const isOnline = this.mode === 'online';
      this.paused = isOnline ? false : p;
      const el = document.getElementById('modal-pause');
      if (el) el.classList.toggle('hidden', !p);
      document.getElementById('pause-online-note')?.classList.toggle('hidden', !isOnline);
      document.getElementById('btn-restart-match')?.classList.toggle('hidden', isOnline);
    }

    _showOverlay(name) {
      const map = {
        loading: 'overlay-loading',
        title: 'overlay-title',
        select: 'overlay-select',
        online: 'overlay-online',
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

      const onlineGrid = document.getElementById('roster-online');
      if (onlineGrid) {
        onlineGrid.innerHTML = '';
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
            this.net.setLocalFighter(id);
          });
          onlineGrid.appendChild(card);
        }
      }

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

    _enterTitle(clearRoomParam = true) {
      this._detachNetSinks();
      this.localSlot = 0;
      this.screen = 'title';
      this.paused = false;
      this.setPaused(false);
      this._showOverlay('title');

      // Clear ?room= query param when intentionally returning to title
      if (clearRoomParam) {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('room')) {
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url.toString());
          }
        } catch (_) {}
      }

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
      this._detachNetSinks();
      this.localSlot = 0;
      this.screen = 'select';
      this.paused = false;
      this._syncRosterSelection();
      this._showOverlay('select');
    }

    _enterOnline(autoJoinCode = null) {
      this._detachNetSinks();
      this.mode = 'online';
      this.screen = 'online';
      this.paused = false;
      this.setPaused(false);
      this._showOverlay('online');

      if (autoJoinCode) {
        const inp = document.getElementById('input-online-code');
        if (inp) inp.value = autoJoinCode;
        this.net.joinRoomByCode(autoJoinCode, this.net.localFighterId);
      } else if (this.net.isConnected()) {
        this._renderOnlineUI({
          status: 'connected',
          message: this.net.isHost()
            ? '対戦相手と接続中！あなたは 1P（左側）です'
            : '対戦相手と接続中！あなたは 2P（右側）です',
          roomCode: this.net.roomCode,
          role: this.net.role,
        });
        this._renderOnlineReadyPanel();
      } else {
        this._renderOnlineUI({
          status: 'idle',
          message: '対戦方法を選んでください（サーバー登録不要・無料P2P）',
        });
      }
    }

    _bindOnlineCallbacks() {
      this.net.onStatusChange = (info) => {
        this._renderOnlineUI(info);
      };

      this.net.onLobbyUpdate = () => {
        this._renderOnlineReadyPanel();
      };

      this.net.onPingUpdate = (ms) => {
        const pill = document.getElementById('online-ping-pill');
        if (pill) {
          pill.textContent = `${ms} ms`;
          pill.classList.remove('hidden');
        }
      };

      this.net.onMatchStart = ({ p1Id, p2Id }) => {
        this._startOnlineMatch(p1Id, p2Id);
      };

      this.net.onMatchOver = (payload) => {
        if (!this.net.isHost() && this.screen === 'fighting') {
          this._applyOnlineMatchOver(payload);
        }
      };

      this.net.onRematchUpdate = () => {
        this._updateOnlineResultNote();
      };

      this.net.onBackToLobby = () => {
        this._detachNetSinks();
        this.screen = 'online';
        this.paused = false;
        this.setPaused(false);
        this._showOverlay('online');
        this._renderOnlineUI({
          status: 'connected',
          message: 'キャラクターを選択して「準備完了」を押してください',
          roomCode: this.net.roomCode,
          role: this.net.role,
        });
        this._renderOnlineReadyPanel();
        sound.startBgm('title');
      };

      this.net.onOpponentDisconnect = (reason) => {
        this._detachNetSinks();
        if (this.screen === 'fighting' || this.screen === 'result' || this.screen === 'online') {
          this.screen = 'online';
          this.paused = false;
          this.setPaused(false);
          this._showOverlay('online');
          this._renderOnlineUI({
            status: 'error',
            message: `${reason}。別の相手と再戦できます。`,
          });
          sound.startBgm('title');
        }
      };
    }

    _renderOnlineUI(info) {
      const statusBar = document.getElementById('online-status-bar');
      const statusText = document.getElementById('online-status-text');
      const pingPill = document.getElementById('online-ping-pill');
      const connectPanel = document.getElementById('online-connect-panel');
      const waitingBox = document.getElementById('online-waiting-box');
      const roomShare = document.getElementById('online-room-share');
      const codeDisplay = document.getElementById('online-room-code-display');
      const readyPanel = document.getElementById('online-ready-panel');

      const st = info?.status || this.net.status || 'idle';
      if (statusBar) {
        statusBar.className = `online-status-bar status-${st}`;
      }
      if (statusText && info?.message) {
        statusText.textContent = info.message;
      }
      if (pingPill) {
        if (st === 'connected' && typeof this.net.pingMs === 'number') {
          pingPill.textContent = `${this.net.pingMs} ms`;
          pingPill.classList.remove('hidden');
        } else {
          pingPill.classList.add('hidden');
        }
      }

      const isConnected = st === 'connected';
      const isBusy = st === 'loading' || st === 'searching' || st === 'waiting';

      if (connectPanel) connectPanel.classList.toggle('hidden', isConnected);
      if (readyPanel) readyPanel.classList.toggle('hidden', !isConnected);
      if (waitingBox) waitingBox.classList.toggle('hidden', !isBusy);

      const showShare = st === 'waiting' && !!this.net.roomCode;
      if (roomShare) roomShare.classList.toggle('hidden', !showShare);
      if (codeDisplay && showShare) codeDisplay.textContent = this.net.roomCode;

      if (isConnected) {
        this._renderOnlineReadyPanel();
      }
    }

    _renderOnlineReadyPanel() {
      const isHost = this.net.isHost();
      const p1Id = isHost ? this.net.localFighterId : this.net.remoteFighterId;
      const p2Id = isHost ? this.net.remoteFighterId : this.net.localFighterId;
      const p1Ready = isHost ? this.net.localReady : this.net.remoteReady;
      const p2Ready = isHost ? this.net.remoteReady : this.net.localReady;

      const p1Cfg = FIGHTERS[p1Id] || FIGHTERS.taro;
      const p2Cfg = FIGHTERS[p2Id] || FIGHTERS.jiro;

      const el = (id) => document.getElementById(id);
      if (el('online-p1-owner')) el('online-p1-owner').textContent = isHost ? 'YOU' : 'RIVAL';
      if (el('online-p2-owner')) el('online-p2-owner').textContent = isHost ? 'RIVAL' : 'YOU';
      if (el('online-p1-name')) el('online-p1-name').textContent = p1Cfg.nameJp;
      if (el('online-p2-name')) el('online-p2-name').textContent = p2Cfg.nameJp;

      const r1 = el('online-p1-ready');
      if (r1) {
        r1.textContent = p1Ready ? '✓ READY!!' : '選択中...';
        r1.classList.toggle('ready', p1Ready);
      }
      const r2 = el('online-p2-ready');
      if (r2) {
        r2.textContent = p2Ready ? '✓ READY!!' : '選択中...';
        r2.classList.toggle('ready', p2Ready);
      }

      document.querySelector('.slot-p1')?.classList.toggle('is-local', isHost);
      document.querySelector('.slot-p2')?.classList.toggle('is-local', !isHost);

      if (el('online-room-tag')) {
        el('online-room-tag').textContent = this.net.roomCode ? `ROOM: ${this.net.roomCode}` : 'P2P MATCH';
      }

      document.querySelectorAll('#roster-online .fighter-card').forEach((card) => {
        card.classList.toggle('selected-p1', isHost && card.dataset.fighterId === this.net.localFighterId);
        card.classList.toggle('selected-p2', !isHost && card.dataset.fighterId === this.net.localFighterId);
      });

      const readyBtn = el('btn-online-ready');
      if (readyBtn) {
        readyBtn.classList.toggle('ready-active', this.net.localReady);
        readyBtn.classList.toggle('primary', !this.net.localReady);
        const span = readyBtn.querySelector('.btn-main-txt');
        if (span) {
          span.textContent = this.net.localReady
            ? '✓ 準備完了！（相手待ち / タップで解除）'
            : '🥊 準備完了！(READY)';
        }
      }
    }

    _copyToClipboard(text, toastMsg) {
      const showToast = (msg) => {
        const toast = document.getElementById('online-copy-toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.remove('hidden');
        clearTimeout(this._copyToastTimer);
        this._copyToastTimer = setTimeout(() => {
          toast.classList.add('hidden');
        }, 2600);
      };

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(
          () => showToast(toastMsg),
          () => showToast('コピーに失敗しました。表示されたコードを長押ししてコピーしてください')
        );
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast(toastMsg);
        } catch (_) {
          showToast('表示されたコードをコピーしてください');
        }
      }
    }

    _attachHostNetSinks() {
      this._netEvents = [];
      this.fx.eventSink = (ev) => {
        this._netEvents.push(ev);
      };
      sound.playSink = (name) => {
        this._netEvents.push(['au', name]);
      };
    }

    _detachNetSinks() {
      this.fx.eventSink = null;
      sound.playSink = null;
      this._netEvents = [];
    }

    _startOnlineMatch(p1Id, p2Id) {
      this.mode = 'online';
      this.localSlot = this.net.slot;
      this.p1Id = p1Id;
      this.p2Id = p2Id;
      this.screen = 'fighting';
      this.paused = false;
      this.setPaused(false);
      this._showOverlay('fighting');
      input.resetTouch();

      this.fighters[0] = new Fighter(0, p1Id);
      this.fighters[1] = new Fighter(1, p2Id);
      this.fighters[0].score = 3450;
      this.fighters[1].score = 2870;

      this.roundNum = 1;
      this._lastAppliedRound = 1;
      this._netTick = 0;

      if (this.net.isHost()) {
        this._attachHostNetSinks();
        this._startRound();
        this._sendHostSnapshot(true);
      } else {
        this._detachNetSinks();
        this.fx.reset();
        this.fighters[0].resetForRound();
        this.fighters[1].resetForRound();
        this.roundTime = STAGE.ROUND_TIME;
        this.phase = 'intro';
      }
      sound.startBgm('battle');
    }

    _serializeFighter(f) {
      return [
        Math.round(f.x * 10) / 10,
        Math.round(f.y * 10) / 10,
        Math.round(f.vx * 100) / 100,
        Math.round(f.vy * 100) / 100,
        f.facing,
        Math.round(f.hp),
        Math.round(f.displayHp),
        Math.round(f.pow * 10) / 10,
        f.state,
        f.moveKey || '',
        f.moveFrame,
        Math.round(f.scaleX * 100) / 100,
        Math.round(f.scaleY * 100) / 100,
        f.invulnTimer,
        f.tiltTimer,
        f.comboCount,
        f.hitFlash,
        f.justGuardFlash,
        f.speechTimer > 0 ? f.speechText : '',
        f.speechTimer,
        f.speechAge,
        f.speechStyle,
        f.roundsWon,
        Math.floor(f.score),
        f.animTick,
      ];
    }

    _applyFighterSnap(f, a) {
      f.x = a[0];
      f.y = a[1];
      f.vx = a[2];
      f.vy = a[3];
      f.facing = a[4];
      f.hp = a[5];
      f.displayHp = a[6];
      f.pow = a[7];
      f.state = a[8];
      f.moveKey = a[9] || null;
      f.currentMove = f.moveKey ? MOVES[f.moveKey] || null : null;
      f.moveFrame = a[10];
      f.scaleX = a[11];
      f.scaleY = a[12];
      f.invulnTimer = a[13];
      f.tiltTimer = a[14];
      f.comboCount = a[15];
      f.hitFlash = a[16];
      f.justGuardFlash = a[17];
      f.speechText = a[18];
      f.speechTimer = a[19];
      f.speechAge = a[20];
      f.speechStyle = a[21];
      f.roundsWon = a[22];
      f.score = a[23];
      f.animTick = a[24];
    }

    _sendHostSnapshot(force = false) {
      if (this.mode !== 'online' || !this.net.isHost() || !this.net.isConnected()) return;
      this._netTick++;
      const hasEvents = this._netEvents.length > 0;
      const interval = this.net.isP2P() ? 2 : 3;
      if (!force && !hasEvents && this._netTick % interval !== 0) return;

      const snap = {
        t: this._netTick,
        ph: this.phase,
        rn: this.roundNum,
        rt: Math.round(this.roundTime * 100) / 100,
        hs: this.fx.hitstop,
        hy: Math.round(this.fx.crowdHype * 100) / 100,
        f: [this._serializeFighter(this.fighters[0]), this._serializeFighter(this.fighters[1])],
        pr: this.fx.projectiles.map((p) => [
          p.ownerSlot,
          Math.round(p.x * 10) / 10,
          Math.round(p.y * 10) / 10,
          Math.round(p.vx * 10) / 10,
          Math.round(p.vy * 10) / 10,
          p.text,
          p.isCounter ? 1 : 0,
          p.isSuper ? 1 : 0,
          p.radius,
          p.accent,
          p.kind,
        ]),
        lt: this.fx.lightningStrikes.map((l) => [l.ownerSlot, Math.round(l.x), l.warning, l.active, l.accent]),
      };
      if (hasEvents) {
        snap.ev = this._netEvents;
        this._netEvents = [];
      }
      this.net.sendSnapshot(snap);
    }

    _applyHostSnapshot(snap) {
      if (snap.rn !== this._lastAppliedRound) {
        this._lastAppliedRound = snap.rn;
        this.fx.reset();
      }
      this.roundNum = snap.rn;
      this.roundTime = snap.rt;
      this.phase = snap.ph;
      this.fx.crowdHype = snap.hy || 0;
      this.fx.hitstop = snap.hs || 0;

      if (snap.f && snap.f.length === 2) {
        this._applyFighterSnap(this.fighters[0], snap.f[0]);
        this._applyFighterSnap(this.fighters[1], snap.f[1]);
      }

      this.fx.projectiles = (snap.pr || []).map((p) => ({
        ownerSlot: p[0],
        x: p[1],
        y: p[2],
        vx: p[3],
        vy: p[4],
        text: p[5],
        isCounter: !!p[6],
        isSuper: !!p[7],
        radius: p[8],
        accent: p[9],
        kind: p[10],
        hitsLeft: 1,
        hitCooldown: 0,
        life: 60,
        maxLife: 60,
      }));

      this.fx.lightningStrikes = (snap.lt || []).map((l) => ({
        ownerSlot: l[0],
        x: l[1],
        warning: l[2],
        active: l[3],
        accent: l[4],
        damage: 0,
        hitDone: false,
      }));
    }

    _replayClientEvents(events) {
      for (const ev of events) {
        if (!Array.isArray(ev) || ev.length === 0) continue;
        const kind = ev[0];
        if (kind === 'au') {
          sound.play(ev[1]);
        } else if (kind === 'sp') {
          this.fx.spawnHitSpark(ev[1], ev[2], !!ev[3], !!ev[4], !!ev[5]);
        } else if (kind === 'du') {
          this.fx.spawnDust(ev[1], ev[2], ev[3], ev[4]);
        } else if (kind === 'gr') {
          this.fx.spawnGrassParticles(ev[1], ev[2], ev[3]);
        } else if (kind === 'pt') {
          this.fx.spawnPopText(ev[1], ev[2], ev[3], ev[4], ev[5]);
        } else if (kind === 'ai') {
          const fighter = this.fighters[ev[1]];
          if (fighter) this.fx.spawnAfterimage(fighter, ev[2]);
        } else if (kind === 'sk') {
          this.fx.shake(ev[1]);
        } else if (kind === 'fl') {
          this.fx.triggerFlash(ev[1], ev[2]);
        } else if (kind === 'gn') {
          this.fx.triggerGong();
        } else if (kind === 'bn') {
          this.fx.showBanner(ev[1], ev[2], ev[3], ev[4]);
        } else if (kind === 'sf') {
          const fighter = this.fighters[ev[1]];
          if (fighter) this.fx.triggerSuperFlash(fighter, true);
        } else if (kind === 'cc') {
          this.fx.spawnCrowdComment(ev[1]);
        }
      }
    }

    _applyOnlineMatchOver(payload) {
      if (typeof payload.p1Rounds === 'number') this.fighters[0].roundsWon = payload.p1Rounds;
      if (typeof payload.p2Rounds === 'number') this.fighters[1].roundsWon = payload.p2Rounds;
      if (typeof payload.p1Score === 'number') this.fighters[0].score = payload.p1Score;
      if (typeof payload.p2Score === 'number') this.fighters[1].score = payload.p2Score;
      this._showMatchResult();
    }

    _updateOnlineResultNote() {
      const note = document.getElementById('result-online-note');
      const rematchBtn = document.getElementById('btn-result-rematch');
      if (!note) return;

      if (this.mode !== 'online') {
        note.classList.add('hidden');
        if (rematchBtn) rematchBtn.textContent = '🔥 もう一回スレに戻る (再戦)';
        return;
      }

      note.classList.remove('hidden');
      if (!this.net.isConnected()) {
        note.textContent = '対戦相手は退出しました';
        if (rematchBtn) rematchBtn.textContent = '🌐 オンラインロビーへ';
      } else if (this.net.localRematch && !this.net.remoteRematch) {
        note.textContent = '再戦リクエスト送信済み！相手の返答を待っています...';
        if (rematchBtn) rematchBtn.textContent = '⏳ 相手の再戦待ち...';
      } else if (!this.net.localRematch && this.net.remoteRematch) {
        note.textContent = '🔥 相手が再戦を希望しています！再戦ボタンを押すとすぐ開始！';
        if (rematchBtn) rematchBtn.textContent = '🔥 再戦を受ける！(FIGHT!!)';
      } else {
        note.textContent = '両者が「再戦」を押すとすぐにもう1試合始まります！';
        if (rematchBtn) rematchBtn.textContent = '🔥 もう一回対戦 (再戦)';
      }
    }

    _startMatch(keepScore = false) {
      this._detachNetSinks();
      this.localSlot = 0;
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

    _stepClock(now) {
      const delta = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.accumulator += delta;

      while (this.accumulator >= STAGE.FIXED_DT) {
        this._fixedUpdate();
        this.accumulator -= STAGE.FIXED_DT;
      }
    }

    _loop(now) {
      this._stepClock(now);

      this.renderer.render({
        fighters: this.fighters,
        fx: this.fx,
        roundTime: this.roundTime,
        mode: this.mode,
        hideHud: this.screen === 'loading',
        crowdCommentsEnabled: this.crowdCommentsEnabled,
        localSlot: this.localSlot,
        onlinePing: this.mode === 'online' ? this.net.pingMs : null,
        onlineTransport: this.mode === 'online' ? this.net.transport : null,
      });

      this._updateMobilePowButton();
      requestAnimationFrame((t) => this._loop(t));
    }

    _updateMobilePowButton() {
      const btn = document.getElementById('btn-touch-special');
      if (!btn || this.screen !== 'fighting') return;
      const myFighter = this.fighters[this.localSlot] || this.fighters[0];
      const pow = myFighter.pow;
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

      // Live attract-mode shadow battle behind Title / Character Select / Online Lobby!
      if (this.screen === 'title' || this.screen === 'select' || this.screen === 'online') {
        this._updateAttractDemo();
        input.endFrame();
        return;
      }

      if (this.screen !== 'fighting') {
        this.fx.update();
        input.endFrame();
        return;
      }

      // Online Guest (2P): send local inputs to host & apply authoritative snapshots!
      if (this.mode === 'online' && !this.net.isHost()) {
        const myInp = input.getPlayerInput(0, false);
        this.net.sendGuestInput(myInp);

        const snap = this.net.latestSnapshot;
        if (snap) {
          this.net.latestSnapshot = null;
          this._applyHostSnapshot(snap);
        } else if (this.fx.hitstop <= 0) {
          // Smooth 1-frame interpolation between host snapshots
          for (const f of this.fighters) {
            f.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, f.x + f.vx));
            f.y = Math.min(STAGE.GROUND_Y, f.y + f.vy);
            if (!f.isGrounded()) f.vy += STAGE.GRAVITY;
            else f.vy = 0;
          }
        }

        const events = this.net.consumePendingEvents();
        if (events.length > 0) {
          this._replayClientEvents(events);
        }

        this.fx.update({ ignoreHitstop: true, clientVisualOnly: true });
        input.endFrame();
        return;
      }

      const isOnlineHost = this.mode === 'online' && this.net.isHost();

      // Update effects & handle hitstop freeze
      const frozen = this.fx.update();
      if (frozen) {
        if (isOnlineHost) this._sendHostSnapshot(false);
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
        if (isOnlineHost) this._sendHostSnapshot(false);
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
            if (isOnlineHost) {
              this._sendHostSnapshot(true);
              this.net.notifyMatchOver({
                p1Rounds: p1.roundsWon,
                p2Rounds: p2.roundsWon,
                p1Score: Math.floor(p1.score),
                p2Score: Math.floor(p2.score),
              });
            }
            this._showMatchResult();
            input.endFrame();
            return;
          } else {
            this.roundNum++;
            this._startRound();
            if (isOnlineHost) this._sendHostSnapshot(true);
            input.endFrame();
            return;
          }
        }
        if (isOnlineHost) this._sendHostSnapshot(false);
        input.endFrame();
        return;
      }

      // Active fight!
      const is2P = this.mode === '2p';
      const inp1 = input.getPlayerInput(0, is2P);
      const inp2 = isOnlineHost
        ? this.net.consumeRemoteInput()
        : is2P
          ? input.getPlayerInput(1, true)
          : this.ai2.decide(p2, p1, this.fx, false);

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
        if (isOnlineHost) this._sendHostSnapshot(true);
      } else if (isOnlineHost) {
        this._sendHostSnapshot(false);
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
      this._detachNetSinks();
      this.screen = 'result';
      this._showOverlay('result');

      const p1 = this.fighters[0];
      const p2 = this.fighters[1];
      const isOnline = this.mode === 'online';
      const mySlot = isOnline ? this.localSlot : 0;
      const myFighter = this.fighters[mySlot];
      const oppFighter = this.fighters[1 - mySlot];
      const iWon = myFighter.roundsWon >= oppFighter.roundsWon;

      const titleEl = document.getElementById('result-title');
      const subEl = document.getElementById('result-subtitle');
      const quoteEl = document.getElementById('result-quote');
      const scoreEl = document.getElementById('result-score');
      const portraitEl = document.getElementById('result-portrait');
      const loseCard = document.getElementById('result-lose-benefits');
      const nextBtn = document.getElementById('btn-result-next');

      const hasNextArcadeStage =
        this.mode === 'arcade' && iWon && this.arcadeStageIdx < this.arcadeLadder.length - 1;
      const isArcadeChampion =
        this.mode === 'arcade' && iWon && this.arcadeStageIdx >= this.arcadeLadder.length - 1;

      if (iWon) {
        sound.play('victory');
        if (titleEl) {
          titleEl.textContent = isArcadeChampion
            ? '🏆 大会優勝！！ なんJ最強！！'
            : this.mode === '2p'
              ? `🏆 1P ${p1.config.nameJp} の勝利！`
              : isOnline
                ? '🏆 ONLINE WIN!! 完全論破！'
                : '🏆 YOU WIN!! 完全論破！';
          titleEl.className = 'result-title win';
        }
        if (subEl) {
          subEl.textContent = isArcadeChampion
            ? `${myFighter.config.nameJp} が全対戦相手を論破し頂点に立った！`
            : `${myFighter.config.nameJp} が ${oppFighter.config.nameJp} を撃破！`;
        }
        if (quoteEl) quoteEl.textContent = `「${myFighter.config.winQuote}」`;
        if (portraitEl) {
          portraitEl.src = `./assets/fighters/${myFighter.config.spriteSet}/super.png`;
          portraitEl.style.filter = myFighter.config.tintFilter === 'none' ? 'none' : myFighter.config.tintFilter;
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
          subEl.textContent = `${oppFighter.config.nameJp} に完全論破されてしまった…`;
        }
        if (quoteEl) quoteEl.textContent = `「${myFighter.config.loseQuote}」`;
        if (portraitEl) {
          portraitEl.src = `./assets/fighters/${myFighter.config.spriteSet}/ko.png`;
          portraitEl.style.filter = myFighter.config.tintFilter === 'none' ? 'none' : myFighter.config.tintFilter;
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
        scoreEl.textContent = `SCORE: ${String(Math.floor(myFighter.score)).padStart(6, '0')}`;
      }
      if (nextBtn) {
        nextBtn.classList.toggle('hidden', !hasNextArcadeStage);
        if (hasNextArcadeStage) {
          const nextOpp = FIGHTERS[this.arcadeLadder[this.arcadeStageIdx + 1]];
          nextBtn.textContent = `次の対戦へ (vs ${nextOpp.nameJp}) ▶`;
        }
      }
      this._updateOnlineResultNote();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.NanJ.game = new NanJGame();
  });
})();
