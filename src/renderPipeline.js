import { ParallaxBarrierEffect } from 'three/addons/effects/ParallaxBarrierEffect.js';

export class RenderPipeline {
  constructor(renderer, { pixelRatioLimit = 1.75, effectDprCap = 1.35 } = {}) {
    this.renderer = renderer;
    this.pixelRatioLimit = pixelRatioLimit;
    this.effectDprCap = effectDprCap;
    this.barrierEnabled = false;
    this.effect = null;
    this.width = 2;
    this.height = 2;
    this.currentDpr = 1;
  }

  ensureEffect() {
    if (!this.effect) this.effect = new ParallaxBarrierEffect(this.renderer);
    return this.effect;
  }

  setBarrierEnabled(enabled) {
    this.barrierEnabled = Boolean(enabled);
  }

  resize(width, height, {
    devicePixelRatio = globalThis.devicePixelRatio || 1,
    pixelRatioLimit = this.pixelRatioLimit,
    effectDprCap = this.effectDprCap,
  } = {}) {
    this.width = Math.max(2, width || 2);
    this.height = Math.max(2, height || 2);
    this.pixelRatioLimit = pixelRatioLimit;
    this.effectDprCap = effectDprCap;
    this.currentDpr = Math.min(devicePixelRatio || 1, this.barrierEnabled ? effectDprCap : pixelRatioLimit);
    this.renderer.setPixelRatio(this.currentDpr);

    if (this.barrierEnabled) {
      this.ensureEffect().setSize(this.width, this.height);
      this.renderer.domElement.style.width = '';
      this.renderer.domElement.style.height = '';
      return;
    }

    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = '';
    this.renderer.domElement.style.height = '';
  }

  render(scene, camera) {
    if (this.barrierEnabled) {
      this.ensureEffect().render(scene, camera);
      return;
    }

    this.renderer.render(scene, camera);
  }

  getMode() {
    return this.barrierEnabled ? 'parallax-barrier' : 'standard';
  }

  dispose() {
    this.effect?.dispose?.();
    this.effect = null;
  }
}
