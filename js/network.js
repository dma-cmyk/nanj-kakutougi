// なんJ格闘技大会 - Serverless Online Multiplayer (MQTT over WSS + Auto WebRTC P2P Upgrade)
(function () {
  'use strict';

  const MQTT_ESM_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.16.1/+esm';
  const BROKER_URLS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];
  const TOPIC_PREFIX = 'nanj-kakutougi-arena-v1';
  const QUICKMATCH_TOPIC = `${TOPIC_PREFIX}/qm`;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  };

  function randomId(len = 12) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function generateRoomCode(len = 6) {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
  }

  function normalizeRoomCode(raw) {
    const trimmed = String(raw || '').trim().slice(0, 32);
    if (!trimmed) return '';
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    return trimmed;
  }

  class OnlineManager {
    constructor() {
      this._mqttLib = null;
      this._client = null;
      this._brokerUrl = null;
      this._activeTopic = null;

      // Optional WebRTC P2P direct upgrade channel
      this._pc = null;
      this._dc = null;
      this.transport = 'relay'; // 'relay' | 'p2p'

      this.status = 'idle'; // 'idle' | 'loading' | 'searching' | 'waiting' | 'connected' | 'error'
      this.roomCode = '';
      this.preferHost = false;
      this.role = null; // 'host' (1P) | 'guest' (2P)
      this.slot = 0; // 0 = 1P, 1 = 2P

      this.selfPeerId = `nj_${randomId(10)}`;
      this.opponentPeerId = null;
      this.pingMs = null;

      this._helloTimer = null;
      this._pingTimer = null;
      this._heartbeatTimer = null;
      this._qmSeekTimer = null;
      this._qmOfferTimer = null;
      this._lastRemoteActivity = 0;
      this._connectSeq = 0;
      this._qmMatched = false;
      this._qmPendingOffer = null;

      // Lobby shared state
      this.localFighterId = 'taro';
      this.remoteFighterId = 'jiro';
      this.localReady = false;
      this.remoteReady = false;
      this.localRematch = false;
      this.remoteRematch = false;

      // Guest -> Host cumulative input counters (prevents dropped 1-frame button presses)
      this._outCounters = { g: 0, l: 0, h: 0, r: 0, s: 0 };
      this._inCounters = { g: 0, l: 0, h: 0, r: 0, s: 0 };
      this._remoteInput = this._makeEmptyInput();
      this._pendingRemotePresses = {
        guardJustPressed: false,
        lightPressed: false,
        heavyPressed: false,
        resbaPressed: false,
        specialPressed: false,
      };
      this._lastSentInputSig = '';
      this._inputSendTick = 0;

      // Host -> Guest snapshot buffer
      this.latestSnapshot = null;
      this.pendingEvents = [];
      this._lastSnapTick = -1;

      // Callbacks wired by NanJGame
      this.onStatusChange = null;
      this.onLobbyUpdate = null;
      this.onMatchStart = null;
      this.onMatchOver = null;
      this.onRematchUpdate = null;
      this.onBackToLobby = null;
      this.onOpponentDisconnect = null;
      this.onPingUpdate = null;
    }

    _makeEmptyInput() {
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

    isConnected() {
      return this.status === 'connected' && !!this.opponentPeerId && !!this._client;
    }

    isHost() {
      return this.role === 'host';
    }

    isP2P() {
      return this.transport === 'p2p' && !!this._dc && this._dc.readyState === 'open';
    }

    getInviteUrl() {
      if (!this.roomCode) return '';
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', this.roomCode);
        return url.toString();
      } catch (_) {
        return `?room=${encodeURIComponent(this.roomCode)}`;
      }
    }

    _setStatus(status, message = '') {
      this.status = status;
      if (this.onStatusChange) {
        this.onStatusChange({ status, message, roomCode: this.roomCode, role: this.role, transport: this.transport });
      }
    }

    async _loadMqtt() {
      if (this._mqttLib) return this._mqttLib;
      const mod = await import(MQTT_ESM_URL);
      this._mqttLib = mod.default || mod;
      return this._mqttLib;
    }

    async _connectBroker(seq) {
      const mqtt = await this._loadMqtt();
      let lastErr = null;
      for (const url of BROKER_URLS) {
        if (seq !== this._connectSeq) return null;
        try {
          const client = await new Promise((resolve, reject) => {
            const c = mqtt.connect(url, {
              clientId: `${this.selfPeerId}_${Math.floor(Math.random() * 9999)}`,
              clean: true,
              connectTimeout: 4500,
              keepalive: 25,
              reconnectPeriod: 2500,
            });
            const timer = setTimeout(() => {
              try { c.end(true); } catch (_) {}
              reject(new Error('Broker connect timeout'));
            }, 5000);
            const onConnect = () => {
              clearTimeout(timer);
              c.off('error', onErr);
              resolve(c);
            };
            const onErr = (err) => {
              clearTimeout(timer);
              try { c.end(true); } catch (_) {}
              reject(err || new Error('Broker error'));
            };
            c.once('connect', onConnect);
            c.once('error', onErr);
          });
          if (seq !== this._connectSeq) {
            try { client.end(true); } catch (_) {}
            return null;
          }
          this._brokerUrl = url;
          return client;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('All brokers unreachable');
    }

    _subscribeTopic(client, topic) {
      return new Promise((resolve, reject) => {
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    _publish(channel, data, targetPeerId = null, allowP2P = false) {
      const envelope = { f: this.selfPeerId, ch: channel, d: data };
      if (targetPeerId) envelope.to = targetPeerId;
      const raw = JSON.stringify(envelope);

      if (allowP2P && this.isP2P() && (!targetPeerId || targetPeerId === this.opponentPeerId)) {
        try {
          if (this._dc.bufferedAmount < 65536) {
            this._dc.send(raw);
            return;
          }
        } catch (_) {}
      }

      if (this._client && this._client.connected && this._activeTopic) {
        try {
          this._client.publish(this._activeTopic, raw, { qos: 0 });
        } catch (_) {}
      }
    }

    resetMatchSyncState() {
      this._outCounters = { g: 0, l: 0, h: 0, r: 0, s: 0 };
      this._inCounters = { g: 0, l: 0, h: 0, r: 0, s: 0 };
      this._remoteInput = this._makeEmptyInput();
      this._pendingRemotePresses = {
        guardJustPressed: false,
        lightPressed: false,
        heavyPressed: false,
        resbaPressed: false,
        specialPressed: false,
      };
      this._lastSentInputSig = '';
      this._inputSendTick = 0;
      this.latestSnapshot = null;
      this.pendingEvents = [];
      this._lastSnapTick = -1;
      this.localRematch = false;
      this.remoteRematch = false;
    }

    async createRoom(fighterId = 'taro', customCode = '') {
      const code = normalizeRoomCode(customCode) || generateRoomCode(6);
      return this.connectRoom(code, { preferHost: true, fighterId });
    }

    async joinRoomByCode(codeRaw, fighterId = 'jiro') {
      const code = normalizeRoomCode(codeRaw);
      if (!code) {
        this._setStatus('error', '合言葉（ルームID）を入力してください');
        return false;
      }
      return this.connectRoom(code, { preferHost: false, fighterId });
    }

    async connectRoom(code, { preferHost = false, fighterId = 'taro', statusText = '' } = {}) {
      await this.disconnect(false);
      const seq = ++this._connectSeq;
      this.selfPeerId = `nj_${randomId(10)}`;

      this.roomCode = code;
      this.preferHost = preferHost;
      this.localFighterId = fighterId;
      this.remoteFighterId = fighterId === 'taro' ? 'jiro' : 'taro';
      this.localReady = false;
      this.remoteReady = false;
      this.role = null;
      this.slot = preferHost ? 0 : 1;
      this.opponentPeerId = null;
      this.pingMs = null;
      this.transport = 'relay';
      this.resetMatchSyncState();

      this._setStatus('loading', 'オンラインサーバーへ接続中...');

      let client;
      try {
        client = await this._connectBroker(seq);
      } catch (err) {
        if (seq !== this._connectSeq) return false;
        this._setStatus('error', 'オンラインサーバーへ接続できませんでした（ネットワークを確認してください）');
        return false;
      }
      if (!client || seq !== this._connectSeq) return false;

      const topic = `${TOPIC_PREFIX}/r/${encodeURIComponent(code)}`;
      this._client = client;
      this._activeTopic = topic;

      client.on('message', (msgTopic, payload) => {
        if (seq !== this._connectSeq || msgTopic !== topic) return;
        this._handleRawMessage(payload);
      });

      try {
        await this._subscribeTopic(client, topic);
      } catch (err) {
        if (seq !== this._connectSeq) return false;
        this._setStatus('error', 'ルームへの参加に失敗しました。再試行してください。');
        return false;
      }
      if (seq !== this._connectSeq) return false;

      const sendHello = (targetPeerId = null) => {
        this._publish(
          'lobby',
          {
            t: 'hello',
            ph: this.preferHost,
            f: this.localFighterId,
            r: this.localReady,
          },
          targetPeerId,
          false
        );
      };

      // Announce presence immediately and periodically while waiting for opponent
      sendHello();
      this._helloTimer = setInterval(() => {
        if (seq !== this._connectSeq || this.status !== 'waiting') {
          clearInterval(this._helloTimer);
          this._helloTimer = null;
          return;
        }
        sendHello();
      }, 1500);

      this._setStatus(
        'waiting',
        statusText ||
          (preferHost
            ? `ルーム「${code}」を作成しました！相手の参加を待っています...`
            : `ルーム「${code}」へ接続中... 相手を探しています...`)
      );
      return true;
    }

    async startQuickMatch(fighterId = 'taro') {
      await this.disconnect(false);
      const seq = ++this._connectSeq;
      this.selfPeerId = `nj_${randomId(10)}`;

      this.roomCode = '';
      this.localFighterId = fighterId;
      this._qmMatched = false;
      this._qmPendingOffer = null;
      this._setStatus('loading', 'マッチングロビーへ接続中...');

      let client;
      try {
        client = await this._connectBroker(seq);
      } catch (err) {
        if (seq !== this._connectSeq) return false;
        this._setStatus('error', 'マッチングロビーへ接続できませんでした（ネットワークを確認してください）');
        return false;
      }
      if (!client || seq !== this._connectSeq) return false;

      this._client = client;
      this._activeTopic = QUICKMATCH_TOPIC;

      const tryOffer = (peerId) => {
        if (seq !== this._connectSeq || this._qmMatched || this._qmPendingOffer) return;
        if (this.selfPeerId < peerId) {
          const matchCode = `QM${generateRoomCode(5)}`;
          this._qmPendingOffer = { peerId, code: matchCode };
          this._publish('qm', { t: 'offer', code: matchCode }, peerId, false);
          clearTimeout(this._qmOfferTimer);
          this._qmOfferTimer = setTimeout(() => {
            if (seq === this._connectSeq && !this._qmMatched && this._qmPendingOffer?.peerId === peerId) {
              this._qmPendingOffer = null;
            }
          }, 2600);
        }
      };

      client.on('message', (msgTopic, payload) => {
        if (seq !== this._connectSeq || msgTopic !== QUICKMATCH_TOPIC) return;
        let env;
        try {
          env = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
        } catch (_) {
          return;
        }
        if (!env || env.f === this.selfPeerId) return;
        if (env.to && env.to !== this.selfPeerId) return;
        if (env.ch !== 'qm' || !env.d) return;

        const msg = env.d;
        const peerId = env.f;

        if (msg.t === 'seek') {
          tryOffer(peerId);
        } else if (msg.t === 'offer' && msg.code) {
          if (this._qmMatched) {
            this._publish('qm', { t: 'busy' }, peerId, false);
            return;
          }
          this._qmMatched = true;
          clearTimeout(this._qmOfferTimer);
          clearInterval(this._qmSeekTimer);
          this._publish('qm', { t: 'accept', code: msg.code }, peerId, false);
          setTimeout(() => {
            if (seq !== this._connectSeq) return;
            this.connectRoom(msg.code, {
              preferHost: false,
              fighterId: this.localFighterId,
              statusText: '対戦相手を発見！対戦ルームへ移動中...',
            });
          }, 150);
        } else if (msg.t === 'accept' && msg.code) {
          if (this._qmMatched) return;
          if (this._qmPendingOffer && this._qmPendingOffer.code === msg.code && this._qmPendingOffer.peerId === peerId) {
            this._qmMatched = true;
            clearTimeout(this._qmOfferTimer);
            clearInterval(this._qmSeekTimer);
            this.connectRoom(msg.code, {
              preferHost: true,
              fighterId: this.localFighterId,
              statusText: '対戦相手を発見！対戦ルームへ移動中...',
            });
          }
        } else if (msg.t === 'busy') {
          if (this._qmPendingOffer?.peerId === peerId) {
            this._qmPendingOffer = null;
            clearTimeout(this._qmOfferTimer);
          }
        }
      });

      try {
        await this._subscribeTopic(client, QUICKMATCH_TOPIC);
      } catch (err) {
        if (seq !== this._connectSeq) return false;
        this._setStatus('error', 'マッチングロビーへの参加に失敗しました');
        return false;
      }
      if (seq !== this._connectSeq) return false;

      const broadcastSeek = () => {
        if (seq !== this._connectSeq || this._qmMatched) return;
        this._publish('qm', { t: 'seek' }, null, false);
      };
      broadcastSeek();
      this._qmSeekTimer = setInterval(broadcastSeek, 1200);

      this._setStatus('searching', 'ランダム対戦の相手を探しています...（別端末や別タブでも対戦できます）');
      return true;
    }

    _handleRawMessage(payload) {
      let env;
      try {
        env = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
      } catch (_) {
        return;
      }
      if (!env || env.f === this.selfPeerId) return;
      if (env.to && env.to !== this.selfPeerId) return;

      const peerId = env.f;
      const ch = env.ch;
      const msg = env.d;
      if (!ch || msg === undefined) return;

      if (ch === 'lobby') {
        this._handleLobbyMessage(msg, peerId);
      } else if (ch === 'inp') {
        if (peerId !== this.opponentPeerId) return;
        this._lastRemoteActivity = performance.now();
        this._ingestRemoteInput(msg);
      } else if (ch === 'snap') {
        if (peerId !== this.opponentPeerId) return;
        this._lastRemoteActivity = performance.now();
        if (typeof msg.t === 'number' && msg.t <= this._lastSnapTick) return;
        this._lastSnapTick = msg.t;
        this.latestSnapshot = msg;
        if (Array.isArray(msg.ev) && msg.ev.length > 0) {
          for (const ev of msg.ev) this.pendingEvents.push(ev);
        }
      } else if (ch === 'ping') {
        if (peerId !== this.opponentPeerId) return;
        this._lastRemoteActivity = performance.now();
        this._publish('pong', msg, peerId, true);
      } else if (ch === 'pong') {
        if (peerId !== this.opponentPeerId) return;
        this._lastRemoteActivity = performance.now();
        if (typeof msg === 'number') {
          const rtt = Math.max(1, Math.round(performance.now() - msg));
          this.pingMs = rtt;
          if (this.onPingUpdate) this.onPingUpdate(rtt);
        }
      } else if (ch === 'rtc') {
        if (peerId !== this.opponentPeerId) return;
        this._handleRtcSignal(msg, peerId);
      }
    }

    _handleLobbyMessage(msg, peerId) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'full') {
        this._setStatus('error', 'このルームは満員（2名対戦中）です。別の合言葉をお試しください。');
        this.disconnect(false);
        return;
      }

      if (this.opponentPeerId && this.opponentPeerId !== peerId) {
        if (msg.t === 'hello') {
          this._publish('lobby', { t: 'full' }, peerId, false);
        }
        return;
      }

      this._lastRemoteActivity = performance.now();

      if (msg.t === 'hello') {
        const wasConnected = this.status === 'connected';
        this.opponentPeerId = peerId;
        clearInterval(this._helloTimer);
        this._helloTimer = null;

        let amHost;
        if (this.preferHost !== !!msg.ph) {
          amHost = !!this.preferHost;
        } else {
          amHost = this.selfPeerId < peerId;
        }

        this.role = amHost ? 'host' : 'guest';
        this.slot = amHost ? 0 : 1;
        if (msg.f) this.remoteFighterId = msg.f;
        this.remoteReady = !!msg.r;

        if (!wasConnected) {
          // Acknowledge hello directly to opponent so both complete handshake immediately
          this._publish(
            'lobby',
            {
              t: 'hello',
              ph: this.preferHost,
              f: this.localFighterId,
              r: this.localReady,
            },
            peerId,
            false
          );
          this._startPingLoop(this._connectSeq);
          this._setStatus(
            'connected',
            amHost
              ? '対戦相手と接続完了！あなたは 1P（左側）です'
              : '対戦相手と接続完了！あなたは 2P（右側）です'
          );
          // Silently try upgrading to direct WebRTC P2P for ultra-low latency
          if (amHost) {
            this._initiateWebRTCUpgrade(peerId);
          }
        }
        if (this.onLobbyUpdate) this.onLobbyUpdate();
        this._checkBothReadyAndStart();
      } else if (msg.t === 'pick') {
        if (msg.f) this.remoteFighterId = msg.f;
        if (typeof msg.r === 'boolean') this.remoteReady = msg.r;
        if (this.onLobbyUpdate) this.onLobbyUpdate();
        this._checkBothReadyAndStart();
      } else if (msg.t === 'start') {
        this.localReady = false;
        this.remoteReady = false;
        this.resetMatchSyncState();
        if (this.onMatchStart) {
          this.onMatchStart({ p1Id: msg.p1, p2Id: msg.p2 });
        }
      } else if (msg.t === 'over') {
        if (this.onMatchOver) this.onMatchOver(msg);
      } else if (msg.t === 'rematch') {
        this.remoteRematch = !!msg.v;
        if (this.onRematchUpdate) this.onRematchUpdate();
        if (this.isHost() && this.localRematch && this.remoteRematch) {
          this.startOnlineMatch();
        }
      } else if (msg.t === 'lobby_back') {
        this.localReady = false;
        this.remoteReady = false;
        this.localRematch = false;
        this.remoteRematch = false;
        if (this.onBackToLobby) this.onBackToLobby();
      } else if (msg.t === 'bye') {
        this._handleDisconnect('対戦相手がルームから退出しました');
      }
    }

    // Best-effort silent WebRTC DataChannel upgrade; falls back seamlessly to MQTT WSS if NAT blocks UDP
    async _initiateWebRTCUpgrade(peerId) {
      if (typeof RTCPeerConnection !== 'function') return;
      try {
        this._closeWebRTC();
        const pc = new RTCPeerConnection(RTC_CONFIG);
        this._pc = pc;
        const dc = pc.createDataChannel('nanj-game', { ordered: true });
        this._attachDataChannel(dc);
        pc.onicecandidate = (e) => {
          if (e.candidate && this.opponentPeerId === peerId) {
            this._publish('rtc', { k: 'ice', c: e.candidate }, peerId, false);
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._publish('rtc', { k: 'offer', sdp: offer }, peerId, false);
      } catch (_) {}
    }

    async _handleRtcSignal(msg, peerId) {
      if (typeof RTCPeerConnection !== 'function' || !msg) return;
      try {
        if (msg.k === 'offer' && msg.sdp) {
          this._closeWebRTC();
          const pc = new RTCPeerConnection(RTC_CONFIG);
          this._pc = pc;
          pc.ondatachannel = (e) => {
            if (e.channel) this._attachDataChannel(e.channel);
          };
          pc.onicecandidate = (e) => {
            if (e.candidate && this.opponentPeerId === peerId) {
              this._publish('rtc', { k: 'ice', c: e.candidate }, peerId, false);
            }
          };
          await pc.setRemoteDescription(msg.sdp);
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          this._publish('rtc', { k: 'answer', sdp: ans }, peerId, false);
        } else if (msg.k === 'answer' && msg.sdp && this._pc) {
          await this._pc.setRemoteDescription(msg.sdp);
        } else if (msg.k === 'ice' && msg.c && this._pc) {
          await this._pc.addIceCandidate(msg.c);
        }
      } catch (_) {}
    }

    _attachDataChannel(dc) {
      this._dc = dc;
      dc.onopen = () => {
        this.transport = 'p2p';
      };
      dc.onclose = () => {
        if (this._dc === dc) {
          this._dc = null;
          this.transport = 'relay';
        }
      };
      dc.onerror = () => {
        if (this._dc === dc) this.transport = 'relay';
      };
      dc.onmessage = (e) => {
        this._handleRawMessage(e.data);
      };
    }

    _closeWebRTC() {
      try { if (this._dc) this._dc.close(); } catch (_) {}
      try { if (this._pc) this._pc.close(); } catch (_) {}
      this._dc = null;
      this._pc = null;
      this.transport = 'relay';
    }

    _startPingLoop(seq) {
      clearInterval(this._pingTimer);
      clearInterval(this._heartbeatTimer);
      const sendPing = () => {
        if (seq !== this._connectSeq || !this.isConnected()) return;
        this._publish('ping', performance.now(), this.opponentPeerId, true);
      };
      sendPing();
      this._pingTimer = setInterval(sendPing, 2200);
      this._heartbeatTimer = setInterval(() => {
        if (seq !== this._connectSeq || !this.isConnected()) return;
        if (this._lastRemoteActivity > 0 && performance.now() - this._lastRemoteActivity > 13000) {
          this._handleDisconnect('通信がタイムアウトしました');
        }
      }, 3000);
    }

    _handleDisconnect(reason) {
      const wasConnected = this.status === 'connected';
      this.opponentPeerId = null;
      this.pingMs = null;
      this.localReady = false;
      this.remoteReady = false;
      clearInterval(this._pingTimer);
      clearInterval(this._heartbeatTimer);
      this._closeWebRTC();
      if (wasConnected && this.onOpponentDisconnect) {
        this.onOpponentDisconnect(reason);
      }
    }

    setLocalFighter(fighterId) {
      this.localFighterId = fighterId;
      this.localReady = false;
      if (this.isConnected()) {
        this._publish('lobby', { t: 'pick', f: fighterId, r: false }, this.opponentPeerId, false);
      }
      if (this.onLobbyUpdate) this.onLobbyUpdate();
    }

    toggleReady() {
      if (!this.isConnected()) return;
      this.localReady = !this.localReady;
      this._publish('lobby', { t: 'pick', f: this.localFighterId, r: this.localReady }, this.opponentPeerId, false);
      if (this.onLobbyUpdate) this.onLobbyUpdate();
      this._checkBothReadyAndStart();
    }

    _checkBothReadyAndStart() {
      if (this.isConnected() && this.isHost() && this.localReady && this.remoteReady) {
        this.startOnlineMatch();
      }
    }

    startOnlineMatch() {
      if (!this.isConnected() || !this.isHost()) return;
      const p1Id = this.localFighterId;
      const p2Id = this.remoteFighterId;
      this.localReady = false;
      this.remoteReady = false;
      this.resetMatchSyncState();
      this._publish('lobby', { t: 'start', p1: p1Id, p2: p2Id }, this.opponentPeerId, false);
      if (this.onMatchStart) {
        this.onMatchStart({ p1Id, p2Id });
      }
    }

    notifyMatchOver(payload) {
      if (!this.isConnected() || !this.isHost()) return;
      this._publish('lobby', { t: 'over', ...payload }, this.opponentPeerId, false);
    }

    requestRematch() {
      if (!this.isConnected()) return;
      this.localRematch = true;
      this._publish('lobby', { t: 'rematch', v: true }, this.opponentPeerId, false);
      if (this.onRematchUpdate) this.onRematchUpdate();
      if (this.isHost() && this.localRematch && this.remoteRematch) {
        this.startOnlineMatch();
      }
    }

    requestBackToLobby() {
      if (!this.isConnected()) return;
      this.localReady = false;
      this.remoteReady = false;
      this.localRematch = false;
      this.remoteRematch = false;
      this._publish('lobby', { t: 'lobby_back' }, this.opponentPeerId, false);
      if (this.onBackToLobby) this.onBackToLobby();
    }

    sendGuestInput(inp) {
      if (!this.isConnected() || this.isHost()) return;
      if (inp.guardJustPressed) this._outCounters.g++;
      if (inp.lightPressed) this._outCounters.l++;
      if (inp.heavyPressed) this._outCounters.h++;
      if (inp.resbaPressed) this._outCounters.r++;
      if (inp.specialPressed) this._outCounters.s++;

      const pkt = {
        d: inp.dirX,
        u: inp.up ? 1 : 0,
        dn: inp.down ? 1 : 0,
        gd: inp.guard ? 1 : 0,
        g: this._outCounters.g,
        l: this._outCounters.l,
        h: this._outCounters.h,
        r: this._outCounters.r,
        s: this._outCounters.s,
      };
      const sig = `${pkt.d}|${pkt.u}|${pkt.dn}|${pkt.gd}|${pkt.g}|${pkt.l}|${pkt.h}|${pkt.r}|${pkt.s}`;
      this._inputSendTick++;
      const keepaliveMod = this.isP2P() ? 4 : 6;
      if (sig !== this._lastSentInputSig || this._inputSendTick % keepaliveMod === 0) {
        this._lastSentInputSig = sig;
        this._publish('inp', pkt, this.opponentPeerId, true);
      }
    }

    _ingestRemoteInput(pkt) {
      if (!pkt || typeof pkt !== 'object') return;
      this._remoteInput.dirX = pkt.d === -1 ? -1 : pkt.d === 1 ? 1 : 0;
      this._remoteInput.up = !!pkt.u;
      this._remoteInput.down = !!pkt.dn;
      this._remoteInput.guard = !!pkt.gd;

      if (pkt.g > this._inCounters.g) {
        this._pendingRemotePresses.guardJustPressed = true;
        this._inCounters.g = pkt.g;
      }
      if (pkt.l > this._inCounters.l) {
        this._pendingRemotePresses.lightPressed = true;
        this._inCounters.l = pkt.l;
      }
      if (pkt.h > this._inCounters.h) {
        this._pendingRemotePresses.heavyPressed = true;
        this._inCounters.h = pkt.h;
      }
      if (pkt.r > this._inCounters.r) {
        this._pendingRemotePresses.resbaPressed = true;
        this._inCounters.r = pkt.r;
      }
      if (pkt.s > this._inCounters.s) {
        this._pendingRemotePresses.specialPressed = true;
        this._inCounters.s = pkt.s;
      }
    }

    consumeRemoteInput() {
      const inp = {
        dirX: this._remoteInput.dirX,
        up: this._remoteInput.up,
        down: this._remoteInput.down,
        guard: this._remoteInput.guard,
        guardJustPressed: this._pendingRemotePresses.guardJustPressed,
        lightPressed: this._pendingRemotePresses.lightPressed,
        heavyPressed: this._pendingRemotePresses.heavyPressed,
        resbaPressed: this._pendingRemotePresses.resbaPressed,
        specialPressed: this._pendingRemotePresses.specialPressed,
      };
      this._pendingRemotePresses.guardJustPressed = false;
      this._pendingRemotePresses.lightPressed = false;
      this._pendingRemotePresses.heavyPressed = false;
      this._pendingRemotePresses.resbaPressed = false;
      this._pendingRemotePresses.specialPressed = false;
      return inp;
    }

    sendSnapshot(snap) {
      if (!this.isConnected() || !this.isHost()) return;
      this._publish('snap', snap, this.opponentPeerId, true);
    }

    consumePendingEvents() {
      if (this.pendingEvents.length === 0) return [];
      const out = this.pendingEvents;
      this.pendingEvents = [];
      return out;
    }

    async disconnect(notifyPeer = true) {
      this._connectSeq++;
      clearInterval(this._helloTimer);
      clearInterval(this._pingTimer);
      clearInterval(this._heartbeatTimer);
      clearInterval(this._qmSeekTimer);
      clearTimeout(this._qmOfferTimer);
      this._helloTimer = null;
      this._pingTimer = null;
      this._heartbeatTimer = null;
      this._qmSeekTimer = null;
      this._qmOfferTimer = null;
      this._qmMatched = false;
      this._qmPendingOffer = null;

      if (notifyPeer && this.isConnected()) {
        this._publish('lobby', { t: 'bye' }, this.opponentPeerId, false);
      }

      this._closeWebRTC();

      const oldClient = this._client;
      this._client = null;
      this._activeTopic = null;
      this.opponentPeerId = null;
      this.role = null;
      this.pingMs = null;
      this.localReady = false;
      this.remoteReady = false;
      this.localRematch = false;
      this.remoteRematch = false;
      this.status = 'idle';

      try {
        if (oldClient) oldClient.end(true);
      } catch (_) {}
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.OnlineManager = OnlineManager;
})();
