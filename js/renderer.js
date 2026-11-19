// なんJ格闘技大会 - 2D Canvas Arcade Renderer (Faithful to Reference Style)
(function () {
  'use strict';

  const { STAGE } = window.NanJ;

  const FONT_JP = '"M PLUS Rounded 1c", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
  const FONT_ARCADE = '"Fredoka", "M PLUS Rounded 1c", "Arial Black", sans-serif';

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  class GameRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tick = 0;
      this.stars = Array.from({ length: 18 }, (_, i) => ({
        x: 60 + ((i * 197) % (STAGE.WIDTH - 120)),
        y: 35 + ((i * 83) % 155),
        phase: i * 1.1,
        size: 1.5 + (i % 3) * 1.2,
      }));
    }

    render(state) {
      this.tick++;
      const ctx = this.ctx;
      const {
        fighters,
        fx,
        roundTime,
        mode,
        hideHud,
        crowdCommentsEnabled,
        localSlot = 0,
        onlinePing = null,
        onlineTransport = null,
      } = state;

      ctx.save();
      ctx.clearRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);

      // Camera shake & subtle focus zoom
      const shakeX = fx.screenShake > 0 ? (Math.random() - 0.5) * fx.screenShake * 2 : 0;
      const shakeY = fx.screenShake > 0 ? (Math.random() - 0.5) * fx.screenShake * 1.6 : 0;

      ctx.save();
      const z = fx.zoom;
      if (z !== 1.0 || shakeX !== 0 || shakeY !== 0) {
        ctx.translate(STAGE.WIDTH / 2 + shakeX, STAGE.HEIGHT / 2 + shakeY);
        ctx.scale(z, z);
        ctx.translate(-STAGE.WIDTH / 2, -STAGE.HEIGHT / 2);
      }

      // 1. Stage background + live signs + animated ambience
      this._drawStage(ctx, fx);

      // 2. Live scrolling "なんでも実況J" sky comments
      if (crowdCommentsEnabled !== false) {
        this._drawCrowdComments(ctx, fx);
      }

      // 3. Super Flash dark backdrop & dramatic speedlines behind fighters
      if (fx.superFlash) {
        this._drawSuperBackdrop(ctx, fx.superFlash);
      }

      // 4. Lightning strikes (Midnight J-Min super)
      this._drawLightningStrikes(ctx, fx);

      // 5. Afterimages
      this._drawAfterimages(ctx, fx);

      // 6. Grounded shadows
      for (const f of fighters) {
        this._drawShadow(ctx, f);
      }

      // 7. Fighters (draw active attacker in front!)
      const drawOrder =
        fighters[0].state === 'attack' && fighters[1].state !== 'attack'
          ? [fighters[1], fighters[0]]
          : [fighters[0], fighters[1]];
      for (const f of drawOrder) {
        this._drawFighter(ctx, f, mode, localSlot);
      }

      // 8. Speech bubbles attached to fighters (always on top of bodies)
      for (const f of fighters) {
        if (f.speechTimer > 0 && f.speechText) {
          this._drawFighterSpeechBubble(ctx, f);
        }
      }

      // 9. Flying Resba speech-bubble projectiles & 33-4 meteors
      this._drawProjectiles(ctx, fx);

      // 10. Hit sparks, particles & comic onomatopoeia
      this._drawSparksAndParticles(ctx, fx);
      this._drawPopTexts(ctx, fx);

      ctx.restore(); // end camera transform

      // 11. Screen flash overlay
      if (fx.flashAlpha > 0.01) {
        ctx.save();
        ctx.fillStyle = fx.flashColor;
        ctx.globalAlpha = fx.flashAlpha;
        ctx.fillRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);
        ctx.restore();
      }

      // 12. Super Cut-in Banner
      if (fx.superFlash) {
        this._drawSuperCutIn(ctx, fx.superFlash);
      }

      // 13. Classic Reference-Style Arcade HUD (HP, TIME, Names, Score, POW)
      if (!hideHud) {
        this._drawArcadeHUD(ctx, fighters, roundTime, mode, localSlot, onlinePing, onlineTransport);
      }

      // 14. Center Round / KO / Counter Banner
      if (fx.banner) {
        this._drawCenterBanner(ctx, fx.banner);
      }

      ctx.restore();
    }

    _drawStage(ctx, fx) {
      const bg = window.NanJ.sprites.stageBg;
      if (bg) {
        // Draw with tiny bleed margin so screen shake never exposes edges
        ctx.drawImage(bg, -18, -12, STAGE.WIDTH + 36, STAGE.HEIGHT + 24);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, STAGE.HEIGHT);
        grad.addColorStop(0, '#0d2638');
        grad.addColorStop(0.7, '#1b4056');
        grad.addColorStop(1, '#365869');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);
      }

      // Subtle crowd hype spotlights from top
      if (fx.crowdHype > 0.05) {
        ctx.save();
        ctx.globalAlpha = fx.crowdHype * 0.22;
        const g1 = ctx.createRadialGradient(340, 120, 10, 340, 420, 420);
        g1.addColorStop(0, '#fde047');
        g1.addColorStop(1, 'transparent');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);

        const g2 = ctx.createRadialGradient(940, 120, 10, 940, 420, 420);
        g2.addColorStop(0, '#38bdf8');
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);
        ctx.restore();
      }

      // Twinkling stars
      ctx.save();
      for (const s of this.stars) {
        const pulse = 0.45 + 0.55 * Math.sin(this.tick * 0.05 + s.phase);
        ctx.globalAlpha = pulse * 0.8;
        ctx.fillStyle = '#fff9db';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Gong vibration ripples on Round Start / KO
      if (fx.gongPulse > 0.01) {
        const gongPos = [
          { x: 344, y: 526 },
          { x: 1046, y: 530 },
        ];
        ctx.save();
        for (const g of gongPos) {
          const r = 34 + (1 - fx.gongPulse) * 85;
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 4 * fx.gongPulse;
          ctx.globalAlpha = fx.gongPulse * 0.85;
          ctx.beginPath();
          ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Crisp authentic Japanese signage directly aligned onto the blank cream surfaces!
      this._drawStageSignage(ctx);
    }

    _drawStageSignage(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 1. Center cloth banner: (447, 150) -> (830, 266)
      ctx.fillStyle = '#4a180d';
      ctx.font = `900 41px ${FONT_JP}`;
      ctx.fillText('なんJ格闘技大会', 640, 206, 355);

      ctx.fillStyle = '#5c2618';
      ctx.font = `800 13.5px ${FONT_JP}`;
      ctx.fillText('リアルタイム感と独特のノリ、情報の早さと多様性', 640, 240, 350);

      // 2. Left held signboard: (160, 269) -> (284, 359)
      ctx.fillStyle = '#3d150c';
      ctx.font = `900 22px ${FONT_JP}`;
      ctx.fillText('なんでも', 224, 297, 108);
      ctx.font = `900 26px ${FONT_JP}`;
      ctx.fillText('実況J', 224, 329, 108);

      // 3. Left podium box: (222, 492) -> (280, 559)
      ctx.fillStyle = '#31120a';
      ctx.font = `900 20px ${FONT_JP}`;
      ctx.fillText('実況', 252, 515, 52);
      ctx.fillText('注意', 252, 540, 52);

      // 4. Right vertical signboard: (1095, 240) -> (1190, 474)
      const drawVertical = (chars, x, startY, stepY, font, color) => {
        ctx.fillStyle = color;
        ctx.font = font;
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i];
          if (ch === 'ー') {
            ctx.save();
            ctx.translate(x, startY + i * stepY);
            ctx.rotate(Math.PI / 2);
            ctx.fillText('ー', 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(ch, x, startY + i * stepY);
          }
        }
      };

      drawVertical('負けたら', 1170, 272, 26, `900 21px ${FONT_JP}`, '#4a140c');
      drawVertical('時間の節約・メンタルケア', 1143, 253, 15.5, `800 13px ${FONT_JP}`, '#2d160e');
      drawVertical('スラングの侵食防止', 1118, 262, 18.5, `800 13px ${FONT_JP}`, '#2d160e');

      ctx.restore();
    }

    _drawCrowdComments(ctx, fx) {
      if (fx.crowdComments.length === 0) return;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const c of fx.crowdComments) {
        ctx.globalAlpha = c.alpha;
        ctx.font = `800 ${c.size}px ${FONT_JP}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10, 22, 34, 0.85)';
        ctx.strokeText(c.text, c.x, c.y);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(c.text, c.x, c.y);
      }
      ctx.restore();
    }

    _drawSuperBackdrop(ctx, sf) {
      const progress = 1 - sf.timer / sf.maxTimer;
      ctx.save();
      ctx.fillStyle = 'rgba(6, 14, 24, 0.68)';
      ctx.fillRect(0, 0, STAGE.WIDTH, STAGE.HEIGHT);

      // Dramatic anime speedlines radiating from center
      const cx = sf.side === 0 ? 380 : 900;
      const cy = 420;
      ctx.strokeStyle = sf.accent;
      ctx.globalAlpha = 0.45 * (1 - progress * 0.4);
      for (let i = 0; i < 28; i++) {
        const ang = (Math.PI * 2 * i) / 28 + this.tick * 0.03;
        ctx.lineWidth = 2 + (i % 3) * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * 90, cy + Math.sin(ang) * 90);
        ctx.lineTo(cx + Math.cos(ang) * 1100, cy + Math.sin(ang) * 1100);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawSuperCutIn(ctx, sf) {
      const p = sf.timer / sf.maxTimer;
      const slide = p > 0.8 ? (p - 0.8) / 0.2 : p < 0.18 ? (0.18 - p) / 0.18 : 0;
      const offsetX = (sf.side === 0 ? -1 : 1) * slide * 520;

      ctx.save();
      ctx.translate(offsetX, 0);

      // Diagonal comic cut-in strip
      ctx.fillStyle = '#111827';
      ctx.strokeStyle = sf.accent;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 260);
      ctx.lineTo(STAGE.WIDTH, 225);
      ctx.lineTo(STAGE.WIDTH, 370);
      ctx.lineTo(0, 405);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Portrait sprite inside cut-in
      const sp = window.NanJ.sprites.getPose(sf.spriteSet, 'super');
      if (sp) {
        ctx.save();
        ctx.clip();
        const px = sf.side === 0 ? 180 : STAGE.WIDTH - 180;
        ctx.translate(px, 395);
        ctx.scale(sf.side === 0 ? 0.95 : -0.95, 0.95);
        ctx.drawImage(sp, -sp.width / 2, -sp.height * 0.82);
        ctx.restore();
      }

      // Super move name text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 26px ${FONT_JP}`;
      ctx.fillStyle = '#fef08a';
      ctx.fillText(`★ ${sf.fighterName} 超必殺奥義 ★`, STAGE.WIDTH / 2, 286);

      ctx.font = `900 44px ${FONT_JP}`;
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#1a120b';
      ctx.strokeText(sf.superName, STAGE.WIDTH / 2, 336, 860);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(sf.superName, STAGE.WIDTH / 2, 336, 860);

      ctx.restore();
    }

    _drawShadow(ctx, f) {
      const airHeight = Math.max(0, STAGE.GROUND_Y - f.y);
      const scale = Math.max(0.42, 1 - airHeight / 420);
      const w = (f.state === 'ko' ? 128 : 88) * scale;
      const h = 21 * scale;

      ctx.save();
      ctx.fillStyle = 'rgba(8, 22, 32, 0.56)';
      ctx.beginPath();
      ctx.ellipse(f.x, STAGE.GROUND_Y + 4, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawAfterimages(ctx, fx) {
      for (const a of fx.afterimages) {
        const sp = window.NanJ.sprites.getPose(a.spriteSet, a.pose);
        if (!sp) continue;
        const alpha = (a.life / a.maxLife) * 0.42;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(a.x, a.y);
        ctx.scale(a.facing * a.scaleX * 0.84, a.scaleY * 0.84);
        ctx.drawImage(sp, -sp.width / 2, -sp.height);
        ctx.restore();
      }
    }

    _drawFighter(ctx, f, mode = 'vs_cpu', localSlot = 0) {
      const pose = f.getCurrentPose();
      const sp = window.NanJ.sprites.getPose(f.config.spriteSet, pose);

      // Gentle idle breathing bob
      const breathe =
        f.state === 'idle' ? Math.sin(this.tick * 0.13 + f.slot * 2) * 0.025 : 0;
      const drawScale = 0.84;
      const sx = f.scaleX * (1 - breathe) * drawScale;
      const sy = f.scaleY * (1 + breathe) * drawScale;

      ctx.save();
      ctx.translate(f.x, f.y + 5);

      // Invulnerability blink on wakeup
      if (f.invulnTimer > 0 && f.state === 'wakeup' && Math.floor(this.tick / 2) % 2 === 0) {
        ctx.globalAlpha = 0.55;
      }

      // Tilt ("効いてる" 顔真っ赤) pulsing red aura
      if (f.tiltTimer > 0 && f.state !== 'ko') {
        ctx.save();
        const pulse = 0.35 + 0.25 * Math.sin(this.tick * 0.35);
        const aura = ctx.createRadialGradient(0, -120, 20, 0, -120, 145);
        aura.addColorStop(0, `rgba(255, 50, 30, ${pulse})`);
        aura.addColorStop(1, 'rgba(255, 50, 30, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, -120, 145, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Just Guard cyan shield ring
      if (f.justGuardFlash > 0) {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 6;
        ctx.globalAlpha = f.justGuardFlash / 16;
        ctx.beginPath();
        ctx.arc(f.facing * 26, -128, 98, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.stroke();
        ctx.restore();
      }

      // Apply character palette filter if supported
      ctx.save();
      ctx.scale(f.facing * sx, sy);

      let filterStr = f.config.tintFilter !== 'none' ? f.config.tintFilter : '';
      if (f.hitFlash > 0 && Math.floor(f.hitFlash / 2) % 2 === 0) {
        filterStr = `${filterStr} brightness(2.0) saturate(0.4)`.trim();
      } else if (f.tiltTimer > 0 && f.state !== 'ko') {
        filterStr = `${filterStr} saturate(1.3) drop-shadow(0 0 8px rgba(255,55,30,0.75))`.trim();
      }
      if (filterStr && 'filter' in ctx) {
        try { ctx.filter = filterStr; } catch (_) {}
      }

      if (sp) {
        ctx.drawImage(sp, -sp.width / 2, -sp.height);
      } else {
        // Fallback silhouette if asset missing
        ctx.fillStyle = '#f0a435';
        ctx.strokeStyle = '#1a120b';
        ctx.lineWidth = 6;
        roundRectPath(ctx, -60, -230, 120, 230, 48);
        ctx.fill();
        ctx.stroke();
      }
      if ('filter' in ctx) {
        try { ctx.filter = 'none'; } catch (_) {}
      }

      // Distinct character accessories (Yakiu-Min Baseball Cap / Midnight Headband)
      if (pose !== 'ko' && f.config.accessory === 'cap') {
        this._drawYakiuCap(ctx, pose);
      } else if (pose !== 'ko' && f.config.accessory === 'headband') {
        this._drawMidnightHeadband(ctx, pose);
      }

      ctx.restore(); // end facing/scale

      // Comic anger vein mark "💢" when Tilted ("効いてる"!)
      if (f.tiltTimer > 0 && f.state !== 'ko') {
        const jiggle = Math.sin(this.tick * 0.5) * 3;
        ctx.font = `900 32px ${FONT_JP}`;
        ctx.textAlign = 'center';
        ctx.fillText('💢', f.facing * 52 + jiggle, -225 - Math.abs(jiggle));
      }

      // 1P / 2P (or YOU / RIVAL in online mode) ground indicator tag
      ctx.font = `900 13px ${FONT_ARCADE}`;
      ctx.textAlign = 'center';
      const isOnline = mode === 'online';
      const isMe = isOnline ? f.slot === localSlot : f.slot === 0;
      ctx.fillStyle = isMe ? '#fde047' : '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4;
      const tag = isOnline ? (isMe ? 'YOU' : 'RIVAL') : f.slot === 0 ? '1P' : '2P';
      ctx.strokeText(tag, 0, 18);
      ctx.fillText(tag, 0, 18);

      ctx.restore();
    }

    _drawYakiuCap(ctx, pose) {
      // Drawn in local right-facing sprite space above head
      const ox = pose === 'hurt' ? -24 : pose === 'punch' ? 14 : 2;
      const oy = pose === 'hurt' ? -248 : -286;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#1a120b';
      // Yellow-black striped Hanshin-vibe baseball cap!
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(0, 6, 44, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Black stripes
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-20, -34, 9, 38);
      ctx.fillRect(8, -34, 9, 38);

      // Cap brim facing right
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.moveTo(14, 2);
      ctx.quadraticCurveTo(64, -2, 74, 14);
      ctx.quadraticCurveTo(42, 18, 12, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // "J" badge
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 22px ${FONT_ARCADE}`;
      ctx.textAlign = 'center';
      ctx.fillText('J', -2, -6);
      ctx.restore();
    }

    _drawMidnightHeadband(ctx, pose) {
      const ox = pose === 'hurt' ? -22 : 4;
      const oy = pose === 'hurt' ? -246 : -262;
      ctx.save();
      ctx.translate(ox, oy);
      // Flowing midnight headband tails
      const wave = Math.sin(this.tick * 0.25) * 9;
      ctx.strokeStyle = '#1a120b';
      ctx.lineWidth = 4;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(-36, 0);
      ctx.quadraticCurveTo(-78, -6 + wave, -104, 14 + wave);
      ctx.lineTo(-96, 28 + wave);
      ctx.quadraticCurveTo(-68, 12 + wave, -32, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Band across forehead
      roundRectPath(ctx, -40, -4, 82, 18, 6);
      ctx.fillStyle = '#0ea5e9';
      ctx.fill();
      ctx.stroke();

      // White glowing band text "深夜"
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 12px ${FONT_JP}`;
      ctx.textAlign = 'center';
      ctx.fillText('3:00', 2, 9);
      ctx.restore();
    }

    _drawFighterSpeechBubble(ctx, f) {
      const text = f.speechText;
      const alpha = Math.min(1, f.speechTimer / 12);
      const isCounter = f.speechStyle === 'counter' || f.speechStyle === 'super';
      const isTilt = f.speechStyle === 'tilt';

      ctx.save();
      ctx.globalAlpha = alpha;

      // Split long line into max 2 clean comic lines
      const lines = this._wrapJapaneseBubble(text, 9);
      const fontSize = isCounter ? 25 : 23;
      ctx.font = `900 ${fontSize}px ${FONT_JP}`;

      let maxW = 0;
      for (const ln of lines) {
        maxW = Math.max(maxW, ctx.measureText(ln).width);
      }

      const padX = 22;
      const padY = 14;
      const lineH = fontSize + 7;
      const bw = Math.max(128, maxW + padX * 2);
      const bh = lines.length * lineH + padY * 2;

      // Clamp bubble inside screen neatly below top HUD!
      const anchorX = f.x + f.facing * 12;
      const bx = Math.max(24, Math.min(STAGE.WIDTH - bw - 24, anchorX - bw / 2));
      const by = Math.max(126, Math.min(STAGE.HEIGHT - 290, f.y - 266 - bh));

      // Subtle pop-in scale ONLY for first 8 frames after speaking!
      const pop = f.speechAge < 8 ? 0.86 + Math.sin((f.speechAge / 8) * Math.PI) * 0.22 + (f.speechAge / 8) * 0.14 : 1.0;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.translate(-cx, -cy);

      // Comic bubble shadow
      ctx.fillStyle = 'rgba(12, 20, 30, 0.35)';
      roundRectPath(ctx, bx + 4, by + 5, bw, bh, 22);
      ctx.fill();

      // Bubble body (crisp white/cream matching reference image, yellow/red tint for counter/tilt)
      ctx.fillStyle = isCounter ? '#fef08a' : isTilt ? '#fee2e2' : '#fffdf5';
      ctx.strokeStyle = '#1b1410';
      ctx.lineWidth = 4.5;
      roundRectPath(ctx, bx, by, bw, bh, 22);
      ctx.fill();
      ctx.stroke();

      // Speech tail pointing down to fighter head
      const tailX = Math.max(bx + 26, Math.min(bx + bw - 26, f.x));
      ctx.beginPath();
      ctx.moveTo(tailX - 11, by + bh - 2);
      ctx.lineTo(tailX + f.facing * 4, by + bh + 18);
      ctx.lineTo(tailX + 13, by + bh - 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tailX - 11, by + bh - 1);
      ctx.lineTo(tailX + f.facing * 4, by + bh + 18);
      ctx.lineTo(tailX + 13, by + bh - 1);
      ctx.stroke();

      // Text inside bubble
      ctx.fillStyle = isTilt ? '#b91c1c' : '#1b1410';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < lines.length; i++) {
        const ty = by + padY + lineH * (i + 0.5);
        ctx.fillText(lines[i], bx + bw / 2, ty);
      }

      ctx.restore();
    }

    _wrapJapaneseBubble(text, maxChars) {
      if (text.length <= maxChars) return [text];
      // Smart split on exclamation or midpoint
      const mid = Math.ceil(text.length / 2);
      return [text.slice(0, mid), text.slice(mid)];
    }

    _drawProjectiles(ctx, fx) {
      for (const pr of fx.projectiles) {
        ctx.save();
        ctx.translate(pr.x, pr.y);

        if (pr.kind === 'meteor') {
          // Blazing 33-4 Meteor!
          const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, pr.radius * 1.4);
          grad.addColorStop(0, '#fff7ed');
          grad.addColorStop(0.45, '#facc15');
          grad.addColorStop(0.8, '#ea580c');
          grad.addColorStop(1, 'rgba(234, 88, 12, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, pr.radius * 1.4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#18181b';
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(0, 0, pr.radius * 0.78, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#fde047';
          ctx.font = `900 28px ${FONT_JP}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pr.text, 0, 0);
        } else {
          // Flying Comic Resba Speech Bubble Missile!
          const pulse = 1 + Math.sin(this.tick * 0.45) * 0.06;
          ctx.scale(pulse, pulse);

          ctx.font = `900 ${pr.isSuper ? 26 : pr.isCounter ? 23 : 20}px ${FONT_JP}`;
          const tw = ctx.measureText(pr.text).width;
          const bw = Math.max(pr.radius * 2.4, tw + 36);
          const bh = pr.isSuper ? 68 : pr.isCounter ? 58 : 48;

          // Motion speed trail behind bubble
          const dir = pr.vx >= 0 ? -1 : 1;
          ctx.strokeStyle = pr.isCounter || pr.isSuper ? '#fde047' : pr.accent;
          ctx.lineWidth = 4;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(dir * (bw / 2), i * 14);
            ctx.lineTo(dir * (bw / 2 + 34 + Math.abs(i) * 10), i * 14);
            ctx.stroke();
          }

          // Spiky glow aura for counter / super bubbles
          if (pr.isCounter || pr.isSuper) {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
            roundRectPath(ctx, -bw / 2 - 8, -bh / 2 - 8, bw + 16, bh + 16, 24);
            ctx.fill();
          }

          ctx.fillStyle = pr.isSuper ? '#fef08a' : pr.isCounter ? '#fde047' : '#fffdf5';
          ctx.strokeStyle = pr.isCounter || pr.isSuper ? '#dc2626' : '#1b1410';
          ctx.lineWidth = pr.isSuper ? 5.5 : 4;
          roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, 20);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#1b1410';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pr.text, 0, 1);
        }

        ctx.restore();
      }
    }

    _drawLightningStrikes(ctx, fx) {
      for (const l of fx.lightningStrikes) {
        ctx.save();
        if (l.warning > 0) {
          // Ground danger marker
          const blink = Math.floor(l.warning / 3) % 2 === 0;
          ctx.fillStyle = blink ? 'rgba(96, 165, 250, 0.5)' : 'rgba(254, 240, 138, 0.35)';
          ctx.beginPath();
          ctx.ellipse(l.x, STAGE.GROUND_Y, 64, 18, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(l.x, 80);
          ctx.lineTo(l.x, STAGE.GROUND_Y);
          ctx.stroke();
        } else {
          // Full sky-splitting server-crash bolt!
          const alpha = l.active / 14;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = 'rgba(147, 197, 253, 0.45)';
          ctx.fillRect(l.x - 52, 0, 104, STAGE.GROUND_Y + 12);

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 14;
          ctx.beginPath();
          let cy = 0;
          ctx.moveTo(l.x, 0);
          while (cy < STAGE.GROUND_Y) {
            cy += 48;
            ctx.lineTo(l.x + (Math.random() - 0.5) * 44, Math.min(STAGE.GROUND_Y, cy));
          }
          ctx.stroke();

          ctx.fillStyle = '#fef08a';
          ctx.font = `900 28px ${FONT_JP}`;
          ctx.textAlign = 'center';
          ctx.fillText('503 ERROR!!', l.x, STAGE.GROUND_Y - 190);
        }
        ctx.restore();
      }
    }

    _drawSparksAndParticles(ctx, fx) {
      for (const s of fx.sparks) {
        const alpha = s.life / s.maxLife;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 4.5 * alpha;
        ctx.beginPath();
        ctx.arc(0, 0, s.r, 0, Math.PI * 2);
        ctx.stroke();

        // Comic starburst rays
        ctx.fillStyle = '#fff9db';
        ctx.beginPath();
        for (let i = 0; i < s.rays * 2; i++) {
          const ang = (Math.PI * i) / s.rays;
          const rad = i % 2 === 0 ? s.r * 1.15 : s.r * 0.42;
          const px = Math.cos(ang) * rad;
          const py = Math.sin(ang) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (const p of fx.particles) {
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.shape === 'smoke' ? 1.3 - alpha * 0.4 : alpha), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    _drawPopTexts(ctx, fx) {
      for (const t of fx.popTexts) {
        const alpha = Math.min(1, t.life / 12);
        const pop = t.scalePop && t.life > t.maxLife - 8 ? 1.25 : 1.0;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.scale(pop, pop);
        ctx.font = `900 ${t.size}px ${FONT_JP}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 7;
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
      }
    }

    _drawArcadeHUD(ctx, fighters, roundTime, mode, localSlot = 0, onlinePing = null, onlineTransport = null) {
      const p1 = fighters[0];
      const p2 = fighters[1];

      ctx.save();

      // Subtle top vignette for razor-sharp HUD legibility
      const topVig = ctx.createLinearGradient(0, 0, 0, 128);
      topVig.addColorStop(0, 'rgba(7, 20, 32, 0.72)');
      topVig.addColorStop(1, 'rgba(7, 20, 32, 0)');
      ctx.fillStyle = topVig;
      ctx.fillRect(0, 0, STAGE.WIDTH, 128);

      // --- TOP LABELS (1P: Nan-J Taro (003450)  /  2P: Nan-J Jiro (002870)) ---
      const score1 = String(Math.floor(p1.score)).padStart(6, '0');
      const score2 = String(Math.floor(p2.score)).padStart(6, '0');

      ctx.font = `800 23px ${FONT_ARCADE}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#091826';
      ctx.textBaseline = 'middle';

      const p1Tag = mode === 'online' ? (localSlot === 0 ? '1P(YOU)' : '1P(NET)') : '1P';
      const p2Tag = mode === 'online' ? (localSlot === 1 ? '2P(YOU)' : '2P(NET)') : mode === '2p' ? '2P' : 'CPU';

      ctx.textAlign = 'left';
      const label1 = `${p1Tag}: ${p1.config.nameEn} (${score1})`;
      ctx.strokeText(label1, 24, 28);
      ctx.fillStyle = mode === 'online' && localSlot === 0 ? '#fde047' : '#ffe599';
      ctx.fillText(label1, 24, 28);

      ctx.textAlign = 'right';
      const label2 = `${p2Tag}: ${p2.config.nameEn} (${score2})`;
      ctx.strokeText(label2, STAGE.WIDTH - 24, 28);
      ctx.fillStyle = mode === 'online' && localSlot === 1 ? '#fde047' : '#ffe599';
      ctx.fillText(label2, STAGE.WIDTH - 24, 28);

      // --- HEALTH BARS (Reference style: white border, dark navy bg, yellow + orange bar!) ---
      const barY = 46;
      const barH = 34;
      const barW = 536;
      const leftBarX = 24;
      const rightBarX = STAGE.WIDTH - 24 - barW;

      this._drawHealthBar(ctx, leftBarX, barY, barW, barH, p1, true);
      this._drawHealthBar(ctx, rightBarX, barY, barW, barH, p2, false);

      // --- CENTER TIMER (TIME + glowing orange 56) ---
      ctx.textAlign = 'center';
      ctx.font = `900 20px ${FONT_ARCADE}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#091826';
      ctx.strokeText('TIME', STAGE.WIDTH / 2, 34);
      ctx.fillStyle = '#ffbb42';
      ctx.fillText('TIME', STAGE.WIDTH / 2, 34);

      const timeStr = String(Math.max(0, Math.ceil(roundTime))).padStart(2, '0');
      ctx.save();
      ctx.font = `900 56px ${FONT_ARCADE}`;
      ctx.shadowColor = roundTime <= 10 ? '#ff4d4d' : '#38bdf8';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#18100a';
      ctx.strokeText(timeStr, STAGE.WIDTH / 2, 74);

      const tGrad = ctx.createLinearGradient(0, 44, 0, 100);
      tGrad.addColorStop(0, roundTime <= 10 ? '#ff9999' : '#fff0a6');
      tGrad.addColorStop(0.5, roundTime <= 10 ? '#ff3b3b' : '#ff981a');
      tGrad.addColorStop(1, roundTime <= 10 ? '#b91c1c' : '#e04f16');
      ctx.fillStyle = tGrad;
      ctx.fillText(timeStr, STAGE.WIDTH / 2, 74);
      ctx.restore();

      // --- JAPANESE FIGHTER NAMES & ROUND ORBS BELOW BARS ---
      ctx.font = `900 26px ${FONT_JP}`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0b1824';

      ctx.textAlign = 'left';
      ctx.strokeText(p1.config.nameJp, 26, 102);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p1.config.nameJp, 26, 102);

      ctx.textAlign = 'right';
      ctx.strokeText(p2.config.nameJp, STAGE.WIDTH - 26, 102);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p2.config.nameJp, STAGE.WIDTH - 26, 102);

      // Round win stars near center
      this._drawRoundOrbs(ctx, leftBarX + barW - 14, 102, p1.roundsWon, -1);
      this._drawRoundOrbs(ctx, rightBarX + 14, 102, p2.roundsWon, 1);

      // Status / Combo badges
      if (p1.comboCount >= 2) {
        this._drawComboBadge(ctx, 110, 152, p1.comboCount, true);
      }
      if (p2.comboCount >= 2) {
        this._drawComboBadge(ctx, STAGE.WIDTH - 110, 152, p2.comboCount, false);
      }
      if (p1.tiltTimer > 0) {
        this._drawTiltBadge(ctx, 250, 102);
      }
      if (p2.tiltTimer > 0) {
        this._drawTiltBadge(ctx, STAGE.WIDTH - 250, 102);
      }

      // --- BOTTOM POW BARS (Exact reference layout!) ---
      this._drawPowBar(ctx, 24, 654, p1, true);
      this._drawPowBar(ctx, STAGE.WIDTH - 24, 654, p2, false);

      // Online connection & ping badge
      if (mode === 'online') {
        this._drawOnlineBadge(ctx, onlinePing, onlineTransport);
      }

      ctx.restore();
    }

    _drawOnlineBadge(ctx, pingMs, transport) {
      const hasPing = typeof pingMs === 'number' && Number.isFinite(pingMs);
      const tag = transport === 'p2p' ? 'ONLINE P2P' : 'ONLINE';
      const label = hasPing ? `${tag} · ${pingMs}ms` : tag;
      const dotColor = !hasPing ? '#38bdf8' : pingMs <= 70 ? '#4ade80' : pingMs <= 140 ? '#facc15' : '#f87171';
      ctx.save();
      ctx.font = `800 13px ${FONT_ARCADE}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 30;
      const bh = 24;
      const bx = STAGE.WIDTH / 2 - bw / 2;
      const by = 104;
      ctx.fillStyle = 'rgba(9, 24, 36, 0.78)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 2;
      roundRectPath(ctx, bx, by, bw, bh, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(bx + 12, by + bh / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e0f2fe';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 22, by + bh / 2 + 0.5);
      ctx.restore();
    }

    _drawHealthBar(ctx, x, y, w, h, fighter, leftToRight) {
      const ratio = Math.max(0, fighter.hp / fighter.maxHp);
      const trailRatio = Math.max(ratio, fighter.displayHp / fighter.maxHp);

      ctx.save();
      // Dark navy track
      ctx.fillStyle = '#112536';
      roundRectPath(ctx, x, y, w, h, 8);
      ctx.fill();

      ctx.save();
      roundRectPath(ctx, x + 3, y + 3, w - 6, h - 6, 5);
      ctx.clip();

      const innerW = w - 6;
      const trailW = innerW * trailRatio;
      const fillW = innerW * ratio;

      // Delayed damage drain (deep orange-red)
      ctx.fillStyle = '#d94816';
      if (leftToRight) {
        ctx.fillRect(x + 3 + (innerW - trailW), y + 3, trailW, h - 6);
      } else {
        ctx.fillRect(x + 3, y + 3, trailW, h - 6);
      }

      // Active HP bar (classic dual-tone warm gold + fiery orange matching screenshot!)
      const hpGrad = ctx.createLinearGradient(x, y, x + w, y);
      if (leftToRight) {
        hpGrad.addColorStop(0, '#c8922c');
        hpGrad.addColorStop(0.55, '#e8a838');
        hpGrad.addColorStop(1, '#e85d19');
      } else {
        hpGrad.addColorStop(0, '#e85d19');
        hpGrad.addColorStop(0.45, '#e8a838');
        hpGrad.addColorStop(1, '#c8922c');
      }
      ctx.fillStyle = ratio < 0.25 && Math.floor(this.tick / 6) % 2 === 0 ? '#ff3b3b' : hpGrad;

      if (leftToRight) {
        // Depletes from outside toward center, OR classic arcade depletes toward center!
        // Reference image shows full gold on outer edge and orange toward center, empty navy on far side!
        ctx.fillRect(x + 3, y + 3, fillW, h - 6);
      } else {
        ctx.fillRect(x + 3 + (innerW - fillW), y + 3, fillW, h - 6);
      }

      // Gloss highlight strip
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(x + 3, y + 3, innerW, (h - 6) * 0.38);

      ctx.restore();

      // Crisp white arcade border
      ctx.strokeStyle = '#fff9e6';
      ctx.lineWidth = 3.5;
      roundRectPath(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.restore();
    }

    _drawRoundOrbs(ctx, startX, y, won, dir) {
      for (let i = 0; i < STAGE.ROUNDS_TO_WIN; i++) {
        const cx = startX + dir * i * 28;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, y, 9.5, 0, Math.PI * 2);
        ctx.fillStyle = i < won ? '#facc15' : 'rgba(15, 35, 52, 0.85)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = i < won ? '#fffbeb' : '#64748b';
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawComboBadge(ctx, x, y, count, isLeft) {
      ctx.save();
      ctx.textAlign = isLeft ? 'left' : 'right';
      ctx.font = `900 34px ${FONT_ARCADE}`;
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#1b1410';
      const txt = `${count} HITS!!`;
      ctx.strokeText(txt, isLeft ? 28 : STAGE.WIDTH - 28, y);
      ctx.fillStyle = '#fde047';
      ctx.fillText(txt, isLeft ? 28 : STAGE.WIDTH - 28, y);
      ctx.restore();
    }

    _drawTiltBadge(ctx, x, y) {
      const pulse = 0.75 + 0.25 * Math.sin(this.tick * 0.35);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#dc2626';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2.5;
      roundRectPath(ctx, x - 56, y - 14, 112, 26, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 14px ${FONT_JP}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💢 効いてる!', x, y - 1);
      ctx.restore();
    }

    _drawPowBar(ctx, anchorX, y, fighter, isLeft) {
      const ratio = Math.max(0, Math.min(1, fighter.pow / 100));
      const barW = 248;
      const barH = 28;
      const labelW = 92;
      const isMax = fighter.pow >= 100;
      const isEx = fighter.pow >= 50;

      ctx.save();
      ctx.textBaseline = 'middle';

      // "POW" retro orange-red outlined label
      ctx.font = `900 34px ${FONT_ARCADE}`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#140c08';
      ctx.fillStyle = isMax && Math.floor(this.tick / 5) % 2 === 0 ? '#fef08a' : '#f06724';

      let barX;
      if (isLeft) {
        ctx.textAlign = 'left';
        ctx.strokeText('POW', anchorX, y + barH / 2 + 1);
        ctx.fillText('POW', anchorX, y + barH / 2 + 1);
        barX = anchorX + labelW;
      } else {
        ctx.textAlign = 'right';
        ctx.strokeText('POW', anchorX, y + barH / 2 + 1);
        ctx.fillText('POW', anchorX, y + barH / 2 + 1);
        barX = anchorX - labelW - barW;
      }

      // Dark navy track
      ctx.fillStyle = '#102436';
      roundRectPath(ctx, barX, y, barW, barH, 6);
      ctx.fill();

      // Fill
      const innerW = barW - 6;
      const fillW = innerW * ratio;
      if (fillW > 0) {
        ctx.save();
        roundRectPath(ctx, barX + 3, y + 3, innerW, barH - 6, 4);
        ctx.clip();
        const grad = ctx.createLinearGradient(barX, y, barX + barW, y);
        if (isMax) {
          grad.addColorStop(0, '#fde047');
          grad.addColorStop(0.5, '#fb923c');
          grad.addColorStop(1, '#fef08a');
        } else if (isEx) {
          grad.addColorStop(0, '#f59e0b');
          grad.addColorStop(1, '#fbbf24');
        } else {
          grad.addColorStop(0, '#d99b26');
          grad.addColorStop(1, '#eab308');
        }
        ctx.fillStyle = grad;
        if (isLeft) {
          ctx.fillRect(barX + 3, y + 3, fillW, barH - 6);
        } else {
          ctx.fillRect(barX + 3 + (innerW - fillW), y + 3, fillW, barH - 6);
        }
        ctx.restore();
      }

      // 50% EX tick line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(barX + barW / 2, y + 3);
      ctx.lineTo(barX + barW / 2, y + barH - 3);
      ctx.stroke();

      // Crisp border
      ctx.strokeStyle = isMax ? '#fef08a' : '#fff7e0';
      ctx.lineWidth = 3;
      roundRectPath(ctx, barX, y, barW, barH, 6);
      ctx.stroke();

      // Status caption above POW bar
      if (isMax || isEx) {
        ctx.font = `900 13px ${FONT_JP}`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#0f172a';
        const cap = isMax ? '★ MAX!! 超必殺OK ★' : 'EX技OK (50%)';
        ctx.strokeText(cap, barX + barW / 2, y - 11);
        ctx.fillStyle = isMax ? '#fde047' : '#fcd34d';
        ctx.fillText(cap, barX + barW / 2, y - 11);
      }

      ctx.restore();
    }

    _drawCenterBanner(ctx, b) {
      const progress = 1 - b.timer / b.maxTimer;
      const scale = progress < 0.14 ? 0.5 + (progress / 0.14) * 0.65 : progress < 0.22 ? 1.15 - ((progress - 0.14) / 0.08) * 0.15 : 1.0;
      const alpha = b.timer < 12 ? b.timer / 12 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(STAGE.WIDTH / 2, 315);
      ctx.scale(scale, scale);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 84px ${FONT_ARCADE}`;
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#140c08';
      ctx.strokeText(b.text, 0, 0);

      const g = ctx.createLinearGradient(0, -45, 0, 45);
      g.addColorStop(0, '#fffbeb');
      g.addColorStop(0.5, b.color);
      g.addColorStop(1, '#ea580c');
      ctx.fillStyle = g;
      ctx.fillText(b.text, 0, 0);

      if (b.sub) {
        ctx.font = `900 28px ${FONT_JP}`;
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#0f172a';
        ctx.strokeText(b.sub, 0, 62);
        ctx.fillStyle = '#fef08a';
        ctx.fillText(b.sub, 0, 62);
      }

      ctx.restore();
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.GameRenderer = GameRenderer;
})();
