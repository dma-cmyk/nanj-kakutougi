// なんJ格闘技大会 - Asset & Sprite Loader
(function () {
  'use strict';

  const POSES = ['idle', 'walk', 'punch', 'kick', 'taunt', 'guard', 'hurt', 'super', 'jump', 'ko'];
  const SETS = ['taro', 'jiro'];

  class SpriteManager {
    constructor() {
      this.stageBg = null;
      this.sprites = { taro: {}, jiro: {} };
      this.loadedCount = 0;
      this.totalCount = 1 + SETS.length * POSES.length;
      this.ready = false;
    }

    loadAll(onProgress) {
      return new Promise((resolve) => {
        const doneOne = () => {
          this.loadedCount++;
          if (onProgress) onProgress(this.loadedCount / this.totalCount);
          if (this.loadedCount >= this.totalCount) {
            this.ready = true;
            resolve();
          }
        };

        const loadImg = (src, assign) => {
          const img = new Image();
          img.onload = () => {
            assign(img);
            doneOne();
          };
          img.onerror = () => {
            assign(null);
            doneOne();
          };
          img.src = src;
        };

        loadImg('./assets/stage_bg.jpg', (img) => {
          this.stageBg = img;
        });

        for (const set of SETS) {
          for (const pose of POSES) {
            loadImg(`./assets/fighters/${set}/${pose}.png`, (img) => {
              this.sprites[set][pose] = img;
            });
          }
        }
      });
    }

    getPose(spriteSet, pose) {
      const set = this.sprites[spriteSet] || this.sprites.taro;
      return set[pose] || set.idle || null;
    }
  }

  window.NanJ = window.NanJ || {};
  window.NanJ.sprites = new SpriteManager();
})();
