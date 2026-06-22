import * as THREE from 'three';
import { ParallaxBarrierEffect } from 'three/addons/effects/ParallaxBarrierEffect.js';
import {
  BUBBLE_GEOMETRY_RADIUS,
  MEMORY_CLOUD_LAYOUT,
  createMemoryCloudLayout,
  projectBubbleToScreen,
} from './bubbleLayout.js';
import {
  DEFAULT_MOTION_PRESET,
  DEFAULT_VIEW_MODE,
  MOTION_PRESET_LABELS,
  VIEW_MODE_LABELS,
  dampFactor,
  getMotionPreset,
  getViewMode,
  isMotionPresetName,
  isViewModeName,
} from './bubbleMotionConfig.js';

const DEFAULT_MAX_PREVIEW_VIDEOS = 3;
const FOCUS_DURATION = 780;
const EXIT_DURATION = 560;
const REDUCED_MOTION_DURATION = 120;
const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 720;
const CAMERA_HOME = new THREE.Vector3(0, 0, 3);
const LAYOUT_REFLOW_DEBOUNCE_MS = 140;
const LAYOUT_REFLOW_DURATION = 620;
const TWO_PI = Math.PI * 2;
const DEPTH_ORDER = Object.freeze({ near: 0, mid: 1, far: 2 });
const UI_AVOID_SELECTORS = [
  '.brand-chip',
  '.desktop-actions',
  '.mobile-action-bar',
  '.settings-panel:not([hidden])',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

export class MemoryBubbleScene {
  constructor({ canvas, onPick, onHoverChange, onRenderStatus, rendererProfile = {} }) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.onHoverChange = onHoverChange;
    this.onRenderStatus = onRenderStatus;
    this.pixelRatioLimit = rendererProfile.pixelRatioLimit ?? 1.75;
    this.maxPreviewVideos = rendererProfile.maxPreviewVideos ?? DEFAULT_MAX_PREVIEW_VIDEOS;
    this.mouseX = 0;
    this.mouseY = 0;
    this.windowHalfX = window.innerWidth / 2;
    this.windowHalfY = window.innerHeight / 2;
    this.pointer = new THREE.Vector2(-100000, -100000);
    this.raycaster = new THREE.Raycaster();
    this.spheres = [];
    this.memorySpheres = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.cubeTextureLoader = new THREE.CubeTextureLoader();
    this.focusedId = null;
    this.activeFocusId = null;
    this.hoveredId = null;
    this.parallaxEnabled = true;
    this.reducedMotion = false;
    this.pageVisible = true;
    this.bubbleScale = 1;
    this.focusAmount = 0;
    this.focusTransition = null;
    this.transitionToken = 0;
    this.lastFrameTime = performance.now();
    this.customBackgroundTexture = null;
    this.customEnvironmentTexture = null;
    this.customCubeTexture = null;
    this.pointerDown = null;
    this.viewDirty = false;
    this.layoutMode = MEMORY_CLOUD_LAYOUT;
    this.layoutSeed = 'memory-bubbles';
    this.currentMemories = [];
    this.layoutMetrics = null;
    this.layoutResizeTimer = 0;
    this.motionPresetName = DEFAULT_MOTION_PRESET;
    this.motionPreset = getMotionPreset(this.motionPresetName);
    this.viewModeName = DEFAULT_VIEW_MODE;
    this.viewMode = getViewMode(this.viewModeName);
    this.motionElapsed = 0;
    this.motionFrame = 0;
    this.motionScreens = [];
    this.motionSampleAt = 0;
    this.cameraParallaxOffset = new THREE.Vector3();
    this.cameraLookOffset = new THREE.Vector3();
    this.cameraRotationOffset = new THREE.Vector2();
    this.layoutDebug = Boolean(
      import.meta.env?.DEV &&
      globalThis.location &&
      new URLSearchParams(globalThis.location.search).get('layoutDebug') === '1',
    );
    this.motionDebug = Boolean(
      import.meta.env?.DEV &&
      globalThis.location &&
      new URLSearchParams(globalThis.location.search).get('motionDebug') === '1',
    );
    this.debugCanvas = null;

    this.tmpNormalPosition = new THREE.Vector3();
    this.tmpFocusTarget = new THREE.Vector3();
    this.tmpCameraDirection = new THREE.Vector3();
    this.tmpMacroOffset = new THREE.Vector3();
    this.tmpMicroOffset = new THREE.Vector3();
    this.tmpGlobalFlowOffset = new THREE.Vector3();
    this.tmpBoundaryOffset = new THREE.Vector3();
    this.tmpMotionTarget = new THREE.Vector3();
    this.tmpProjected = new THREE.Vector3();
    this.tmpScreenOffset = new THREE.Vector2();
    this.tmpSeparationOffset = new THREE.Vector3();
    this.tmpCameraRight = new THREE.Vector3();
    this.tmpCameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
    this.camera.position.copy(CAMERA_HOME);

    this.defaultBackgroundTexture = this.textureLoader.load('textures/panorama/pond-bridge-night.jpg');
    this.defaultBackgroundTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.defaultBackgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.currentEnvMap = this.defaultBackgroundTexture;

    this.scene = new THREE.Scene();
    this.scene.background = this.defaultBackgroundTexture;
    this.scene.fog = new THREE.FogExp2(0x020403, 0.022);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: rendererProfile.antialias ?? true,
      alpha: false,
      powerPreference: rendererProfile.powerPreference ?? 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioLimit));
    this.renderer.setAnimationLoop((time) => this.animate(time));

    this.effect = new ParallaxBarrierEffect(this.renderer);
    this.geometry = new THREE.SphereGeometry(BUBBLE_GEOMETRY_RADIUS, 40, 24);
    if (this.layoutDebug || this.motionDebug) this.debugCanvas = this.createDebugCanvas();
    if (import.meta.env?.DEV) globalThis.__memoryBubbleScene = this;

    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    this.handlePointerMove = (event) => {
      this.mouseX = clamp((event.clientX - this.windowHalfX) / Math.max(this.windowHalfX, 1), -1, 1);
      this.mouseY = clamp((event.clientY - this.windowHalfY) / Math.max(this.windowHalfY, 1), -1, 1);

      if (this.pointerDown && event.pointerId === this.pointerDown.pointerId) {
        const distance = Math.hypot(
          event.clientX - this.pointerDown.x,
          event.clientY - this.pointerDown.y,
        );
        if (distance > DRAG_THRESHOLD) this.pointerDown.dragging = true;
      }

      if (event.pointerType !== 'mouse' || this.focusAmount > 0.01) {
        this.setHoveredBubble(null);
        return;
      }

      if (this.updatePointerFromEvent(event)) {
        this.pickHoverBubble(event);
      } else {
        this.clearPickPosition();
        this.setHoveredBubble(null);
      }
    };

    this.handlePointerLeave = () => {
      this.mouseX = 0;
      this.mouseY = 0;
      this.clearPickPosition();
      this.setHoveredBubble(null);
    };

    this.handlePointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;

      this.updatePointerFromEvent(event);
      const hit = this.focusAmount <= 0.01 ? this.getInteractiveHit() : null;
      this.pointerDown = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now(),
        dragging: false,
        memoryId: hit?.object.userData.memoryId ?? null,
      };

      this.canvas.setPointerCapture?.(event.pointerId);
    };

    this.handlePointerUp = (event) => {
      if (!this.pointerDown || event.pointerId !== this.pointerDown.pointerId) return;

      this.canvas.releasePointerCapture?.(event.pointerId);
      const pointerDown = this.pointerDown;
      this.pointerDown = null;

      const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      const duration = performance.now() - pointerDown.startedAt;
      const isClick = distance <= DRAG_THRESHOLD && duration <= LONG_PRESS_MS && !pointerDown.dragging;

      if (!isClick || this.focusAmount > 0.01) return;

      this.updatePointerFromEvent(event);
      this.pickBubble(pointerDown.memoryId);
    };

    this.handlePointerCancel = (event) => {
      if (this.pointerDown?.pointerId === event.pointerId) this.pointerDown = null;
      this.setHoveredBubble(null);
    };

    this.handleResize = () => this.resize();
    this.handleContextLost = (event) => {
      event.preventDefault();
      this.pageVisible = false;
      this.memorySpheres.forEach((sphere) => {
        sphere.userData.video?.pause();
      });
      this.onRenderStatus?.({ status: 'lost' });
    };
    this.handleContextRestored = () => {
      this.pageVisible = document.visibilityState === 'visible';
      this.resize();
      if (this.currentMemories.length > 0) {
        this.setMemories(this.currentMemories, this.layoutSeed);
      }
      this.onRenderStatus?.({ status: 'restored' });
    };

    document.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    window.addEventListener('blur', this.handlePointerLeave);
    window.addEventListener('resize', this.handleResize);
  }

  clearPickPosition() {
    this.pointer.set(-100000, -100000);
  }

  updatePointerFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inside || rect.width <= 0 || rect.height <= 0) return false;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.pointer.set(x * 2 - 1, -y * 2 + 1);
    return true;
  }

  createDebugCanvas() {
    const debugCanvas = document.createElement('canvas');
    debugCanvas.setAttribute('aria-hidden', 'true');
    debugCanvas.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:20',
      'mix-blend-mode:screen',
    ].join(';');
    this.canvas.parentElement?.append(debugCanvas);
    return debugCanvas;
  }

  getViewport() {
    return {
      width: this.canvas.clientWidth || window.innerWidth || 2,
      height: this.canvas.clientHeight || window.innerHeight || 2,
    };
  }

  getUiAvoidRects() {
    const canvasRect = this.canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return [];

    const padding = clamp(Math.min(canvasRect.width, canvasRect.height) * 0.018, 10, 28);
    const rects = [];

    UI_AVOID_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement) || element.hidden) return;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;

        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left - canvasRect.left - padding);
        const top = Math.max(0, rect.top - canvasRect.top - padding);
        const right = Math.min(canvasRect.width, rect.right - canvasRect.left + padding);
        const bottom = Math.min(canvasRect.height, rect.bottom - canvasRect.top + padding);
        if (right <= left || bottom <= top) return;

        rects.push({
          left,
          top,
          right,
          bottom,
          weight: selector.includes('settings') ? 1.3 : 1,
        });
      });
    });

    return rects;
  }

  createLayout(memories) {
    return createMemoryCloudLayout({
      memories,
      camera: this.camera,
      viewport: this.getViewport(),
      seed: this.layoutSeed,
      avoidRects: this.getUiAvoidRects(),
      geometryRadius: BUBBLE_GEOMETRY_RADIUS,
    });
  }

  applyBubbleLayout(layoutResult, { immediate = false } = {}) {
    const byId = new Map(layoutResult.items.map((item) => [item.memoryId, item]));
    const now = performance.now();

    this.layoutMetrics = layoutResult.metrics;
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      const item = byId.get(data.memoryId);
      if (!item) return;

      if (!data.anchorPosition || immediate) {
        data.anchorPosition = item.anchorPosition.clone();
        data.homeAnchor = item.homeAnchor?.clone() ?? item.anchorPosition.clone();
        data.anchorStart = item.anchorPosition.clone();
        data.anchorTarget = item.anchorPosition.clone();
        data.currentPosition = item.currentPosition.clone();
        data.roamingTarget = item.roamingTarget?.clone() ?? item.anchorPosition.clone();
        data.motionTarget = item.currentPosition.clone();
        data.separationOffset = item.separationOffset?.clone() ?? new THREE.Vector3();
        data.separationTargetOffset = new THREE.Vector3();
        data.interactionOffset = item.interactionOffset?.clone() ?? new THREE.Vector3();
        data.macroOffset = new THREE.Vector3();
        data.macroAmplitude = new THREE.Vector3();
        data.microDriftOffset = new THREE.Vector3();
        data.boundaryOffset = new THREE.Vector3();
        data.radius = item.radius;
        data.baseScale = item.baseScale;
        data.baseScaleStart = item.baseScale;
        data.baseScaleTarget = item.baseScale;
        data.layoutTransition = null;
        sphere.position.copy(item.anchorPosition);
      } else {
        data.anchorStart.copy(data.anchorPosition);
        data.anchorTarget.copy(item.anchorPosition);
        data.baseScaleStart = data.baseScale;
        data.baseScaleTarget = item.baseScale;
        data.layoutTransition = {
          startedAt: now,
          duration: this.reducedMotion ? REDUCED_MOTION_DURATION : LAYOUT_REFLOW_DURATION,
        };
      }

      data.layout = item.layout;
      data.layoutSeed = item.layoutSeed;
      data.depthBand = item.depthBand;
      data.sizeBucket = item.sizeBucket;
      data.depth = item.depth;
      data.radius = item.radius;
      data.homeAnchor ??= data.anchorPosition.clone();
      data.homeAnchor.copy(data.anchorPosition);
      data.home = data.homeAnchor;
      data.motionProfile = item.motionProfile ?? data.motionProfile;
      data.driftAmplitude.copy(item.driftAmplitude);
      data.driftFrequency.copy(item.driftFrequency);
      data.driftPhase.copy(item.driftPhase);
      data.driftSecondaryPhase.copy(item.driftSecondaryPhase);
      if (data.driftTime == null || immediate) data.driftTime = item.driftTime;
      data.debugColor = item.debugColor;
      data.region = item.region;
      data.screen = item.screen;
    });
  }

  reflowBubbleLayout({ immediate = false } = {}) {
    if (this.spheres.length === 0) return;
    const memories = this.spheres.map((sphere) => sphere.userData.memory);
    const layoutResult = this.createLayout(memories);
    this.applyBubbleLayout(layoutResult, { immediate });
  }

  scheduleLayoutReflow() {
    window.clearTimeout(this.layoutResizeTimer);
    if (this.spheres.length === 0) return;
    this.layoutResizeTimer = window.setTimeout(() => {
      this.reflowBubbleLayout({ immediate: false });
    }, LAYOUT_REFLOW_DEBOUNCE_MS);
  }

  resize() {
    this.windowHalfX = window.innerWidth / 2;
    this.windowHalfY = window.innerHeight / 2;

    const { width, height } = this.getViewport();

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioLimit));
    this.renderer.setSize(width, height, false);
    this.effect.setSize(width, height);
    this.updateFlatBackgroundTransform();
    this.scheduleLayoutReflow();
  }

  setMemories(memories, seed = 'memory-bubbles') {
    this.currentMemories = Array.from(memories ?? []);
    this.clearBubbles();
    this.layoutSeed = seed;
    this.focusedId = null;
    this.activeFocusId = null;
    this.focusAmount = 0;
    this.cancelTransition(false);

    const layoutResult = this.createLayout(memories);
    const layoutById = new Map(layoutResult.items.map((item) => [item.memoryId, item]));
    this.layoutMetrics = layoutResult.metrics;

    memories.forEach((memory, memoryIndex) => {
      const layoutItem = layoutById.get(memory.id);
      const { texture, video } = this.createTexture(memory);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: texture,
        envMap: this.currentEnvMap,
        combine: THREE.MixOperation,
        reflectivity: 0.52,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      });

      const sphere = new THREE.Mesh(this.geometry, material);
      const home = layoutItem?.anchorPosition ?? new THREE.Vector3(0, 0, -1.6);
      const baseScale = layoutItem?.baseScale ?? 2;

      const aura = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({
          color: 0xa8ffd0,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );
      aura.scale.setScalar(1.08);
      aura.raycast = () => {};
      sphere.add(aura);

      sphere.position.copy(home);
      sphere.scale.setScalar(this.getDisplayScale(baseScale));
      sphere.userData = {
        index: memoryIndex,
        layout: layoutItem?.layout ?? MEMORY_CLOUD_LAYOUT,
        layoutSeed: layoutItem?.layoutSeed ?? `${MEMORY_CLOUD_LAYOUT}:${seed}`,
        baseScale,
        baseScaleStart: baseScale,
        baseScaleTarget: baseScale,
        radius: layoutItem?.radius ?? baseScale * BUBBLE_GEOMETRY_RADIUS,
        depth: layoutItem?.depth ?? 1.6,
        depthBand: layoutItem?.depthBand ?? 'mid',
        sizeBucket: layoutItem?.sizeBucket ?? 'normal',
        memoryId: memory.id,
        pulse: 0,
        hover: 0,
        hoverMotion: 0,
        video,
        texture,
        ownedMaterial: material,
        aura,
        auraMaterial: aura.material,
        memory,
        home,
        homeAnchor: home.clone(),
        anchorPosition: home.clone(),
        anchorStart: home.clone(),
        anchorTarget: home.clone(),
        currentPosition: home.clone(),
        roamingTarget: layoutItem?.roamingTarget?.clone() ?? home.clone(),
        motionTarget: home.clone(),
        separationOffset: layoutItem?.separationOffset?.clone() ?? new THREE.Vector3(),
        separationTargetOffset: new THREE.Vector3(),
        interactionOffset: layoutItem?.interactionOffset?.clone() ?? new THREE.Vector3(),
        macroOffset: new THREE.Vector3(),
        macroAmplitude: new THREE.Vector3(),
        microDriftOffset: new THREE.Vector3(),
        boundaryOffset: new THREE.Vector3(),
        motionProfile: layoutItem?.motionProfile ?? null,
        motionTime: layoutItem?.motionProfile?.timeOffset ?? 0,
        screenSpeed: 0,
        screenDisplacementWindow: 0,
        screenSamples: [],
        driftAmplitude: layoutItem?.driftAmplitude?.clone() ?? new THREE.Vector3(0.08, 0.06, 0.04),
        driftFrequency: layoutItem?.driftFrequency?.clone() ?? new THREE.Vector3(0.42, 0.36, 0.28),
        driftPhase: layoutItem?.driftPhase?.clone() ?? new THREE.Vector3(),
        driftSecondaryPhase: layoutItem?.driftSecondaryPhase?.clone() ?? new THREE.Vector3(),
        driftTime: layoutItem?.driftTime ?? 0,
        layoutTransition: null,
        debugColor: layoutItem?.debugColor ?? '#ffffff',
        region: layoutItem?.region ?? 'center',
        screen: layoutItem?.screen ?? null,
        isFocused: false,
        isHovered: false,
      };

      this.scene.add(sphere);
      this.spheres.push(sphere);
      this.memorySpheres.set(memory.id, sphere);
    });

    this.refreshPreviewPlayback();
  }

  createTexture(memory) {
    if (memory.kind === 'video') {
      const video = document.createElement('video');
      video.src = memory.previewSource || memory.source;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'metadata';

      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      return { texture, video };
    }

    const texture = this.textureLoader.load(memory.previewSource || memory.source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return { texture, video: null };
  }

  getInteractiveHit() {
    if (this.spheres.length === 0) return null;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.spheres, false);
    return hits.find((entry) => entry.object.userData.memoryId) ?? null;
  }

  pickHoverBubble(event) {
    const hit = this.getInteractiveHit();
    const memoryId = hit?.object.userData.memoryId ?? null;
    this.setHoveredBubble(memoryId, event);
  }

  setHoveredBubble(memoryId, event) {
    if (this.hoveredId === memoryId && memoryId) {
      const sphere = this.memorySpheres.get(memoryId);
      this.onHoverChange?.(sphere?.userData.memory ?? null, {
        x: event?.clientX ?? 0,
        y: event?.clientY ?? 0,
      });
      return;
    }

    this.hoveredId = memoryId;
    this.canvas.style.cursor = memoryId ? 'pointer' : '';

    const sphere = memoryId ? this.memorySpheres.get(memoryId) : null;
    this.onHoverChange?.(sphere?.userData.memory ?? null, memoryId ? {
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
    } : null);
  }

  pickBubble(memoryId = null) {
    const hit = memoryId ? null : this.getInteractiveHit();
    const sphere = memoryId ? this.memorySpheres.get(memoryId) : hit?.object;
    if (!sphere) return;

    sphere.userData.pulse = 1;
    this.onPick?.(sphere.userData.memory);
  }

  pulseMemory(memoryId) {
    const sphere = this.memorySpheres.get(memoryId);
    if (sphere) sphere.userData.pulse = 1;
  }

  focusBubble(memoryId) {
    const sphere = this.memorySpheres.get(memoryId);
    if (!sphere) return Promise.resolve(false);

    this.setHoveredBubble(null);
    this.cancelTransition(false);
    this.transitionToken += 1;
    const transitionId = this.transitionToken;
    this.focusedId = memoryId;
    this.activeFocusId = memoryId;
    sphere.userData.focusStartPosition = sphere.position.clone();
    sphere.userData.currentPosition.copy(sphere.position);
    this.refreshPreviewPlayback();

    return this.startTransition({
      transitionId,
      from: this.focusAmount,
      to: 1,
      duration: this.reducedMotion ? REDUCED_MOTION_DURATION : FOCUS_DURATION,
    });
  }

  clearFocus({ immediate = false } = {}) {
    if (!this.activeFocusId && this.focusAmount <= 0.001) {
      this.focusedId = null;
      this.refreshPreviewPlayback();
      return Promise.resolve(true);
    }

    this.cancelTransition(false);
    this.transitionToken += 1;
    const transitionId = this.transitionToken;

    if (immediate) {
      this.focusAmount = 0;
      this.focusedId = null;
      this.activeFocusId = null;
      this.refreshPreviewPlayback();
      return Promise.resolve(true);
    }

    return this.startTransition({
      transitionId,
      from: this.focusAmount,
      to: 0,
      duration: this.reducedMotion ? REDUCED_MOTION_DURATION : EXIT_DURATION,
      onDone: () => {
        this.focusedId = null;
        this.activeFocusId = null;
        this.refreshPreviewPlayback();
      },
    });
  }

  startTransition({ transitionId, from, to, duration, onDone }) {
    return new Promise((resolve) => {
      this.focusTransition = {
        transitionId,
        from,
        to,
        duration,
        startedAt: performance.now(),
        resolve,
        onDone,
      };
    });
  }

  cancelTransition(result) {
    if (!this.focusTransition) return;
    this.focusTransition.resolve(result);
    this.focusTransition = null;
  }

  setFocus(focusedId) {
    if (focusedId) {
      void this.focusBubble(focusedId);
      return;
    }

    void this.clearFocus({ immediate: true });
  }

  setParallaxMode(enabled) {
    this.parallaxEnabled = Boolean(enabled);
    this.viewDirty = true;
  }

  setMotionPreset(name) {
    if (!isMotionPresetName(name)) return false;
    this.motionPresetName = name;
    this.motionPreset = getMotionPreset(name);
    this.viewDirty = true;
    return true;
  }

  setViewMode(name) {
    if (!isViewModeName(name)) return false;
    this.viewModeName = name;
    this.viewMode = getViewMode(name);
    this.viewDirty = true;
    return true;
  }

  getMotionPresetLabel() {
    return MOTION_PRESET_LABELS[this.motionPresetName] ?? this.motionPresetName;
  }

  getViewModeLabel() {
    return VIEW_MODE_LABELS[this.viewModeName] ?? this.viewModeName;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    if (this.reducedMotion) {
      this.mouseX = 0;
      this.mouseY = 0;
      this.setHoveredBubble(null);
    }
  }

  setPageVisible(isVisible) {
    this.pageVisible = Boolean(isVisible);
    if (this.pageVisible) {
      this.refreshPreviewPlayback();
      return;
    }

    this.memorySpheres.forEach((sphere) => {
      sphere.userData.video?.pause();
    });
  }

  setPanoramaBackground(source) {
    this.disposeCustomBackground();
    this.customEnvironmentTexture = this.textureLoader.load(source, () => {
      this.customEnvironmentTexture.mapping = THREE.EquirectangularReflectionMapping;
      this.customEnvironmentTexture.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.customEnvironmentTexture;
      this.currentEnvMap = this.customEnvironmentTexture;
      this.updateSphereEnvironmentMap();
    });
    this.viewDirty = true;
  }

  setCubeBackground(sources) {
    this.disposeCustomBackground();
    const cubeTexture = this.cubeTextureLoader.load(sources, () => {
      if (this.customCubeTexture !== cubeTexture) return;
      this.scene.background = cubeTexture;
      this.currentEnvMap = cubeTexture;
      this.updateSphereEnvironmentMap();
      this.viewDirty = true;
    });
    cubeTexture.colorSpace = THREE.SRGBColorSpace;
    this.customCubeTexture = cubeTexture;
    this.scene.background = cubeTexture;
    this.currentEnvMap = cubeTexture;
    this.updateSphereEnvironmentMap();
    this.viewDirty = true;
  }

  getMaxTextureSize() {
    return this.renderer.capabilities.maxTextureSize;
  }

  setFlatBackgroundImage(source) {
    this.disposeCustomBackground();
    this.customBackgroundTexture = this.textureLoader.load(source, () => {
      this.customBackgroundTexture.colorSpace = THREE.SRGBColorSpace;
      this.customBackgroundTexture.mapping = THREE.UVMapping;
      this.customBackgroundTexture.minFilter = THREE.LinearFilter;
      this.customBackgroundTexture.magFilter = THREE.LinearFilter;
      this.scene.background = this.customBackgroundTexture;
      this.currentEnvMap = null;
      this.updateFlatBackgroundTransform();
      this.updateSphereEnvironmentMap();
    });
    this.viewDirty = true;
  }

  resetBackground() {
    this.disposeCustomBackground();
    this.currentEnvMap = this.defaultBackgroundTexture;
    this.scene.background = this.defaultBackgroundTexture;
    this.updateSphereEnvironmentMap();
    this.viewDirty = true;
  }

  disposeCustomBackground() {
    if (this.customBackgroundTexture) {
      this.customBackgroundTexture.dispose();
      this.customBackgroundTexture = null;
    }

    if (this.customEnvironmentTexture) {
      this.customEnvironmentTexture.dispose();
      this.customEnvironmentTexture = null;
    }

    if (this.customCubeTexture) {
      this.customCubeTexture.dispose();
      this.customCubeTexture = null;
    }
  }

  updateFlatBackgroundTransform() {
    if (this.scene.background !== this.customBackgroundTexture || !this.customBackgroundTexture?.image) {
      return;
    }

    const canvasWidth = this.canvas.clientWidth || window.innerWidth || 1;
    const canvasHeight = this.canvas.clientHeight || window.innerHeight || 1;
    const canvasAspect = canvasWidth / Math.max(canvasHeight, 1);
    const imageAspect = this.customBackgroundTexture.image.width / this.customBackgroundTexture.image.height;
    const aspect = imageAspect / canvasAspect;

    this.customBackgroundTexture.offset.x = aspect > 1 ? (1 - 1 / aspect) / 2 : 0;
    this.customBackgroundTexture.repeat.x = aspect > 1 ? 1 / aspect : 1;
    this.customBackgroundTexture.offset.y = aspect > 1 ? 0 : (1 - aspect) / 2;
    this.customBackgroundTexture.repeat.y = aspect > 1 ? 1 : aspect;
  }

  updateSphereEnvironmentMap() {
    this.spheres.forEach((sphere) => {
      sphere.material.envMap = this.currentEnvMap;
      sphere.material.needsUpdate = true;
    });
  }

  setBubbleScale(scale) {
    const nextScale = Number(scale);
    this.bubbleScale = Number.isFinite(nextScale) ? Math.max(0.35, Math.min(nextScale, 3)) : 1;
    this.spheres.forEach((sphere) => {
      sphere.scale.setScalar(this.getDisplayScale(sphere.userData.baseScale, sphere.userData.pulse));
    });
    this.viewDirty = true;
  }

  getDisplayScale(baseScale, pulse = 0, hover = 0, focus = 0) {
    return baseScale * this.bubbleScale * (1 + pulse * 0.2 + hover * 0.06 + focus * 1.28);
  }

  refreshPreviewPlayback() {
    let playing = 0;
    this.memorySpheres.forEach((sphere) => {
      const { video } = sphere.userData;
      if (!video) return;

      const shouldPlay =
        this.pageVisible &&
        !this.focusedId &&
        !this.reducedMotion &&
        playing < this.maxPreviewVideos;

      if (shouldPlay) {
        playing += 1;
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }

  clearBubbles() {
    window.clearTimeout(this.layoutResizeTimer);
    this.spheres.forEach((sphere) => {
      const { video, texture, ownedMaterial, auraMaterial } = sphere.userData;
      video?.pause();
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      texture?.dispose?.();
      auraMaterial?.dispose?.();
      ownedMaterial?.dispose?.();
      this.scene.remove(sphere);
    });

    this.spheres = [];
    this.memorySpheres.clear();
    this.layoutMetrics = null;
    this.setHoveredBubble(null);
  }

  getFocusTarget() {
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.tmpCameraDirection);
    return this.tmpFocusTarget.copy(this.camera.position).addScaledVector(this.tmpCameraDirection, 1.32);
  }

  updateTransition(now) {
    if (!this.focusTransition) return;

    const transition = this.focusTransition;
    const rawProgress = transition.duration <= 0 ? 1 : (now - transition.startedAt) / transition.duration;
    const progress = easeInOutCubic(rawProgress);
    this.focusAmount = lerp(transition.from, transition.to, progress);

    if (rawProgress < 1) return;

    this.focusAmount = transition.to;
    this.focusTransition = null;
    transition.onDone?.();
    transition.resolve(true);
  }

  updateAnchorTransition(data, now) {
    if (!data.layoutTransition) return;

    const { startedAt, duration } = data.layoutTransition;
    const rawProgress = duration <= 0 ? 1 : (now - startedAt) / duration;
    const progress = easeInOutCubic(rawProgress);
    data.anchorPosition.lerpVectors(data.anchorStart, data.anchorTarget, progress);
    data.homeAnchor.copy(data.anchorPosition);
    data.home = data.homeAnchor;
    data.baseScale = lerp(data.baseScaleStart, data.baseScaleTarget, progress);

    if (rawProgress < 1) return;

    data.anchorPosition.copy(data.anchorTarget);
    data.homeAnchor.copy(data.anchorPosition);
    data.home = data.homeAnchor;
    data.baseScale = data.baseScaleTarget;
    data.layoutTransition = null;
  }

  getMotionViewport() {
    const viewport = this.getViewport();
    return {
      ...viewport,
      shortSide: Math.min(viewport.width, viewport.height),
      isMobile: viewport.width < 700 || viewport.height > viewport.width * 1.35,
    };
  }

  getMotionDepth(data) {
    return Math.max(0.72, data.depth ?? CAMERA_HOME.z - (data.homeAnchor?.z ?? data.anchorPosition?.z ?? 0));
  }

  getVisibleHalfSizeAtDepth(depth) {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * depth;
    return {
      halfWidth: halfHeight * this.camera.aspect,
      halfHeight,
    };
  }

  getBubbleMotionScale({ data, isFocused, focusActive, isPointerLocked }) {
    const preset = this.motionPreset;
    let amplitudeScale = preset.intensity;
    let timeScale = 1;

    if (focusActive && !isFocused) {
      amplitudeScale *= preset.focus.backgroundMotionScale;
      timeScale *= preset.focus.backgroundMotionScale;
    }

    if (isPointerLocked || data.hoverMotion > 0.001) {
      const hoverScale = lerp(1, preset.hoverSlowdown.motionScale, data.hoverMotion);
      amplitudeScale *= hoverScale;
      timeScale *= hoverScale;
    }

    if (this.reducedMotion) {
      amplitudeScale *= preset.reducedMotion.macroAmplitudeScale;
      timeScale *= 0.36;
    }

    return { amplitudeScale, timeScale };
  }

  updateCameraParallax(delta, focusActive) {
    const viewport = this.getMotionViewport();
    const preset = this.motionPreset.cameraParallax;
    const viewMode = this.viewMode;
    const useParallax =
      this.parallaxEnabled &&
      !this.reducedMotion &&
      !focusActive &&
      this.pageVisible &&
      !viewport.isMobile;
    const depth = CAMERA_HOME.z;
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    const targetX = useParallax ? this.mouseX * halfWidth * preset.ndcX * viewMode.translationScale : 0;
    const targetY = useParallax ? -this.mouseY * halfHeight * preset.ndcY * viewMode.translationScale : 0;
    const targetLookX = useParallax ? -this.mouseX * halfWidth * preset.lookNdcX : 0;
    const targetLookY = useParallax ? this.mouseY * halfHeight * preset.lookNdcY : 0;
    const targetYaw = useParallax && viewMode.type === 'directRotation'
      ? -THREE.MathUtils.degToRad(viewMode.yawDegrees) * this.mouseX
      : 0;
    const targetPitch = useParallax && viewMode.type === 'directRotation'
      ? -THREE.MathUtils.degToRad(viewMode.pitchDegrees) * this.mouseY
      : 0;
    const cameraEase = dampFactor(this.reducedMotion ? 8 : preset.damping, delta);
    const lookEase = dampFactor(this.reducedMotion ? 8 : preset.lookDamping, delta);

    this.cameraParallaxOffset.x += (targetX - this.cameraParallaxOffset.x) * cameraEase;
    this.cameraParallaxOffset.y += (targetY - this.cameraParallaxOffset.y) * cameraEase;
    this.cameraParallaxOffset.z += (0 - this.cameraParallaxOffset.z) * cameraEase;
    this.cameraLookOffset.x += ((viewMode.type === 'lookAt' ? targetLookX : 0) - this.cameraLookOffset.x) * lookEase;
    this.cameraLookOffset.y += ((viewMode.type === 'lookAt' ? targetLookY : 0) - this.cameraLookOffset.y) * lookEase;
    this.cameraLookOffset.z += (0 - this.cameraLookOffset.z) * lookEase;
    this.cameraRotationOffset.x += (targetYaw - this.cameraRotationOffset.x) * lookEase;
    this.cameraRotationOffset.y += (targetPitch - this.cameraRotationOffset.y) * lookEase;

    this.camera.position.copy(CAMERA_HOME).add(this.cameraParallaxOffset);
    if (viewMode.type === 'directRotation') {
      this.tmpCameraEuler.set(this.cameraRotationOffset.y, this.cameraRotationOffset.x, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(this.tmpCameraEuler);
    } else {
      this.tmpFocusTarget.copy(this.scene.position).add(this.cameraLookOffset);
      this.camera.lookAt(this.tmpFocusTarget);
    }
    this.camera.updateMatrixWorld();
  }

  updateMacroRoaming(data, target, { amplitudeScale, viewport }) {
    const profile = data.motionProfile;
    const band = this.motionPreset.bands[data.depthBand] ?? this.motionPreset.bands.mid;
    if (!profile || !band) {
      data.macroOffset.set(0, 0, 0);
      data.macroAmplitude.set(0, 0, 0);
      target.copy(data.homeAnchor ?? data.anchorPosition);
      data.roamingTarget.copy(target);
      return target;
    }

    const depth = this.getMotionDepth(data);
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    const mobileScale = viewport.isMobile ? this.motionPreset.mobileAmplitudeScale : 1;
    const reducedDepthScale = this.reducedMotion ? this.motionPreset.reducedMotion.depthScale : 1;
    const finalScale = amplitudeScale * mobileScale;
    const ampX = halfWidth * lerp(band.ndcX[0], band.ndcX[1], profile.amplitudeMix.x) * finalScale;
    const ampY = halfHeight * lerp(band.ndcY[0], band.ndcY[1], profile.amplitudeMix.y) * finalScale;
    const ampZ = depth * lerp(band.depth[0], band.depth[1], profile.amplitudeMix.z) * finalScale * reducedDepthScale;
    const periodX = lerp(band.period[0], band.period[1], profile.periodMix.x);
    const periodY = lerp(band.period[0] * 0.92, band.period[1] * 1.12, profile.periodMix.y);
    const periodZ = lerp(band.period[0] * 1.08, band.period[1] * 1.26, profile.periodMix.z);
    const t = data.motionTime;

    const macroX =
      Math.sin((t * TWO_PI) / periodX + profile.phasePrimary.x) +
      Math.sin((t * TWO_PI * profile.secondaryRate.x) / periodX + profile.phaseSecondary.x) * profile.secondaryWeight.x;
    const macroY =
      Math.cos((t * TWO_PI) / periodY + profile.phasePrimary.y) +
      Math.sin((t * TWO_PI * profile.secondaryRate.y) / periodY + profile.phaseSecondary.y) * profile.secondaryWeight.y;
    const macroZ =
      Math.sin((t * TWO_PI) / periodZ + profile.phasePrimary.z) +
      Math.cos((t * TWO_PI * profile.secondaryRate.z) / periodZ + profile.phaseSecondary.z) * profile.secondaryWeight.z;

    data.macroAmplitude.set(Math.abs(ampX), Math.abs(ampY), Math.abs(ampZ));
    data.macroOffset.set(macroX * ampX, macroY * ampY, macroZ * ampZ);

    const flow = this.motionPreset.globalFlow;
    const depthResponse = data.depthBand === 'near' ? 1.1 : data.depthBand === 'far' ? 0.72 : 0.92;
    const flowScale = profile.globalResponse * depthResponse * (viewport.isMobile ? 0.76 : 1) * (this.reducedMotion ? 0.08 : 1);
    this.tmpGlobalFlowOffset.set(
      Math.sin((this.motionElapsed * TWO_PI) / flow.periodX + profile.depthPhase) * halfWidth * flow.ndcX * flowScale,
      Math.sin((this.motionElapsed * TWO_PI) / flow.periodY + profile.phaseSecondary.y) * halfHeight * flow.ndcY * flowScale,
      Math.sin((this.motionElapsed * TWO_PI) / flow.periodZ + profile.phaseSecondary.z) * depth * flow.depth * flowScale * reducedDepthScale,
    );

    target
      .copy(data.homeAnchor ?? data.anchorPosition)
      .add(data.macroOffset)
      .add(this.tmpGlobalFlowOffset);
    data.roamingTarget.copy(target);
    return target;
  }

  updateMicroDrift(data, target) {
    const profile = data.motionProfile;
    if (!profile) {
      target.set(0, 0, 0);
      return target;
    }

    const preset = this.motionPreset;
    const ratio = lerp(preset.microAmplitudeRatio[0], preset.microAmplitudeRatio[1], profile.microMix.x);
    const scale = this.reducedMotion ? preset.reducedMotion.microAmplitudeScale : 1;
    const period = lerp(preset.microPeriod[0], preset.microPeriod[1], profile.microMix.y);
    const t = data.motionTime;
    const ampX = Math.max(data.radius * 0.18, data.macroAmplitude.x * ratio) * scale;
    const ampY = Math.max(data.radius * 0.18, data.macroAmplitude.y * ratio) * scale;
    const ampZ = Math.max(data.radius * 0.08, data.macroAmplitude.z * ratio) * scale * (this.reducedMotion ? 0.2 : 1);

    target.set(
      (Math.sin((t * TWO_PI * profile.microRate.x) / period + profile.microPhase.x) +
        Math.sin((t * TWO_PI * 0.43) / period + profile.microSecondaryPhase.x) * profile.microWeight.x) * ampX,
      (Math.cos((t * TWO_PI * profile.microRate.y) / period + profile.microPhase.y) +
        Math.sin((t * TWO_PI * 0.39) / period + profile.microSecondaryPhase.y) * profile.microWeight.y) * ampY,
      (Math.sin((t * TWO_PI * profile.microRate.z) / period + profile.microPhase.z) +
        Math.cos((t * TWO_PI * 0.35) / period + profile.microSecondaryPhase.z) * profile.microWeight.z) * ampZ,
    );

    data.microDriftOffset.copy(target);
    return target;
  }

  updateBoundaryOffset(data, position, target) {
    const preset = this.motionPreset.boundary;
    const depth = this.getMotionDepth(data);
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    const projected = this.tmpProjected.copy(position).project(this.camera);
    const radiusScale = data.radius * this.bubbleScale;
    const limitX = 1 + preset.overscan - clamp(radiusScale / Math.max(halfWidth, 0.001), 0.035, 0.18);
    const limitY = 1 + preset.overscan - clamp(radiusScale / Math.max(halfHeight, 0.001), 0.035, 0.18);
    let correctionX = 0;
    let correctionY = 0;
    let correctionZ = 0;

    if (Math.abs(projected.x) > limitX) {
      const excess = Math.abs(projected.x) - limitX;
      correctionX = -Math.sign(projected.x) * Math.tanh(excess / 0.28) * excess * halfWidth * preset.strength;
    }

    if (Math.abs(projected.y) > limitY) {
      const excess = Math.abs(projected.y) - limitY;
      correctionY = -Math.sign(projected.y) * Math.tanh(excess / 0.28) * excess * halfHeight * preset.strength;
    }

    const cameraDepth = CAMERA_HOME.z - position.z;
    const minDepth = depth * 0.7;
    const maxDepth = depth * 1.34;
    if (cameraDepth < minDepth) correctionZ -= (minDepth - cameraDepth) * preset.strength;
    if (cameraDepth > maxDepth) correctionZ += (cameraDepth - maxDepth) * preset.strength;

    target.set(correctionX, correctionY, correctionZ);
    data.boundaryOffset.copy(target);
    return target;
  }

  updateSeparation(delta, viewport) {
    const preset = this.motionPreset.separation;
    const runSeparation = this.motionFrame % Math.max(1, preset.interval) === 0;

    if (runSeparation) {
      this.tmpCameraRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();

      for (let index = 0, total = this.spheres.length; index < total; index += 1) {
        const sphere = this.spheres[index];
        const data = sphere.userData;
        let entry = this.motionScreens[index];
        if (!entry) {
          entry = {
            center: new THREE.Vector3(),
            edge: new THREE.Vector3(),
            screenOffset: new THREE.Vector2(),
          };
          this.motionScreens[index] = entry;
        }

        const radius = Math.max(data.radius * this.bubbleScale, data.radius);
        const center = entry.center.copy(data.motionTarget).project(this.camera);
        const edge = entry.edge.copy(data.motionTarget).addScaledVector(this.tmpCameraRight, radius).project(this.camera);

        entry.sphere = sphere;
        entry.data = data;
        entry.x = (center.x * 0.5 + 0.5) * viewport.width;
        entry.y = (-center.y * 0.5 + 0.5) * viewport.height;
        entry.radius = Math.hypot(
          (edge.x * 0.5 + 0.5) * viewport.width - entry.x,
          (-edge.y * 0.5 + 0.5) * viewport.height - entry.y,
        );
        entry.depthBand = data.depthBand;
        entry.active = !data.isFocused && center.z >= -1 && center.z <= 1;
        entry.screenOffset.set(0, 0);
        data.overlapCount = 0;
        data.separationTargetOffset.set(0, 0, 0);
      }

      this.motionScreens.length = this.spheres.length;

      for (let index = 0, total = this.motionScreens.length; index < total; index += 1) {
        const first = this.motionScreens[index];
        if (!first?.active) continue;

        for (let otherIndex = index + 1; otherIndex < total; otherIndex += 1) {
          const second = this.motionScreens[otherIndex];
          if (!second?.active) continue;
          if (Math.abs((DEPTH_ORDER[first.depthBand] ?? 1) - (DEPTH_ORDER[second.depthBand] ?? 1)) > 1) continue;

          let dx = first.x - second.x;
          let dy = first.y - second.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.001) {
            const angle = (index * 12.9898 + otherIndex * 78.233) % TWO_PI;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }

          const sameDepth = first.depthBand === second.depthBand;
          const allowedOverlap = Math.min(first.radius, second.radius) * (sameDepth ? 0.72 : 1.04);
          const desiredDistance = first.radius + second.radius - allowedOverlap;
          if (distance >= desiredDistance) continue;

          const overlap = desiredDistance - distance;
          const nx = dx / distance;
          const ny = dy / distance;
          const force = overlap * preset.strength * (sameDepth ? 0.52 : 0.28);
          first.screenOffset.x += nx * force;
          first.screenOffset.y += ny * force;
          second.screenOffset.x -= nx * force;
          second.screenOffset.y -= ny * force;
          first.data.overlapCount += 1;
          second.data.overlapCount += 1;
        }
      }

      this.motionScreens.forEach((entry) => {
        if (!entry?.active) return;
        const data = entry.data;
        const maxPixels = clamp(entry.radius * 0.82, 7, viewport.shortSide * 0.055);
        if (entry.screenOffset.length() > maxPixels) entry.screenOffset.setLength(maxPixels);

        const depth = this.getMotionDepth(data);
        const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
        data.separationTargetOffset.set(
          (entry.screenOffset.x / Math.max(viewport.width, 1)) * 2 * halfWidth,
          (-entry.screenOffset.y / Math.max(viewport.height, 1)) * 2 * halfHeight,
          0,
        );

        const maxWorld = Math.max(data.radius * 0.7, data.macroAmplitude.length() * preset.maxMacroRatio);
        if (data.separationTargetOffset.length() > maxWorld) {
          data.separationTargetOffset.setLength(maxWorld);
        }
      });
    }

    const ease = dampFactor(preset.damping, delta);
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      if (data.isFocused) data.separationTargetOffset.set(0, 0, 0);
      data.separationOffset.lerp(data.separationTargetOffset, ease);
    });
  }

  sampleMotionDebug(time, viewport) {
    if (!this.motionDebug || time - this.motionSampleAt < 250) return;
    this.motionSampleAt = time;

    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      const screen = projectBubbleToScreen({
        position: sphere.position,
        radius: Math.max(data.radius * this.bubbleScale, data.radius),
        camera: this.camera,
        viewport,
      });
      const samples = data.screenSamples;
      const last = samples[samples.length - 1];
      if (last) {
        const dt = Math.max(0.001, (time - last.time) / 1000);
        data.screenSpeed = Math.hypot(screen.x - last.x, screen.y - last.y) / dt;
      }

      samples.push({ time, x: screen.x, y: screen.y });
      while (samples.length > 0 && time - samples[0].time > 12000) samples.shift();

      const recent = samples.find((sample) => time - sample.time <= 5000) ?? samples[0];
      data.screenDisplacementWindow = recent ? Math.hypot(screen.x - recent.x, screen.y - recent.y) : 0;
    });
  }

  getMotionSnapshot() {
    const viewport = this.getMotionViewport();
    return {
      time: this.motionElapsed,
      preset: this.motionPresetName,
      viewMode: this.viewModeName,
      reducedMotion: this.reducedMotion,
      cameraParallax: this.cameraParallaxOffset.toArray(),
      cameraLook: this.cameraLookOffset.toArray(),
      cameraRotation: this.cameraRotationOffset.toArray(),
      bubbles: this.spheres.map((sphere) => {
        const data = sphere.userData;
        const screen = projectBubbleToScreen({
          position: sphere.position,
          radius: Math.max(data.radius * this.bubbleScale, data.radius),
          camera: this.camera,
          viewport,
        });

        return {
          id: data.memoryId,
          depthBand: data.depthBand,
          x: screen.x,
          y: screen.y,
          radius: screen.radius,
          ndcX: screen.ndcX,
          ndcY: screen.ndcY,
          visible: screen.isVisible,
          speed: data.screenSpeed ?? 0,
          recentDisplacement: data.screenDisplacementWindow ?? 0,
          overlapCount: data.overlapCount ?? 0,
          macroAmplitude: data.macroAmplitude?.toArray?.() ?? [0, 0, 0],
          separationOffset: data.separationOffset?.toArray?.() ?? [0, 0, 0],
        };
      }),
    };
  }

  resetView() {
    this.mouseX = 0;
    this.mouseY = 0;
    this.cameraParallaxOffset.set(0, 0, 0);
    this.cameraLookOffset.set(0, 0, 0);
    this.cameraRotationOffset.set(0, 0);
    this.camera.position.copy(CAMERA_HOME);
    this.camera.lookAt(this.scene.position);
    this.viewDirty = false;
  }

  animate(time = performance.now()) {
    const delta = clamp((time - this.lastFrameTime) / 1000, 0, 0.05);
    this.lastFrameTime = time;
    if (this.pageVisible) this.motionElapsed += delta;
    this.motionFrame += 1;
    this.updateTransition(time);

    const focusActive = this.focusAmount > 0.001 || Boolean(this.activeFocusId);
    const viewport = this.getMotionViewport();
    this.updateCameraParallax(delta, focusActive);
    const focusTarget = this.getFocusTarget();
    const positionEase = dampFactor(this.reducedMotion ? 9 : this.motionPreset.positionDamping, delta);

    for (let index = 0, total = this.spheres.length; index < total; index += 1) {
      const sphere = this.spheres[index];
      const data = sphere.userData;
      const isFocused = data.memoryId === this.activeFocusId;
      const isHovered = data.memoryId === this.hoveredId && !focusActive;
      const isPointerLocked = this.pointerDown?.memoryId === data.memoryId && !focusActive;
      data.isFocused = isFocused;
      data.isHovered = isHovered;
      this.updateAnchorTransition(data, time);

      const hoverTarget = isHovered || isPointerLocked ? 1 : 0;
      const hoverDamping = hoverTarget ? this.motionPreset.hoverSlowdown.dampingIn : this.motionPreset.hoverSlowdown.dampingOut;
      data.hoverMotion += (hoverTarget - data.hoverMotion) * dampFactor(hoverDamping, delta);

      const exitingFocus = isFocused && this.focusTransition?.to === 0;
      const pausedForFocus = isFocused && !exitingFocus;
      const motionScale = this.getBubbleMotionScale({
        data,
        isFocused,
        focusActive,
        isPointerLocked,
      });

      if (this.pageVisible && !pausedForFocus) {
        data.motionTime += delta * motionScale.timeScale;
        data.driftTime += delta * motionScale.timeScale;
      }

      this.updateMacroRoaming(data, this.tmpMotionTarget, {
        amplitudeScale: motionScale.amplitudeScale,
        viewport,
      });
      this.updateMicroDrift(data, this.tmpMicroOffset);
      data.motionTarget
        .copy(data.roamingTarget)
        .add(this.tmpMicroOffset);
      this.updateBoundaryOffset(data, data.motionTarget, this.tmpBoundaryOffset);
      data.motionTarget.add(this.tmpBoundaryOffset);
    }

    this.updateSeparation(delta, viewport);

    for (let index = 0, total = this.spheres.length; index < total; index += 1) {
      const sphere = this.spheres[index];
      const data = sphere.userData;
      const isFocused = data.memoryId === this.activeFocusId;
      const isHovered = data.memoryId === this.hoveredId && !focusActive;

      this.tmpNormalPosition
        .copy(data.motionTarget)
        .add(data.separationOffset)
        .add(data.interactionOffset);
      data.currentPosition.lerp(this.tmpNormalPosition, positionEase);

      if (isFocused) {
        const useDynamicReturn = this.focusTransition?.to === 0;
        const focusStart = data.focusStartPosition ?? data.currentPosition;
        if (useDynamicReturn) {
          sphere.position.lerpVectors(data.currentPosition, focusTarget, this.focusAmount);
        } else {
          sphere.position.lerpVectors(focusStart, focusTarget, this.focusAmount);
        }
      } else {
        if (data.focusStartPosition && this.focusAmount <= 0.001) data.focusStartPosition = null;
        sphere.position.copy(data.currentPosition);
      }

      data.hover += ((isHovered ? 1 : 0) - data.hover) * dampFactor(11, delta);

      if (data.pulse > 0.001) {
        data.pulse *= this.reducedMotion ? 0.72 : 0.86;
      } else {
        data.pulse = 0;
      }

      const focusScale = isFocused ? this.focusAmount : 0;
      const breath = this.reducedMotion || isFocused
        ? 0
        : Math.sin(data.motionTime * 1.18 + (data.motionProfile?.microPhase?.x ?? 0)) * 0.014;
      const displayScale = this.getDisplayScale(data.baseScale, data.pulse, data.hover, focusScale) * (1 + breath);
      sphere.scale.setScalar(displayScale);

      const dimAmount = focusActive && !isFocused ? this.focusAmount : 0;
      const focusedOpacity = isFocused ? lerp(0.9, 0.7, this.focusAmount) : 0.9;
      const opacity = lerp(focusedOpacity, 0.22, dimAmount);
      data.ownedMaterial.opacity = opacity;
      data.ownedMaterial.color.setScalar(lerp(1, 1.18, data.hover + (isFocused ? this.focusAmount * 0.25 : 0)));

      data.auraMaterial.opacity =
        data.hover * 0.2 +
        data.pulse * 0.16 +
        (isFocused ? this.focusAmount * 0.32 : 0);

      sphere.renderOrder = isFocused ? 10 : 0;
    }

    const useParallax =
      this.parallaxEnabled &&
      !this.reducedMotion &&
      !focusActive &&
      this.pageVisible;

    if (useParallax) {
      this.effect.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.sampleMotionDebug(time, viewport);
    if (this.layoutDebug || this.motionDebug) this.updateLayoutDebug();
  }

  updateLayoutDebug() {
    if (!this.debugCanvas) return;

    const { width, height } = this.getViewport();
    if (this.debugCanvas.width !== width || this.debugCanvas.height !== height) {
      this.debugCanvas.width = width;
      this.debugCanvas.height = height;
    }

    const context = this.debugCanvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, width, height);
    context.save();
    context.lineWidth = 1;
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';

    const safeRect = this.layoutMetrics?.viewport?.safeRect;
    if (safeRect) {
      context.strokeStyle = 'rgba(168, 255, 208, 0.56)';
      context.setLineDash([6, 6]);
      context.strokeRect(
        safeRect.left,
        safeRect.top,
        safeRect.right - safeRect.left,
        safeRect.bottom - safeRect.top,
      );
      context.setLineDash([]);
    }

    (this.layoutMetrics?.viewport?.avoidRects ?? []).forEach((rect) => {
      context.fillStyle = 'rgba(255, 196, 125, 0.12)';
      context.strokeStyle = 'rgba(255, 196, 125, 0.72)';
      context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      context.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    });

    const screens = [];
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      const current = projectBubbleToScreen({
        position: sphere.position,
        radius: BUBBLE_GEOMETRY_RADIUS * sphere.scale.x,
        camera: this.camera,
        viewport: { width, height },
      });
      const anchor = projectBubbleToScreen({
        position: data.anchorPosition,
        radius: Math.max(data.radius ?? 0.01, 0.01),
        camera: this.camera,
        viewport: { width, height },
      });
      const roaming = projectBubbleToScreen({
        position: data.roamingTarget ?? data.anchorPosition,
        radius: Math.max((data.radius ?? 0.01) * 0.35, 0.01),
        camera: this.camera,
        viewport: { width, height },
      });

      screens.push({ ...current, depthBand: data.depthBand });
      context.strokeStyle = data.debugColor ?? 'rgba(255,255,255,0.8)';
      context.fillStyle = data.debugColor ?? 'white';
      context.globalAlpha = data.isFocused ? 0.95 : 0.58;
      context.beginPath();
      context.arc(current.x, current.y, current.radius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.9;
      context.beginPath();
      context.arc(anchor.x, anchor.y, 2.5, 0, Math.PI * 2);
      context.fill();
      if (this.motionDebug) {
        context.globalAlpha = 0.8;
        context.strokeRect(roaming.x - 3, roaming.y - 3, 6, 6);
      }
      context.globalAlpha = 0.36;
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(current.x, current.y);
      context.stroke();
      if (this.motionDebug) {
        context.globalAlpha = 0.52;
        context.strokeStyle = 'rgba(255, 245, 232, 0.72)';
        context.beginPath();
        context.moveTo(current.x, current.y);
        context.lineTo(roaming.x, roaming.y);
        context.stroke();

        const samples = data.screenSamples ?? [];
        if (samples.length > 1) {
          context.globalAlpha = 0.42;
          context.strokeStyle = data.debugColor ?? 'rgba(255,255,255,0.8)';
          context.beginPath();
          samples.forEach((sample, sampleIndex) => {
            if (sampleIndex === 0) context.moveTo(sample.x, sample.y);
            else context.lineTo(sample.x, sample.y);
          });
          context.stroke();
        }
      }
    });

    let overlapCount = 0;
    screens.forEach((screen, index) => {
      for (let otherIndex = index + 1; otherIndex < screens.length; otherIndex += 1) {
        const other = screens[otherIndex];
        const distance = Math.hypot(screen.x - other.x, screen.y - other.y);
        const allowedOverlap = Math.min(screen.radius, other.radius) * (screen.depthBand === other.depthBand ? 0.7 : 1.08);
        if (distance < screen.radius + other.radius - allowedOverlap) overlapCount += 1;
      }
    });

    const counts = this.layoutMetrics?.quadrantCounts ?? {};
    const depths = this.layoutMetrics?.depthCounts ?? {};
    const displacements = this.spheres
      .map((sphere) => sphere.userData.screenDisplacementWindow ?? 0)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const medianDisplacement = displacements.length
      ? displacements[Math.floor(displacements.length * 0.5)]
      : 0;
    context.globalAlpha = 1;
    context.fillStyle = 'rgba(5, 10, 8, 0.72)';
    context.fillRect(16, height - (this.motionDebug ? 132 : 94), this.motionDebug ? 520 : 410, this.motionDebug ? 112 : 74);
    context.fillStyle = 'rgba(235, 255, 244, 0.92)';
    context.fillText(`layout=${this.layoutMode} seed=${this.layoutSeed}`, 28, height - (this.motionDebug ? 108 : 70));
    context.fillText(
      `regions LT:${counts.leftTop ?? 0} RT:${counts.rightTop ?? 0} LB:${counts.leftBottom ?? 0} RB:${counts.rightBottom ?? 0} C:${counts.center ?? 0}`,
      28,
      height - (this.motionDebug ? 88 : 50),
    );
    context.fillText(
      `depth near:${depths.near ?? 0} mid:${depths.mid ?? 0} far:${depths.far ?? 0} overlaps:${overlapCount} focused:${this.activeFocusId ?? '-'}`,
      28,
      height - (this.motionDebug ? 68 : 30),
    );
    if (this.motionDebug) {
      context.fillText(
        `motion=${this.motionPresetName}(${this.getMotionPresetLabel()}) view=${this.viewModeName}(${this.getViewModeLabel()}) reduced=${this.reducedMotion} median5s=${Math.round(medianDisplacement)}px`,
        28,
        height - 48,
      );
      context.fillText(
        `cameraParallax=${this.cameraParallaxOffset.x.toFixed(3)},${this.cameraParallaxOffset.y.toFixed(3)} look=${this.cameraLookOffset.x.toFixed(3)},${this.cameraLookOffset.y.toFixed(3)} rot=${this.cameraRotationOffset.x.toFixed(2)},${this.cameraRotationOffset.y.toFixed(2)}`,
        28,
        height - 28,
      );
    }
    context.restore();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.clearTimeout(this.layoutResizeTimer);
    this.cancelTransition(false);
    this.clearBubbles();
    this.disposeCustomBackground();
    this.defaultBackgroundTexture?.dispose?.();
    this.geometry?.dispose?.();
    this.renderer.dispose();

    document.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
    window.removeEventListener('blur', this.handlePointerLeave);
    window.removeEventListener('resize', this.handleResize);
    this.debugCanvas?.remove();
  }
}
