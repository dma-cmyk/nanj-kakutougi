// なんJ格闘技大会 - Unified Keyboard & Multi-Touch Smartphone Input Manager
(function () {
  'use strict';

  class InputManager {
    constructor() {
      this.keys = new Set();
      this.keyJustPressed = new Set();

      // Virtual touch state for 1P
      this.touch = {
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
      this.touchHeld = new Set();
      this.stickPointerId = null;
      this.stickOrigin = { x: 0, y: 0 };
      this.stickMaxR = 44;

      this._bindKeyboard();
    }

    _bindKeyboard() {
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
          return;
        }
        // Prevent page scrolling on game keys
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
        if (!this.keys.has(e.code)) {
          this.keyJustPressed.add(e.code);
        }
        this.keys.add(e.code);
        window.NanJ.sound.init();
      });

      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
      });

      window.addEventListener('blur', () => {
        this.keys.clear();
        this.keyJustPressed.clear();
        this.resetTouch();
      });
    }

    resetTouch() {
      this.touch.dirX = 0;
      this.touch.up = false;
      this.touch.down = false;
      this.touch.guard = false;
      this.touch.guardJustPressed = false;
      this.touch.lightPressed = false;
      this.touch.heavyPressed = false;
      this.touch.resbaPressed = false;
      this.touch.specialPressed = false;
      this.touchHeld.clear();
      this.stickPointerId = null;
      const knob = document.getElementById('stick-knob');
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    }

    bindTouchControls() {
      const stickBase = document.getElementById('touch-stick');
      const stickKnob = document.getElementById('stick-knob');

      if (stickBase && stickKnob) {
        const updateStick = (clientX, clientY) => {
          const rect = stickBase.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const maxR = Math.min(rect.width, rect.height) * 0.36;
          this.stickMaxR = maxR;

          let dx = clientX - cx;
          let dy = clientY - cy;
          const dist = Math.hypot(dx, dy);
          if (dist > maxR) {
            dx = (dx / dist) * maxR;
            dy = (dy / dist) * maxR;
          }

          stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

          const nx = dx / maxR;
          const ny = dy / maxR;
          this.touch.dirX = nx < -0.24 ? -1 : nx > 0.24 ? 1 : 0;
          this.touch.up = ny < -0.44;
          this.touch.down = ny > 0.44;

          stickBase.classList.toggle('dir-left', this.touch.dirX === -1);
          stickBase.classList.toggle('dir-right', this.touch.dirX === 1);
          stickBase.classList.toggle('dir-up', this.touch.up);
          stickBase.classList.toggle('dir-down', this.touch.down);
        };

        const releaseStick = (e) => {
          if (this.stickPointerId !== null && e.pointerId !== this.stickPointerId) return;
          this.stickPointerId = null;
          this.touch.dirX = 0;
          this.touch.up = false;
          this.touch.down = false;
          stickKnob.style.transform = 'translate(0px, 0px)';
          stickBase.classList.remove('active', 'dir-left', 'dir-right', 'dir-up', 'dir-down');
        };

        stickBase.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          window.NanJ.sound.init();
          if (this.stickPointerId !== null) return;
          this.stickPointerId = e.pointerId;
          try { stickBase.setPointerCapture(e.pointerId); } catch (_) {}
          stickBase.classList.add('active');
          updateStick(e.clientX, e.clientY);
        });

        stickBase.addEventListener('pointermove', (e) => {
          if (e.pointerId !== this.stickPointerId) return;
          e.preventDefault();
          updateStick(e.clientX, e.clientY);
        });

        stickBase.addEventListener('pointerup', releaseStick);
        stickBase.addEventListener('pointercancel', releaseStick);
      }

      // Bind action buttons with multi-touch pointer tracking
      const buttons = document.querySelectorAll('[data-game-btn]');
      buttons.forEach((btn) => {
        const action = btn.getAttribute('data-game-btn');
        const activePointers = new Set();

        const press = (e) => {
          e.preventDefault();
          window.NanJ.sound.init();
          activePointers.add(e.pointerId);
          try { btn.setPointerCapture(e.pointerId); } catch (_) {}
          btn.classList.add('pressed');
          this.touchHeld.add(action);

          if (action === 'light') this.touch.lightPressed = true;
          else if (action === 'heavy') this.touch.heavyPressed = true;
          else if (action === 'resba') this.touch.resbaPressed = true;
          else if (action === 'special') this.touch.specialPressed = true;
          else if (action === 'guard') {
            if (!this.touch.guard) this.touch.guardJustPressed = true;
            this.touch.guard = true;
          } else if (action === 'jump') {
            this.touch.up = true;
          }
        };

        const release = (e) => {
          activePointers.delete(e.pointerId);
          if (activePointers.size === 0) {
            btn.classList.remove('pressed');
            this.touchHeld.delete(action);
            if (action === 'guard') this.touch.guard = false;
            if (action === 'jump') this.touch.up = false;
          }
        };

        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
      });
    }

    _anyDown(codes) {
      for (const c of codes) if (this.keys.has(c)) return true;
      return false;
    }

    _anyJust(codes) {
      for (const c of codes) if (this.keyJustPressed.has(c)) return true;
      return false;
    }

    getPlayerInput(slot, is2PMode) {
      if (slot === 0) {
        if (!is2PMode) {
          // 1P Solo Mode: WASD or Arrow keys + Z/X/C/Shift/Space OR J/K/L/U/I + Touch controls!
          const left = this._anyDown(['KeyA', 'ArrowLeft']) || this.touch.dirX === -1;
          const right = this._anyDown(['KeyD', 'ArrowRight']) || this.touch.dirX === 1;
          const up = this._anyDown(['KeyW', 'ArrowUp']) || this.touch.up;
          const down = this._anyDown(['KeyS', 'ArrowDown']) || this.touch.down;
          const guard = this._anyDown(['ShiftLeft', 'ShiftRight', 'KeyU', 'KeyV']) || this.touch.guard;
          const guardJustPressed =
            this._anyJust(['ShiftLeft', 'ShiftRight', 'KeyU', 'KeyV']) || this.touch.guardJustPressed;

          const res = {
            dirX: (right ? 1 : 0) - (left ? 1 : 0),
            up,
            down,
            guard,
            guardJustPressed,
            lightPressed: this._anyJust(['KeyJ', 'KeyZ', 'KeyF']) || this.touch.lightPressed,
            heavyPressed: this._anyJust(['KeyK', 'KeyX', 'KeyG']) || this.touch.heavyPressed,
            resbaPressed: this._anyJust(['KeyL', 'KeyC', 'KeyH']) || this.touch.resbaPressed,
            specialPressed: this._anyJust(['KeyI', 'Space', 'KeyB', 'KeyT']) || this.touch.specialPressed,
          };
          return res;
        } else {
          // 2P Mode: 1P uses WASD + F/G/H/R/T (and touch)
          const left = this._anyDown(['KeyA']) || this.touch.dirX === -1;
          const right = this._anyDown(['KeyD']) || this.touch.dirX === 1;
          const up = this._anyDown(['KeyW']) || this.touch.up;
          const down = this._anyDown(['KeyS']) || this.touch.down;
          const guard = this._anyDown(['KeyR', 'ShiftLeft']) || this.touch.guard;
          const guardJustPressed = this._anyJust(['KeyR', 'ShiftLeft']) || this.touch.guardJustPressed;
          return {
            dirX: (right ? 1 : 0) - (left ? 1 : 0),
            up,
            down,
            guard,
            guardJustPressed,
            lightPressed: this._anyJust(['KeyF']) || this.touch.lightPressed,
            heavyPressed: this._anyJust(['KeyG']) || this.touch.heavyPressed,
            resbaPressed: this._anyJust(['KeyH']) || this.touch.resbaPressed,
            specialPressed: this._anyJust(['KeyT']) || this.touch.specialPressed,
          };
        }
      } else {
        // 2P Keyboard: Arrows + J/K/L/U/I (or Numpad 1/2/3/4/5)
        const left = this._anyDown(['ArrowLeft']);
        const right = this._anyDown(['ArrowRight']);
        const up = this._anyDown(['ArrowUp']);
        const down = this._anyDown(['ArrowDown']);
        const guard = this._anyDown(['KeyU', 'ShiftRight', 'Numpad0']);
        const guardJustPressed = this._anyJust(['KeyU', 'ShiftRight', 'Numpad0']);
        return {
          dirX: (right ? 1 : 0) - (left ? 1 : 0),
          up,
          down,
          guard,
          guardJustPressed,
          lightPressed: this._anyJust(['KeyJ', 'Numpad1']),
          heavyPressed: this._anyJust(['KeyK', 'Numpad2']),
          resbaPressed: this._anyJust(['KeyL', 'Numpad3']),
          specialPressed: this._anyJust(['KeyI', 'Numpad4', 'Enter']),
        };
      }
    }

    endFrame() {
      this.keyJustPressed.clear();
      this.touch.guardJustPressed = false;
      this.touch.lightPressed = false;
      this.touch.heavyPressed = false;
      this.touch.resbaPressed = false;
      this.touch.specialPressed = false;
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.input = new InputManager();
})();
