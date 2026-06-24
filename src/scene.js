import * as THREE from 'three';
import { AmbientBubbleController } from './ambientBubbles.js';
import {
  BUBBLE_GEOMETRY_RADIUS,
  MEMORY_CLOUD_LAYOUT,
  createMemoryCloudLayout,
  projectBubbleToScreen,
  worldFromCameraNdc,
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
import { hashString, seededRandom } from './domain.js';
import { RenderPipeline } from './renderPipeline.js';
import {
  CAMERA_PARALLAX_CONFIG,
  RENDER_QUALITY_CONFIG,
  SCENE_QUALITY_ORDER,
  VISUAL_COMPOSITION,
  getHigherQuality,
  getLowerQuality,
  getCompositionSettings,
  normalizeQualityName,
  resolveVisibleMemoryCount,
  resolveEffectDprCap,
} from './sceneConfig.js';
import {
  BubbleInteraction,
  BubbleLifecycle,
  MEMORY_STREAM_CONFIG,
  STREAM_COHORTS,
} from './memoryStreamConfig.js';

const DEFAULT_MAX_PREVIEW_VIDEOS = 3;
const FOCUS_DURATION = 780;
const EXIT_DURATION = 560;
const REDUCED_MOTION_DURATION = 120;
const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 720;
const CAMERA_HOME = new THREE.Vector3(0, 0, 3);
const LAYOUT_REFLOW_DEBOUNCE_MS = 140;
const LAYOUT_REFLOW_DURATION = 620;
const ACTIVE_MOTION_RAMP_MS = 2600;
const SLOT_REPLACEMENT_SCORE = Object.freeze({
  ageWeight: 0.82,
  edgeWeight: 0.28,
  restWeight: 0.42,
  neverReplacedBonus: 0.72,
  repeatPenalty: 1.12,
  replacementCountPenalty: 0.07,
  centerPenalty: 0.1,
  localFocusPenalty: 0.3,
  fullAgeMs: 60000,
  fullRestMs: 90000,
  jitter: 0.055,
});
const TWO_PI = Math.PI * 2;
const DEPTH_ORDER = Object.freeze({ near: 0, mid: 1, far: 2 });
const UI_AVOID_SELECTORS = [
  '.brand-chip',
  '.desktop-actions',
  '.mobile-action-bar',
  '.settings-panel:not([hidden])',
  '.empty-copy',
  '.loading-copy',
  '#focus-view:not([hidden]) .focus-panel',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothstep(min, max, value) {
  if (max <= min) return value >= max ? 1 : 0;
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function getDistanceMappedProgress(route, progress) {
  const t = clamp(progress, 0, 1);
  const samples = route.lengthSamples;
  const curveLength = route.curveLength ?? 0;
  if (!samples || samples.length < 2 || curveLength <= 0.0001) return t;

  const targetLength = curveLength * t;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    if (targetLength > next.length) continue;
    const segmentLength = Math.max(0.0001, next.length - previous.length);
    const segmentProgress = (targetLength - previous.length) / segmentLength;
    return lerp(previous.t, next.t, segmentProgress);
  }

  return 1;
}

function getRouteSampleProgress(route, progress) {
  const t = clamp(progress, 0, 1);
  if (route?.mode === 'entering' || route?.mode === 'leaving') return easeInOutCubic(t);
  if (route?.mode === 'internal') return getDistanceMappedProgress(route, t);
  return t;
}

function getEnteringRamp(progress, start, end) {
  return smoothstep(start, end, progress);
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function randomRange(random, min, max) {
  return lerp(min, max, random());
}

function isRenderableLifecycle(lifecycle) {
  return lifecycle === BubbleLifecycle.ENTERING ||
    lifecycle === BubbleLifecycle.ACTIVE ||
    lifecycle === BubbleLifecycle.LEAVING;
}

function isInteractiveLifecycle(lifecycle) {
  return lifecycle === BubbleLifecycle.ACTIVE;
}

function isTransitionLifecycle(lifecycle) {
  return lifecycle === BubbleLifecycle.ENTERING ||
    lifecycle === BubbleLifecycle.LEAVING ||
    lifecycle === BubbleLifecycle.PRELOADING;
}

function getCameraBasis(camera) {
  camera.updateMatrixWorld();
  return {
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize(),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize(),
  };
}

function sampleCubicBezier(route, progress, target) {
  const t = clamp(progress, 0, 1);
  const inv = 1 - t;
  return target
    .copy(route.start)
    .multiplyScalar(inv * inv * inv)
    .addScaledVector(route.controlA, 3 * inv * inv * t)
    .addScaledVector(route.controlB, 3 * inv * t * t)
    .addScaledVector(route.end, t * t * t);
}

function createRouteLengthSamples(route, steps = 18) {
  const samples = [{ t: 0, length: 0 }];
  const previous = new THREE.Vector3();
  const current = new THREE.Vector3();
  let length = 0;

  sampleCubicBezier(route, 0, previous);
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    sampleCubicBezier(route, t, current);
    length += current.distanceTo(previous);
    samples.push({ t, length });
    previous.copy(current);
  }

  return { samples, length };
}

function sampleCubicBezierTangent(route, progress, target) {
  const t = clamp(progress, 0, 1);
  const inv = 1 - t;
  target
    .copy(route.controlA)
    .sub(route.start)
    .multiplyScalar(3 * inv * inv)
    .addScaledVector(route.controlB.clone().sub(route.controlA), 6 * inv * t)
    .addScaledVector(route.end.clone().sub(route.controlB), 3 * t * t);
  if (target.lengthSq() < 0.000001) target.copy(route.end).sub(route.start);
  return target.normalize();
}

export class MemoryBubbleScene {
  constructor({ canvas, onPick, onHoverChange, onRenderStatus, rendererProfile = {} }) {
    const devParams = import.meta.env?.DEV && globalThis.location
      ? new URLSearchParams(globalThis.location.search)
      : null;

    this.canvas = canvas;
    this.onPick = onPick;
    this.onHoverChange = onHoverChange;
    this.onRenderStatus = onRenderStatus;
    this.pixelRatioLimit = rendererProfile.pixelRatioLimit ?? 1.75;
    this.maxPreviewVideos = rendererProfile.maxPreviewVideos ?? DEFAULT_MAX_PREVIEW_VIDEOS;
    this.baseQualityPreset = normalizeQualityName(
      rendererProfile.qualityPreset ?? (this.pixelRatioLimit <= 1.25 ? 'low' : this.pixelRatioLimit <= 1.5 ? 'medium' : 'high'),
    );
    this.qualityPreset = this.baseQualityPreset;
    this.mouseX = 0;
    this.mouseY = 0;
    this.windowHalfX = window.innerWidth / 2;
    this.windowHalfY = window.innerHeight / 2;
    this.pointer = new THREE.Vector2(-100000, -100000);
    this.raycaster = new THREE.Raycaster();
    this.spheres = [];
    this.memorySlots = [];
    this.memorySpheres = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.cubeTextureLoader = new THREE.CubeTextureLoader();
    this.focusedId = null;
    this.activeFocusId = null;
    this.hoveredId = null;
    this.parallaxEnabled = devParams?.get('cameraParallax') !== '0';
    this.barrierEnabled = devParams?.get('renderer') === 'barrier' || devParams?.get('barrier') === '1';
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
    this.currentMemoryById = new Map();
    this.visibleMemoryIds = [];
    this.visibleMemoryIdSet = new Set();
    this.memoryDisplayCounts = new Map();
    this.memoryExposure = new Map();
    this.nextMemoryQueue = [];
    this.preloadMap = new Map();
    this.textureCache = new Map();
    this.pendingSlotPromises = new Map();
    this.lastRecycleAt = 0;
    this.completedRecycleCount = 0;
    this.pendingFocusReturnIds = new Set();
    this.nextMemoryRotationAt = 0;
    this.memoryRotationRandom = seededRandom('memory-rotation');
    this.motionRoleEpoch = 0;
    this.nextMotionRoleRotationAt = 0;
    this.motionRoleRandom = seededRandom('motion-role');
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
    this.frameSamples = [];
    this.averageFrameMs = 0;
    this.averageFps = 0;
    this.lastQualitySwitchAt = 0;
    this.cameraParallaxOffset = new THREE.Vector3();
    this.cameraLookOffset = new THREE.Vector3();
    this.cameraRotationOffset = new THREE.Vector2();
    this.sceneDebug = devParams?.get('sceneDebug') === '1';
    this.compositionDebug = devParams?.get('compositionDebug') === '1';
    this.layoutDebug = devParams?.get('layoutDebug') === '1';
    this.motionDebug = devParams?.get('motionDebug') === '1';
    this.streamDebug = devParams?.get('streamDebug') === '1';
    this.debugLayerMode = devParams?.get('sceneLayer') || 'combined';
    this.officialReferenceMotion = devParams?.get('officialReferenceMotion') === '1';
    this.debugCanvas = null;

    this.tmpNormalPosition = new THREE.Vector3();
    this.tmpFocusTarget = new THREE.Vector3();
    this.tmpCameraDirection = new THREE.Vector3();
    this.tmpMacroOffset = new THREE.Vector3();
    this.tmpMicroOffset = new THREE.Vector3();
    this.tmpGlobalFlowOffset = new THREE.Vector3();
    this.tmpBoundaryOffset = new THREE.Vector3();
    this.tmpMotionTarget = new THREE.Vector3();
    this.tmpRoutePosition = new THREE.Vector3();
    this.tmpRouteSample = new THREE.Vector3();
    this.tmpRouteTangent = new THREE.Vector3();
    this.tmpRouteControlA = new THREE.Vector3();
    this.tmpRouteControlB = new THREE.Vector3();
    this.tmpRouteBasisRight = new THREE.Vector3();
    this.tmpRouteBasisUp = new THREE.Vector3();
    this.tmpRoutePreviousTangent = new THREE.Vector3();
    this.tmpRouteLineDirection = new THREE.Vector3();
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
    this.scene.environment = this.defaultBackgroundTexture;
    this.scene.fog = new THREE.FogExp2(0x020403, 0.022);
    this.ambientBubbleGroup = new THREE.Group();
    this.ambientBubbleGroup.name = 'ambientBubbleGroup';
    this.memoryBubbleGroup = new THREE.Group();
    this.memoryBubbleGroup.name = 'memoryBubbleGroup';
    this.scene.add(this.ambientBubbleGroup, this.memoryBubbleGroup);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: rendererProfile.antialias ?? true,
      alpha: false,
      powerPreference: rendererProfile.powerPreference ?? 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioLimit));
    this.renderer.setAnimationLoop((time) => this.animate(time));

    this.renderPipeline = new RenderPipeline(this.renderer, {
      pixelRatioLimit: this.pixelRatioLimit,
      effectDprCap: resolveEffectDprCap({ qualityName: this.qualityPreset }),
    });
    this.renderPipeline.setBarrierEnabled(this.barrierEnabled);
    this.geometry = new THREE.SphereGeometry(BUBBLE_GEOMETRY_RADIUS, 40, 24);
    this.memoryShellMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      envMap: this.currentEnvMap,
      combine: THREE.MixOperation,
      reflectivity: VISUAL_COMPOSITION.memoryMaterial.shellReflectivity,
      transparent: true,
      opacity: VISUAL_COMPOSITION.memoryMaterial.shellOpacity,
      depthWrite: false,
    });
    this.ambientController = new AmbientBubbleController({
      camera: this.camera,
      group: this.ambientBubbleGroup,
      seed: this.layoutSeed,
      envMap: this.currentEnvMap,
      fallbackEnvMap: this.defaultBackgroundTexture,
      rendererProfile: { qualityPreset: this.qualityPreset },
    });
    this.interactiveMemoryObjects = [];
    this.applyDebugLayerVisibility();
    if (this.layoutDebug || this.motionDebug || this.sceneDebug || this.compositionDebug || this.streamDebug) this.debugCanvas = this.createDebugCanvas();
    if (import.meta.env?.DEV) {
      globalThis.__memoryBubbleScene = this;
      globalThis.__memoryBubbleSceneDebug = {
        setLayerMode: (mode) => this.setDebugLayerMode(mode),
        setBarrier: (enabled) => this.setBarrierMode(enabled),
        setCameraParallax: (enabled) => this.setParallaxMode(enabled),
        setOfficialReferenceMotion: (enabled) => this.setOfficialReferenceMotion(enabled),
        snapshot: () => this.getMotionSnapshot(),
      };
    }

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
      const hitSphere = hit?.object ?? null;
      if (hitSphere?.userData.lifecycle === BubbleLifecycle.ACTIVE) {
        hitSphere.userData.interaction = BubbleInteraction.PRESSED;
        hitSphere.userData.lastInteractionAt = performance.now();
        this.removeInteractiveObject(hitSphere);
      }
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
      const lockedSphere = this.memorySpheres.get(pointerDown.memoryId);
      if (lockedSphere?.userData.interaction === BubbleInteraction.PRESSED) {
        lockedSphere.userData.interaction = BubbleInteraction.NONE;
        if (lockedSphere.userData.lifecycle === BubbleLifecycle.ACTIVE) this.addInteractiveObject(lockedSphere);
      }

      const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      const duration = performance.now() - pointerDown.startedAt;
      const isClick = distance <= DRAG_THRESHOLD && duration <= LONG_PRESS_MS && !pointerDown.dragging;

      if (!isClick || this.focusAmount > 0.01) return;

      this.updatePointerFromEvent(event);
      this.pickBubble(pointerDown.memoryId);
    };

    this.handlePointerCancel = (event) => {
      if (this.pointerDown?.pointerId === event.pointerId) {
        const sphere = this.memorySpheres.get(this.pointerDown.memoryId);
        if (sphere?.userData.interaction === BubbleInteraction.PRESSED) {
          sphere.userData.interaction = BubbleInteraction.NONE;
          if (sphere.userData.lifecycle === BubbleLifecycle.ACTIVE) this.addInteractiveObject(sphere);
        }
        this.pointerDown = null;
      }
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
    const memories = this.spheres
      .map((sphere) => sphere.userData.memory)
      .filter(Boolean);
    if (memories.length === 0) return;
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

  configureAmbientLayer({ viewport = this.getMotionViewport(), forceRebuild = false } = {}) {
    this.ambientController.configure({
      seed: `${this.layoutSeed}:ambient`,
      viewport,
      avoidRects: this.getUiAvoidRects(),
      qualityName: this.qualityPreset,
      barrierEnabled: this.barrierEnabled,
      reducedMotion: this.reducedMotion,
      empty: this.currentMemories.length === 0,
      forceRebuild,
    });
  }

  resize() {
    this.windowHalfX = window.innerWidth / 2;
    this.windowHalfY = window.innerHeight / 2;

    const { width, height } = this.getViewport();
    const motionViewport = this.getMotionViewport();

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderPipeline.setBarrierEnabled(this.barrierEnabled);
    this.renderPipeline.resize(width, height, {
      devicePixelRatio: window.devicePixelRatio || 1,
      pixelRatioLimit: this.pixelRatioLimit,
      effectDprCap: resolveEffectDprCap({
        qualityName: this.qualityPreset,
        isMobile: motionViewport.isMobile,
      }),
    });
    this.updateFlatBackgroundTransform();
    this.configureAmbientLayer({ viewport: motionViewport });
    this.scheduleLayoutReflow();
  }

  getCompositionBudget(viewport = this.getMotionViewport()) {
    return getCompositionSettings({ isMobile: viewport.isMobile });
  }

  getVisibleMemoryLimit(viewport = this.getMotionViewport()) {
    const configured = viewport.isMobile
      ? MEMORY_STREAM_CONFIG.mobileSlotCount
      : MEMORY_STREAM_CONFIG.desktopSlotCount;
    return Math.max(0, Math.min(
      this.currentMemories.length,
      configured,
      resolveVisibleMemoryCount({
        total: this.currentMemories.length,
        isMobile: viewport.isMobile,
      }),
    ));
  }

  getExposure(memoryId) {
    if (!memoryId) return null;
    if (!this.memoryExposure.has(memoryId)) {
      this.memoryExposure.set(memoryId, {
        memoryId,
        shownCount: 0,
        openedCount: 0,
        lastShownAt: 0,
        lastOpenedAt: 0,
        shownInCurrentSession: false,
      });
    }
    return this.memoryExposure.get(memoryId);
  }

  getMemoryVisibilityScore(memory, index, { forced = false } = {}) {
    const id = memory?.id ?? `memory-${index}`;
    const random = seededRandom(`${this.layoutSeed}:exposure:${id}:${this.completedRecycleCount}`);
    const weights = MEMORY_STREAM_CONFIG.selectionWeights;
    const exposure = this.getExposure(id);
    const now = performance.now();
    const secondsSinceShown = exposure?.lastShownAt ? (now - exposure.lastShownAt) / 1000 : 999;
    const shownCount = exposure?.shownCount ?? 0;
    const aspectRatio = Number(memory?.aspectRatio) || 4 / 3;
    const aspectPenalty = clamp(Math.abs(Math.log(aspectRatio / (4 / 3))), 0, 1.2) * 0.055;
    const videoBoost = memory?.kind === 'video' ? 0.035 : 0;
    const currentKindCount = this.spheres.reduce((count, sphere) => (
      sphere.userData.memory?.kind === memory?.kind ? count + 1 : count
    ), 0);

    return (
      (forced ? 10000 : 0) +
      (!exposure?.shownInCurrentSession ? weights.unseenBonus : 0) +
      clamp(secondsSinceShown / 60, 0, 1) * weights.staleBonus +
      ((exposure?.openedCount ?? 0) === 0 ? weights.unopenedBonus : 0) -
      shownCount * weights.shownPenalty -
      (secondsSinceShown < 18 ? (1 - secondsSinceShown / 18) * weights.recentPenalty : 0) -
      currentKindCount * weights.duplicateKindPenalty +
      random() * weights.jitter +
      videoBoost -
      aspectPenalty
    );
  }

  selectVisibleMemories({ forcedIds = [] } = {}) {
    const limit = this.getVisibleMemoryLimit();
    if (limit <= 0) return [];

    const forced = new Set(forcedIds.filter(Boolean));
    const scored = this.currentMemories
      .map((memory, index) => ({
        memory,
        index,
        forced: forced.has(memory.id),
        score: this.getMemoryVisibilityScore(memory, index, { forced: forced.has(memory.id) }),
      }))
      .sort((a, b) => {
        if (a.forced !== b.forced) return a.forced ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });

    return scored.slice(0, limit).map((entry) => entry.memory);
  }

  markMemoryDisplayed(memoryId) {
    if (!memoryId) return;
    this.memoryDisplayCounts.set(memoryId, (this.memoryDisplayCounts.get(memoryId) ?? 0) + 1);
    const exposure = this.getExposure(memoryId);
    if (!exposure) return;
    exposure.shownCount += 1;
    exposure.lastShownAt = performance.now();
    exposure.shownInCurrentSession = true;
  }

  markMemoryOpened(memoryId) {
    const exposure = this.getExposure(memoryId);
    if (!exposure) return;
    exposure.openedCount += 1;
    exposure.lastOpenedAt = performance.now();
  }

  scheduleNextMemoryRotation(now = performance.now()) {
    const viewport = this.getMotionViewport();
    const min = this.reducedMotion
      ? MEMORY_STREAM_CONFIG.reducedMotionRecycleIntervalMin
      : viewport.isMobile
        ? MEMORY_STREAM_CONFIG.mobileRecycleIntervalMin
        : MEMORY_STREAM_CONFIG.recycleIntervalMin;
    const max = this.reducedMotion
      ? MEMORY_STREAM_CONFIG.reducedMotionRecycleIntervalMax
      : viewport.isMobile
        ? MEMORY_STREAM_CONFIG.mobileRecycleIntervalMax
        : MEMORY_STREAM_CONFIG.recycleIntervalMax;
    const seconds = lerp(min, max, this.memoryRotationRandom());
    this.nextMemoryRotationAt = now + seconds * 1000;
  }

  scheduleNextMotionRoleRotation(now = performance.now()) {
    const config = VISUAL_COMPOSITION.motionRoles;
    const seconds = lerp(config.rotateIntervalMin, config.rotateIntervalMax, this.motionRoleRandom());
    this.nextMotionRoleRotationAt = now + seconds * 1000;
  }

  getMemoryIndex(memory) {
    return Math.max(0, this.currentMemories.findIndex((item) => item.id === memory?.id));
  }

  createFallbackPreviewTexture(memory) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 220;
    const context = canvas.getContext('2d');
    const hash = hashString(`${this.layoutSeed}:fallback:${memory?.id ?? memory?.name ?? 'memory'}`);
    const hue = hash % 360;

    if (context) {
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${hue}, 42%, 22%)`);
      gradient.addColorStop(0.58, `hsl(${(hue + 46) % 360}, 34%, 35%)`);
      gradient.addColorStop(1, `hsl(${(hue + 112) % 360}, 48%, 18%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 0.32;
      context.strokeStyle = '#fff8e8';
      context.lineWidth = 5;
      for (let index = 0; index < 6; index += 1) {
        context.beginPath();
        context.ellipse(
          canvas.width * (0.24 + index * 0.11),
          canvas.height * (0.42 + Math.sin(index) * 0.08),
          canvas.width * (0.18 + index * 0.015),
          canvas.height * 0.18,
          index * 0.32,
          0,
          TWO_PI,
        );
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.userData.isFallbackPreview = true;
    return texture;
  }

  waitForImageReady(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('image decode timeout'));
      }, MEMORY_STREAM_CONFIG.imageDecodeTimeoutMs);

      const finish = async () => {
        if (settled) return;
        try {
          if (typeof image.decode === 'function') await image.decode();
        } catch {
          // The load event is enough for browsers that reject decode on blob/data URLs.
        }
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(image);
      };

      image.onload = () => {
        void finish();
      };
      image.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error('image load failed'));
      };
      image.decoding = 'async';
      image.src = source;
    });
  }

  applyPreviewToneLift(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return;

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const lift = Math.max(0, 48 - luminance) * 0.72;
      const softContrast = luminance < 72 ? 0.94 : 1;
      data[index] = clamp(red * softContrast + lift + 7, 0, 255);
      data[index + 1] = clamp(green * softContrast + lift + 8, 0, 255);
      data[index + 2] = clamp(blue * softContrast + lift + 10, 0, 255);
    }
    context.putImageData(image, 0, 0);
  }

  createPreviewTextureFromDrawable(drawable, {
    width = drawable?.naturalWidth || drawable?.videoWidth || drawable?.width || 640,
    height = drawable?.naturalHeight || drawable?.videoHeight || drawable?.height || 360,
  } = {}) {
    const aspectRatio = Math.max(0.2, width / Math.max(height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1024, Math.max(320, width));
    canvas.height = Math.max(180, Math.round(canvas.width / aspectRatio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('preview canvas unavailable');

    context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
    this.applyPreviewToneLift(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  async loadImagePreviewTexture(memory) {
    const image = await this.waitForImageReady(memory.previewSource || memory.source);
    return this.createPreviewTextureFromDrawable(image);
  }

  isCanvasMostlyBlack(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return false;

    const sampleWidth = Math.min(24, canvas.width);
    const sampleHeight = Math.min(16, canvas.height);
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      total += data[index] + data[index + 1] + data[index + 2];
    }
    const average = total / Math.max(1, (data.length / 4) * 3);
    return average < 7;
  }

  loadVideoPosterTexture(memory) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      let settled = false;
      const cleanup = () => {
        video.onloadeddata = null;
        video.oncanplay = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        reject(new Error('video poster failed'));
      };
      const capture = () => {
        if (settled) return;
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(960, Math.max(320, width));
        canvas.height = Math.max(180, Math.round(canvas.width / Math.max(width / height, 0.2)));
        const context = canvas.getContext('2d');
        if (!context) {
          fail();
          return;
        }

        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          fail();
          return;
        }

        if (this.isCanvasMostlyBlack(canvas)) {
          fail();
          return;
        }

        this.applyPreviewToneLift(canvas);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        resolve(texture);
      };
      const timeout = window.setTimeout(fail, MEMORY_STREAM_CONFIG.videoPosterTimeoutMs);

      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';
      video.onloadeddata = capture;
      video.oncanplay = capture;
      video.onerror = fail;
      video.src = memory.previewSource || memory.source;
      video.load();
    });
  }

  preloadMemory(memory) {
    if (!memory?.id) return Promise.resolve(null);
    const cached = this.textureCache.get(memory.id);
    if (cached) {
      cached.lastUsed = performance.now();
      return cached.promise;
    }

    const entry = {
      memoryId: memory.id,
      status: 'loading',
      texture: null,
      lastUsed: performance.now(),
      promise: null,
    };

    entry.promise = (memory.kind === 'video'
      ? this.loadVideoPosterTexture(memory)
      : this.loadImagePreviewTexture(memory))
      .catch(() => this.createFallbackPreviewTexture(memory))
      .then((texture) => {
        entry.status = 'ready';
        entry.texture = texture;
        entry.lastUsed = performance.now();
        return texture;
      });

    this.textureCache.set(memory.id, entry);
    this.evictTextureCache();
    return entry.promise;
  }

  evictTextureCache() {
    const limit = MEMORY_STREAM_CONFIG.textureCacheLimit;
    if (this.textureCache.size <= limit) return;

    const protectedIds = new Set(this.spheres.map((sphere) => sphere.userData.memoryId).filter(Boolean));
    const removable = Array.from(this.textureCache.values())
      .filter((entry) => !protectedIds.has(entry.memoryId))
      .sort((a, b) => a.lastUsed - b.lastUsed);

    while (this.textureCache.size > limit && removable.length > 0) {
      const entry = removable.shift();
      this.textureCache.delete(entry.memoryId);
      entry.texture?.dispose?.();
    }
  }

  disposeTextureCache() {
    this.textureCache.forEach((entry) => {
      entry.texture?.dispose?.();
    });
    this.textureCache.clear();
    this.nextMemoryQueue = [];
    this.preloadMap.clear();
  }

  createMemorySphere(memory, layoutItem, memoryIndex, {
    visibleAlpha = 1,
    poolState = 'visible',
    addToScene = true,
  } = {}) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: null,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const sphere = new THREE.Mesh(this.geometry, material);
    const home = layoutItem?.anchorPosition?.clone?.() ?? new THREE.Vector3(0, 0, -1.6);
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

    const shellMaterial = this.memoryShellMaterial.clone();
    const shell = new THREE.Mesh(this.geometry, shellMaterial);
    shell.scale.setScalar(1.035);
    shell.renderOrder = -1;
    shell.raycast = () => {};
    sphere.add(shell);

    sphere.position.copy(home);
    sphere.scale.setScalar(this.getDisplayScale(baseScale));
    sphere.userData = {
      index: memoryIndex,
      layout: layoutItem?.layout ?? MEMORY_CLOUD_LAYOUT,
      layoutSeed: layoutItem?.layoutSeed ?? `${MEMORY_CLOUD_LAYOUT}:${this.layoutSeed}`,
      baseScale,
      baseScaleStart: baseScale,
      baseScaleTarget: baseScale,
      radius: layoutItem?.radius ?? baseScale * BUBBLE_GEOMETRY_RADIUS,
      depth: layoutItem?.depth ?? 1.6,
      depthBand: layoutItem?.depthBand ?? 'mid',
      sizeBucket: layoutItem?.sizeBucket ?? 'normal',
      slotId: `slot-${this.memorySlots.length + 1}`,
      memoryId: memory?.id ?? null,
      pulse: 0,
      hover: 0,
      hoverMotion: 0,
      localFocus: 0,
      visibleAlpha: 0,
      visibleTarget: visibleAlpha,
      opacity: 0,
      targetOpacity: visibleAlpha,
      lifecycle: poolState === 'visible' ? BubbleLifecycle.ACTIVE : BubbleLifecycle.POOLED,
      interaction: BubbleInteraction.NONE,
      poolState,
      video: null,
      texture: null,
      ownedMaterial: material,
      aura,
      auraMaterial: aura.material,
      shell,
      shellMaterial,
      memory: memory ?? null,
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
      centerLimitOffset: new THREE.Vector3(),
      centerLimitTargetOffset: new THREE.Vector3(),
      interactionOffset: layoutItem?.interactionOffset?.clone() ?? new THREE.Vector3(),
      macroOffset: new THREE.Vector3(),
      macroAmplitude: new THREE.Vector3(),
      microDriftOffset: new THREE.Vector3(),
      boundaryOffset: new THREE.Vector3(),
      motionProfile: layoutItem?.motionProfile ?? null,
      motionTime: layoutItem?.motionProfile?.timeOffset ?? 0,
      motionRole: 'normal',
      motionRoleFactor: VISUAL_COMPOSITION.motionRoles.factors.normal,
      motionRoleTargetFactor: VISUAL_COMPOSITION.motionRoles.factors.normal,
      screenSpeed: 0,
      screenDisplacementWindow: 0,
      screenSamples: [],
      driftAmplitude: layoutItem?.driftAmplitude?.clone() ?? new THREE.Vector3(0.08, 0.06, 0.04),
      driftFrequency: layoutItem?.driftFrequency?.clone() ?? new THREE.Vector3(0.42, 0.36, 0.28),
      driftPhase: layoutItem?.driftPhase?.clone() ?? new THREE.Vector3(),
      driftSecondaryPhase: layoutItem?.driftSecondaryPhase?.clone() ?? new THREE.Vector3(),
      driftTime: layoutItem?.driftTime ?? 0,
      route: null,
      routeProgress: 0,
      routeRandom: seededRandom(`${this.layoutSeed}:route:${memory?.id ?? this.memorySlots.length}`),
      cohortId: this.memorySlots.length % STREAM_COHORTS.length,
      enteredAt: performance.now(),
      lastSlotReplacementAt: 0,
      slotReplacementCount: 0,
      lastInteractionAt: 0,
      scheduledExitAt: 0,
      speedMultiplier: 1,
      targetSpeedMultiplier: 1,
      preloadToken: 0,
      pendingNextMemoryId: null,
      pendingResolve: null,
      layoutTransition: null,
      debugColor: layoutItem?.debugColor ?? '#ffffff',
      region: layoutItem?.region ?? 'center',
      screen: layoutItem?.screen ?? null,
      isFocused: false,
      isHovered: false,
    };

    if (addToScene) {
      this.memoryBubbleGroup.add(sphere);
      this.spheres.push(sphere);
      this.memorySlots.push(sphere);
      this.setSlotRenderable(sphere, false);
    }

    return sphere;
  }

  removeInteractiveObject(sphere) {
    this.interactiveMemoryObjects = this.interactiveMemoryObjects.filter((item) => item !== sphere);
  }

  addInteractiveObject(sphere) {
    if (!this.interactiveMemoryObjects.includes(sphere)) this.interactiveMemoryObjects.push(sphere);
  }

  setSlotRenderable(sphere, renderable) {
    const data = sphere.userData;
    sphere.visible = Boolean(renderable);
    if (data.shell) data.shell.visible = Boolean(renderable);
    if (data.aura) data.aura.visible = Boolean(renderable);
    sphere.frustumCulled = !renderable;
    if (!renderable) {
      data.ownedMaterial.opacity = 0;
      data.auraMaterial.opacity = 0;
      if (data.shellMaterial) data.shellMaterial.opacity = 0;
      sphere.renderOrder = -20;
    }
  }

  setSlotLifecycle(sphere, lifecycle, {
    interaction = null,
    visible = null,
    interactive = null,
  } = {}) {
    const data = sphere.userData;
    data.lifecycle = lifecycle;
    data.poolState = lifecycle.toLowerCase();
    if (interaction) data.interaction = interaction;
    const shouldRender = visible ?? isRenderableLifecycle(lifecycle);
    this.setSlotRenderable(sphere, shouldRender);

    const shouldInteract =
      interactive ?? (
        shouldRender &&
        isInteractiveLifecycle(lifecycle) &&
        data.interaction === BubbleInteraction.NONE &&
        data.memoryId
      );

    if (shouldInteract) this.addInteractiveObject(sphere);
    else this.removeInteractiveObject(sphere);

    if (lifecycle === BubbleLifecycle.POOLED || lifecycle === BubbleLifecycle.PRELOADING) {
      data.visibleAlpha = 0;
      data.visibleTarget = 0;
      data.opacity = 0;
      data.targetOpacity = 0;
      data.speedMultiplier = 1;
      data.targetSpeedMultiplier = 1;
      data.pulse = 0;
      data.hover = 0;
      data.hoverMotion = 0;
      data.localFocus = 0;
      data.isFocused = false;
      data.isHovered = false;
      data.centerLimitOffset?.set(0, 0, 0);
      data.centerLimitTargetOffset?.set(0, 0, 0);
    }
  }

  setSlotPooled(sphere) {
    if (!sphere) return;
    const data = sphere.userData;
    const oldId = data.memoryId;

    this.removeInteractiveObject(sphere);
    if (oldId && this.memorySpheres.get(oldId) === sphere) this.memorySpheres.delete(oldId);
    if (oldId) {
      this.visibleMemoryIdSet.delete(oldId);
      this.visibleMemoryIds = this.visibleMemoryIds.filter((id) => id !== oldId);
    }

    data.memoryId = null;
    data.memory = null;
    data.pendingNextMemoryId = null;
    data.route = null;
    data.routeProgress = 0;
    data.preloadToken += 1;
    data.ownedMaterial.map = null;
    data.ownedMaterial.needsUpdate = true;
    this.setSlotLifecycle(sphere, BubbleLifecycle.POOLED, {
      interaction: BubbleInteraction.NONE,
      visible: false,
      interactive: false,
    });
  }

  markSlotActive(sphere, now = performance.now()) {
    const data = sphere.userData;
    const previousLifecycle = data.lifecycle;
    data.enteredAt = now;
    data.scheduledExitAt = now + randomRange(
      data.routeRandom,
      MEMORY_STREAM_CONFIG.minVisibleResidence,
      MEMORY_STREAM_CONFIG.maxVisibleResidence,
    ) * 1000;
    data.targetOpacity = 1;
    data.visibleTarget = 1;
    data.interaction = BubbleInteraction.NONE;
    if (previousLifecycle === BubbleLifecycle.ENTERING && data.homeAnchor && data.currentPosition) {
      data.homeAnchor.copy(data.currentPosition);
      data.home = data.homeAnchor;
    }
    if (previousLifecycle === BubbleLifecycle.ENTERING) {
      data.lastSlotReplacementAt = now;
      data.slotReplacementCount = (data.slotReplacementCount ?? 0) + 1;
    }
    this.setSlotLifecycle(sphere, BubbleLifecycle.ACTIVE, {
      visible: true,
      interactive: true,
    });
    if (data.pendingResolve) {
      const resolve = data.pendingResolve;
      data.pendingResolve = null;
      resolve(sphere);
    }
  }

  getRouteDuration(data, mode, { ndcDistance = 0 } = {}) {
    const random = data.routeRandom ?? this.memoryRotationRandom;
    let min = MEMORY_STREAM_CONFIG.internalRouteDurationMin;
    let max = MEMORY_STREAM_CONFIG.internalRouteDurationMax;

    if (mode === 'entering' || mode === 'initial') {
      min = MEMORY_STREAM_CONFIG.enterDurationMin;
      max = MEMORY_STREAM_CONFIG.enterDurationMax;
    } else if (mode === 'leaving') {
      min = MEMORY_STREAM_CONFIG.leaveDurationMin;
      max = MEMORY_STREAM_CONFIG.leaveDurationMax;
    }

    const scale = this.reducedMotion ? MEMORY_STREAM_CONFIG.reducedMotionDurationScale : 1;
    let duration = randomRange(random, min, max) * scale;
    if (mode === 'internal') {
      const reference = Math.max(0.001, MEMORY_STREAM_CONFIG.internalRouteReferenceDistanceNdc);
      const distanceScale = clamp(ndcDistance / reference, 1, 1.9);
      duration *= lerp(1, distanceScale, MEMORY_STREAM_CONFIG.internalRouteDistanceDurationScale);
    }
    return duration;
  }

  getStreamDepth(data, random, side = 'inside') {
    const jitter = MEMORY_STREAM_CONFIG.routeDepthJitter;
    const baseDepth = Math.max(0.78, data.depth ?? this.getMotionDepth(data));
    const depth = baseDepth * lerp(1 - jitter, 1 + jitter, random());

    if (side === 'far') return depth * lerp(1.34, 1.76, random());
    if (data.depthBand === 'near') return depth * 0.94;
    if (data.depthBand === 'far') return depth * 1.08;
    return depth;
  }

  getCenterOccupancy() {
    const quiet = MEMORY_STREAM_CONFIG;
    return this.spheres.reduce((counts, sphere) => {
      const data = sphere.userData;
      if (!isRenderableLifecycle(data.lifecycle) || !data.memoryId) return counts;
      const screen = this.tmpProjected.copy(sphere.position).project(this.camera);
      const inCenter =
        Math.abs(screen.x) <= quiet.centerNdcRadiusX &&
        Math.abs(screen.y) <= quiet.centerNdcRadiusY;
      if (!inCenter) return counts;
      counts.total += 1;
      if (data.sizeBucket === 'emphasis') counts.large += 1;
      return counts;
    }, { total: 0, large: 0 });
  }

  limitInternalRouteTarget(data, projected, target, scale) {
    const depthScale = data.depthBand === 'near'
      ? MEMORY_STREAM_CONFIG.internalRouteNearStepScale
      : 1;
    const maxStepX = MEMORY_STREAM_CONFIG.internalRouteMaxStepNdcX * scale * depthScale;
    const maxStepY = MEMORY_STREAM_CONFIG.internalRouteMaxStepNdcY * scale * depthScale;
    const bounds = MEMORY_STREAM_CONFIG.routeBounds;
    return {
      x: clamp(
        clamp(target.x, projected.x - maxStepX, projected.x + maxStepX),
        bounds.minX * scale,
        bounds.maxX * scale,
      ),
      y: clamp(
        clamp(target.y, projected.y - maxStepY, projected.y + maxStepY),
        bounds.minY * scale,
        bounds.maxY * scale,
      ),
    };
  }

  pickInteriorNdc(data, random, { allowCenter = true, mode = 'internal' } = {}) {
    const bounds = MEMORY_STREAM_CONFIG.routeBounds;
    const viewport = this.getMotionViewport();
    const mobileScale = viewport.isMobile ? MEMORY_STREAM_CONFIG.routeMobileScale : 1;
    const scale = this.reducedMotion
      ? MEMORY_STREAM_CONFIG.routeReducedMotionScale
      : mobileScale;
    const current = data.currentPosition?.clone?.() ?? data.anchorPosition?.clone?.() ?? new THREE.Vector3();
    const projected = current.project(this.camera);
    const centerOccupancy = this.getCenterOccupancy();
    const canPassCenter =
      allowCenter &&
      !this.hoveredId &&
      !this.activeFocusId &&
      centerOccupancy.total < MEMORY_STREAM_CONFIG.maxCenterSlots &&
      (data.sizeBucket !== 'emphasis' || centerOccupancy.large < MEMORY_STREAM_CONFIG.maxLargeCenterSlots) &&
      random() < MEMORY_STREAM_CONFIG.centerPassProbability;

    let target;
    if (canPassCenter) {
      target = {
        x: randomRange(random, -MEMORY_STREAM_CONFIG.centerNdcRadiusX, MEMORY_STREAM_CONFIG.centerNdcRadiusX),
        y: randomRange(random, -MEMORY_STREAM_CONFIG.centerNdcRadiusY, MEMORY_STREAM_CONFIG.centerNdcRadiusY),
      };
    } else {
      const cohort = STREAM_COHORTS[data.cohortId % STREAM_COHORTS.length] ?? STREAM_COHORTS[0];
      target = {
        x: clamp(
          projected.x + randomRange(random, -0.44, 0.44) * scale + cohort.trendX * randomRange(random, 0.28, 0.72) * scale,
          bounds.minX * scale,
          bounds.maxX * scale,
        ),
        y: clamp(
          projected.y + randomRange(random, -0.38, 0.38) * scale + cohort.trendY * randomRange(random, 0.24, 0.66) * scale,
          bounds.minY * scale,
          bounds.maxY * scale,
        ),
      };
    }

    return mode === 'internal'
      ? this.limitInternalRouteTarget(data, projected, target, scale)
      : target;
  }

  pickOffscreenNdc(data, random, side) {
    const margin = MEMORY_STREAM_CONFIG.offscreenMarginNdc;
    const bounds = MEMORY_STREAM_CONFIG.routeBounds;
    const pickY = () => randomRange(random, bounds.minY, bounds.maxY);
    const pickX = () => randomRange(random, bounds.minX, bounds.maxX);

    if (side === 'left') return { x: -1 - randomRange(random, margin, margin + 0.14), y: pickY() };
    if (side === 'right') return { x: 1 + randomRange(random, margin, margin + 0.14), y: pickY() };
    if (side === 'top') return { x: pickX(), y: 1 + randomRange(random, margin * 0.72, margin + 0.1) };
    if (side === 'bottom') return { x: pickX(), y: -1 - randomRange(random, margin * 0.72, margin + 0.1) };
    return {
      x: randomRange(random, bounds.minX * 0.92, bounds.maxX * 0.92),
      y: randomRange(random, bounds.minY * 0.9, bounds.maxY * 0.9),
    };
  }

  worldFromRouteNdc(ndc, depth, target = new THREE.Vector3()) {
    const basis = getCameraBasis(this.camera);
    return worldFromCameraNdc({
      camera: this.camera,
      basis,
      ndcX: ndc.x,
      ndcY: ndc.y,
      depth,
      target,
    });
  }

  createStreamRoute(sphere, mode = 'internal') {
    const data = sphere.userData;
    const previousRoute = mode === 'internal' ? data.route : null;
    const random = data.routeRandom ?? this.memoryRotationRandom;
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const controlA = new THREE.Vector3();
    const controlB = new THREE.Vector3();
    let startNdc = null;
    let endNdc = null;

    if (mode === 'entering') {
      start.copy(sphere.position);
      end.copy(start);
      const projected = this.tmpProjected.copy(start).project(this.camera);
      startNdc = { x: projected.x, y: projected.y };
      endNdc = startNdc;
    } else if (mode === 'leaving') {
      start.copy(sphere.position);
      const projectedStart = this.tmpProjected.copy(sphere.position).project(this.camera);
      startNdc = { x: projectedStart.x, y: projectedStart.y };
      endNdc = startNdc;
      end.copy(start);
    } else {
      start.copy(sphere.position);
      const depth = this.getStreamDepth(data, random, 'inside');
      const projectedStart = this.tmpProjected.copy(sphere.position).project(this.camera);
      startNdc = { x: projectedStart.x, y: projectedStart.y };
      endNdc = this.pickInteriorNdc(data, random, { mode: 'internal' });
      this.worldFromRouteNdc(endNdc, depth, end);
    }

    const line = this.tmpRouteTangent.copy(end).sub(start);
    const lineLength = Math.max(line.length(), data.radius * 2, 0.001);
    const ndcDistance = startNdc && endNdc
      ? Math.hypot(endNdc.x - startNdc.x, endNdc.y - startNdc.y)
      : 0;
    const duration = this.getRouteDuration(data, mode, { ndcDistance });
    const curvatureNdc = randomRange(
      random,
      MEMORY_STREAM_CONFIG.routeCurvatureNdc[0],
      MEMORY_STREAM_CONFIG.routeCurvatureNdc[1],
    );
    const turnSign = random() > 0.5 ? 1 : -1;
    const depth = Math.max(0.8, this.getMotionDepth(data));
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    this.tmpRouteBasisRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.tmpRouteBasisUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.tmpRouteControlA
      .copy(this.tmpRouteBasisRight)
      .multiplyScalar(curvatureNdc * halfWidth * turnSign * randomRange(random, 0.35, 0.9))
      .addScaledVector(this.tmpRouteBasisUp, curvatureNdc * halfHeight * randomRange(random, -0.7, 0.7));
    this.tmpRouteControlB
      .copy(this.tmpRouteControlA)
      .multiplyScalar(-randomRange(random, 0.46, 0.9));

    controlA.copy(start).addScaledVector(line, randomRange(random, 0.26, 0.38)).add(this.tmpRouteControlA);
    controlB.copy(start).addScaledVector(line, randomRange(random, 0.62, 0.78)).add(this.tmpRouteControlB);

    if (previousRoute?.mode === 'internal') {
      sampleCubicBezierTangent(
        previousRoute,
        clamp(data.routeProgress ?? 1, 0, 1),
        this.tmpRoutePreviousTangent,
      );
      const alignment = this.tmpRouteLineDirection.copy(line).normalize().dot(this.tmpRoutePreviousTangent);
      if (Number.isFinite(alignment) && alignment > -0.25) {
        const tangentLength = clamp(
          lineLength * randomRange(random, 0.2, 0.32),
          data.radius * 2.2,
          lineLength * 0.42,
        );
        this.tmpRouteControlA.copy(start).addScaledVector(this.tmpRoutePreviousTangent, tangentLength);
        controlA.lerp(this.tmpRouteControlA, 0.82);
      }
    }

    data.macroAmplitude.set(
      Math.max(data.radius * 1.4, Math.abs(end.x - start.x) * 0.24),
      Math.max(data.radius * 1.2, Math.abs(end.y - start.y) * 0.24),
      Math.max(data.radius * 0.7, Math.abs(end.z - start.z) * 0.18),
    );

    const route = {
      mode,
      start,
      controlA,
      controlB,
      end,
      duration,
      depthBand: data.depthBand,
      cohortId: data.cohortId,
      startedAt: performance.now(),
      length: lineLength,
      ndcDistance,
    };
    const { samples, length } = createRouteLengthSamples(route, mode === 'internal' ? 24 : 18);
    route.lengthSamples = samples;
    route.curveLength = length;
    return route;
  }

  startRoute(sphere, mode = 'internal') {
    const data = sphere.userData;
    data.route = this.createStreamRoute(sphere, mode);
    data.routeProgress = 0;
    sampleCubicBezier(data.route, 0, this.tmpRouteSample);
    data.currentPosition.copy(this.tmpRouteSample);
    data.motionTarget.copy(this.tmpRouteSample);
    sphere.position.copy(this.tmpRouteSample);
  }

  async loadMemoryIntoSlot(sphere, memory, {
    initial = false,
    enterMode = 'entering',
    resolveWhenInteractive = false,
  } = {}) {
    if (!sphere || !memory?.id) return null;
    const existing = this.memorySpheres.get(memory.id);
    if (existing && existing !== sphere) return existing;

    const data = sphere.userData;
    const token = data.preloadToken + 1;
    data.preloadToken = token;
    data.pendingNextMemoryId = memory.id;
    this.setSlotLifecycle(sphere, BubbleLifecycle.PRELOADING, {
      interaction: BubbleInteraction.NONE,
      visible: false,
      interactive: false,
    });

    const texture = await this.preloadMemory(memory);
    if (data.preloadToken !== token || data.pendingNextMemoryId !== memory.id) return null;

    data.memory = memory;
    data.memoryId = memory.id;
    data.index = this.getMemoryIndex(memory);
    data.texture = texture;
    data.ownedMaterial.map = texture;
    data.ownedMaterial.needsUpdate = true;
    data.routeRandom = seededRandom(`${this.layoutSeed}:route:${data.slotId}:${memory.id}:${this.getExposure(memory.id)?.shownCount ?? 0}`);
    data.cohortId = Math.floor(data.routeRandom() * STREAM_COHORTS.length);
    data.enterSide = STREAM_COHORTS[data.cohortId]?.enterSide;
    data.exitSide = STREAM_COHORTS[data.cohortId]?.exitSide;
    data.visibleAlpha = initial ? 1 : 0;
    data.visibleTarget = 1;
    data.opacity = initial ? 1 : 0;
    data.targetOpacity = 1;
    data.speedMultiplier = 1;
    data.targetSpeedMultiplier = 1;
    data.interaction = BubbleInteraction.NONE;
    data.pendingNextMemoryId = null;

    this.memorySpheres.set(memory.id, sphere);
    this.visibleMemoryIdSet.add(memory.id);
    if (!this.visibleMemoryIds.includes(memory.id)) this.visibleMemoryIds.push(memory.id);
    this.markMemoryDisplayed(memory.id);

    if (initial || enterMode === 'initial') {
      sphere.position.copy(data.anchorPosition ?? data.currentPosition);
      data.currentPosition.copy(sphere.position);
      data.motionTarget.copy(sphere.position);
      this.setSlotLifecycle(sphere, BubbleLifecycle.ACTIVE, {
        visible: true,
        interactive: true,
      });
      this.markSlotActive(sphere);
      this.startRoute(sphere, 'internal');
      data.visibleAlpha = 1;
      data.opacity = 1;
      data.ownedMaterial.opacity = VISUAL_COMPOSITION.memoryMaterial.browsingOpacity;
    } else {
      this.setSlotLifecycle(sphere, BubbleLifecycle.ENTERING, {
        visible: true,
        interactive: false,
      });
      this.startRoute(sphere, 'entering');
    }

    if (resolveWhenInteractive) {
      return new Promise((resolve) => {
        data.pendingResolve = resolve;
      });
    }

    return sphere;
  }

  primePreloadQueue() {
    const targetSize = MEMORY_STREAM_CONFIG.preloadQueueSize;
    const protectedIds = new Set([
      ...this.visibleMemoryIdSet,
      ...this.nextMemoryQueue.map((entry) => entry.memoryId),
      ...this.spheres.map((sphere) => sphere.userData.pendingNextMemoryId).filter(Boolean),
    ]);

    const candidates = this.currentMemories
      .map((memory, index) => ({
        memory,
        index,
        score: this.getMemoryVisibilityScore(memory, index) - (protectedIds.has(memory.id) ? 100000 : 0),
      }))
      .filter((entry) => !protectedIds.has(entry.memory.id))
      .sort((a, b) => b.score - a.score);

    while (this.nextMemoryQueue.length < targetSize && candidates.length > 0) {
      const { memory } = candidates.shift();
      this.nextMemoryQueue.push({ memoryId: memory.id, status: 'loading' });
      this.preloadMap.set(memory.id, this.preloadMemory(memory).then(() => {
        const queued = this.nextMemoryQueue.find((entry) => entry.memoryId === memory.id);
        if (queued) queued.status = 'ready';
        return memory;
      }));
    }
  }

  getNextQueuedMemory() {
    this.primePreloadQueue();
    const index = this.nextMemoryQueue.findIndex((entry) => !this.visibleMemoryIdSet.has(entry.memoryId));
    if (index < 0) return this.chooseHiddenMemoryForRotation();
    const [entry] = this.nextMemoryQueue.splice(index, 1);
    return this.currentMemoryById.get(entry.memoryId) ?? this.chooseHiddenMemoryForRotation();
  }

  setMemories(memories, seed = 'memory-bubbles') {
    this.currentMemories = Array.from(memories ?? []);
    this.currentMemoryById = new Map(this.currentMemories.map((memory) => [memory.id, memory]));
    this.clearBubbles();
    this.layoutSeed = seed;
    this.memoryRotationRandom = seededRandom(`${seed}:memory-rotation`);
    this.motionRoleRandom = seededRandom(`${seed}:motion-role`);
    this.memoryExposure = new Map();
    this.memoryDisplayCounts.clear();
    this.nextMemoryQueue = [];
    this.preloadMap.clear();
    this.pendingSlotPromises.clear();
    this.completedRecycleCount = 0;
    this.lastRecycleAt = 0;
    this.focusedId = null;
    this.activeFocusId = null;
    this.focusAmount = 0;
    this.cancelTransition(false);

    const visibleMemories = this.selectVisibleMemories();
    this.visibleMemoryIds = visibleMemories.map((memory) => memory.id);
    this.visibleMemoryIdSet = new Set(this.visibleMemoryIds);

    const layoutResult = this.createLayout(visibleMemories);
    const layoutById = new Map(layoutResult.items.map((item) => [item.memoryId, item]));
    this.layoutMetrics = layoutResult.metrics;

    visibleMemories.forEach((memory) => {
      const layoutItem = layoutById.get(memory.id);
      const sphere = this.createMemorySphere(memory, layoutItem, this.getMemoryIndex(memory), {
        visibleAlpha: 0,
        poolState: 'pooled',
      });
      void this.loadMemoryIntoSlot(sphere, memory, {
        initial: true,
        enterMode: 'initial',
      });
    });

    this.assignMotionRoles({ immediate: true });
    this.scheduleNextMemoryRotation();
    this.scheduleNextMotionRoleRotation();
    this.configureAmbientLayer({ forceRebuild: true });
    this.primePreloadQueue();
    this.refreshPreviewPlayback();
  }

  disposeSphereResources(sphere) {
    if (!sphere) return;
    const { video, ownedMaterial, auraMaterial, shellMaterial } = sphere.userData;
    video?.pause();
    if (video) {
      video.removeAttribute('src');
      video.load();
    }
    auraMaterial?.dispose?.();
    shellMaterial?.dispose?.();
    ownedMaterial?.dispose?.();
  }

  removeMemorySphere(sphere) {
    if (!sphere) return;
    const memoryId = sphere.userData.memoryId;
    this.disposeSphereResources(sphere);
    this.memoryBubbleGroup.remove(sphere);
    this.spheres = this.spheres.filter((item) => item !== sphere);
    this.memorySlots = this.memorySlots.filter((item) => item !== sphere);
    this.interactiveMemoryObjects = this.interactiveMemoryObjects.filter((item) => item !== sphere);
    if (this.memorySpheres.get(memoryId) === sphere) this.memorySpheres.delete(memoryId);
    this.visibleMemoryIdSet.delete(memoryId);
    this.visibleMemoryIds = this.visibleMemoryIds.filter((id) => id !== memoryId);
  }

  createLayoutItemFromSlot(slotData, memory) {
    const anchor = slotData.anchorPosition?.clone?.() ?? slotData.currentPosition?.clone?.() ?? new THREE.Vector3(0, 0, -1.6);
    return {
      layout: slotData.layout ?? MEMORY_CLOUD_LAYOUT,
      layoutSeed: slotData.layoutSeed ?? `${MEMORY_CLOUD_LAYOUT}:${this.layoutSeed}`,
      index: this.getMemoryIndex(memory),
      memoryId: memory.id,
      key: memory.id,
      anchorPosition: anchor.clone(),
      homeAnchor: anchor.clone(),
      currentPosition: anchor.clone(),
      roamingTarget: anchor.clone(),
      separationOffset: slotData.separationOffset?.clone?.() ?? new THREE.Vector3(),
      interactionOffset: new THREE.Vector3(),
      motionProfile: slotData.motionProfile,
      radius: slotData.radius,
      baseScale: slotData.baseScale,
      depth: slotData.depth,
      depthBand: slotData.depthBand,
      sizeBucket: slotData.sizeBucket,
      driftAmplitude: slotData.driftAmplitude?.clone?.() ?? new THREE.Vector3(0.08, 0.06, 0.04),
      driftFrequency: slotData.driftFrequency?.clone?.() ?? new THREE.Vector3(0.42, 0.36, 0.28),
      driftPhase: slotData.driftPhase?.clone?.() ?? new THREE.Vector3(),
      driftSecondaryPhase: slotData.driftSecondaryPhase?.clone?.() ?? new THREE.Vector3(),
      driftTime: slotData.driftTime ?? 0,
      screen: slotData.screen,
      region: slotData.region,
      debugColor: slotData.debugColor,
    };
  }

  getReplaceableSphere() {
    const viewport = this.getMotionViewport();
    const now = performance.now();
    const minResidence = this.reducedMotion
      ? MEMORY_STREAM_CONFIG.reducedMotionMinVisibleResidence
      : viewport.isMobile
        ? MEMORY_STREAM_CONFIG.mobileMinVisibleResidence
        : MEMORY_STREAM_CONFIG.minVisibleResidence;
    let best = null;
    let bestScore = -Infinity;

    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      if (data.lifecycle !== BubbleLifecycle.ACTIVE) return;
      if (data.interaction !== BubbleInteraction.NONE) return;
      if (data.memoryId === this.hoveredId || data.memoryId === this.activeFocusId || data.memoryId === this.focusedId) return;
      if (this.pointerDown?.memoryId === data.memoryId) return;
      if (now - (data.enteredAt ?? 0) < minResidence * 1000) return;
      if (now - (data.lastInteractionAt ?? 0) < MEMORY_STREAM_CONFIG.recentCloseProtection * 1000) return;

      const screen = projectBubbleToScreen({
        position: sphere.position,
        radius: Math.max(data.radius * this.bubbleScale, data.radius),
        camera: this.camera,
        viewport,
      });
      const edgeAmount = Math.max(Math.abs(screen.ndcX), Math.abs(screen.ndcY));
      const depthWeight = data.depthBand === 'far' ? 0.18 : data.depthBand === 'mid' ? 0.06 : -0.22;
      const sizeWeight = data.sizeBucket === 'emphasis' ? -0.42 : data.sizeBucket === 'small' ? 0.18 : 0;
      const age = clamp((now - (data.enteredAt ?? now)) / SLOT_REPLACEMENT_SCORE.fullAgeMs, 0, 1);
      const restProgress = data.lastSlotReplacementAt
        ? clamp((now - data.lastSlotReplacementAt) / SLOT_REPLACEMENT_SCORE.fullRestMs, 0, 1)
        : 1;
      const replacementCount = data.slotReplacementCount ?? 0;
      const centerPenalty = Math.abs(screen.ndcX) < 0.28 && Math.abs(screen.ndcY) < 0.24
        ? SLOT_REPLACEMENT_SCORE.centerPenalty
        : 0;
      const repeatPenalty = replacementCount > 0
        ? (1 - restProgress) * SLOT_REPLACEMENT_SCORE.repeatPenalty +
          Math.min(0.42, replacementCount * SLOT_REPLACEMENT_SCORE.replacementCountPenalty)
        : 0;
      const slotFreshness =
        restProgress * SLOT_REPLACEMENT_SCORE.restWeight +
        (replacementCount === 0 ? SLOT_REPLACEMENT_SCORE.neverReplacedBonus : 0);
      const slotJitter = (
        hashString(`${this.layoutSeed}:replace-slot:${data.slotId}:${this.completedRecycleCount}`) /
        4294967296
      ) * SLOT_REPLACEMENT_SCORE.jitter;
      const score =
        age * SLOT_REPLACEMENT_SCORE.ageWeight +
        edgeAmount * SLOT_REPLACEMENT_SCORE.edgeWeight +
        slotFreshness +
        depthWeight +
        sizeWeight +
        slotJitter -
        centerPenalty -
        repeatPenalty -
        (data.localFocus ?? 0) * SLOT_REPLACEMENT_SCORE.localFocusPenalty;

      if (score > bestScore) {
        bestScore = score;
        best = sphere;
      }
    });

    return best;
  }

  chooseHiddenMemoryForRotation() {
    const visible = this.visibleMemoryIdSet;
    this.primePreloadQueue();
    const candidates = this.currentMemories
      .map((memory, index) => ({
        memory,
        index,
        score: this.getMemoryVisibilityScore(memory, index) - (visible.has(memory.id) ? 100 : 0),
      }))
      .filter((entry) => !visible.has(entry.memory.id))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });

    return candidates[0]?.memory ?? null;
  }

  getTransitionCount() {
    return this.spheres.filter((sphere) => isTransitionLifecycle(sphere.userData.lifecycle)).length;
  }

  startSlotLeaving(sphere, {
    nextMemory = null,
    interaction = BubbleInteraction.NONE,
    force = false,
  } = {}) {
    if (!sphere) return false;
    const data = sphere.userData;
    if (!force && data.lifecycle !== BubbleLifecycle.ACTIVE && data.lifecycle !== BubbleLifecycle.ENTERING) return false;
    if (!force && data.interaction !== BubbleInteraction.NONE) return false;

    data.pendingNextMemoryId = nextMemory?.id ?? data.pendingNextMemoryId ?? null;
    data.targetOpacity = 0;
    data.visibleTarget = 0;
    data.interaction = interaction;
    data.lastInteractionAt = performance.now();
    this.removeInteractiveObject(sphere);
    this.setSlotLifecycle(sphere, BubbleLifecycle.LEAVING, {
      interaction,
      visible: true,
      interactive: false,
    });
    this.startRoute(sphere, 'leaving');
    return true;
  }

  finishLeavingSlot(sphere) {
    const data = sphere.userData;
    const pendingMemoryId = data.pendingNextMemoryId;
    const pendingResolve = data.pendingResolve;
    this.setSlotPooled(sphere);
    this.completedRecycleCount += 1;
    this.lastRecycleAt = performance.now();
    this.pendingSlotPromises.delete(data.slotId);

    if (!pendingMemoryId) {
      pendingResolve?.(null);
      return;
    }

    const nextMemory = this.currentMemoryById.get(pendingMemoryId);
    if (!nextMemory) {
      pendingResolve?.(null);
      return;
    }

    void this.loadMemoryIntoSlot(sphere, nextMemory, {
      enterMode: 'entering',
      resolveWhenInteractive: Boolean(pendingResolve),
    }).then((loadedSphere) => {
      if (pendingResolve && loadedSphere) pendingResolve(loadedSphere);
      else if (pendingResolve) pendingResolve(null);
    });
  }

  replaceVisibleMemory(slotSphere, nextMemory, { waitForFade = false } = {}) {
    if (!slotSphere || !nextMemory) return Promise.resolve(this.memorySpheres.get(nextMemory?.id) ?? null);
    const existing = this.memorySpheres.get(nextMemory.id);
    if (existing) return Promise.resolve(existing);

    const slotData = slotSphere.userData;
    if (slotData.lifecycle === BubbleLifecycle.LEAVING && slotData.pendingNextMemoryId === nextMemory.id) {
      return this.pendingSlotPromises.get(slotData.slotId) ?? Promise.resolve(slotSphere);
    }

    let pendingResolve = null;
    const promise = new Promise((resolve) => {
      pendingResolve = resolve;
      slotData.pendingResolve = resolve;
      slotData.pendingNextMemoryId = nextMemory.id;
    });
    slotData.pendingResolve = pendingResolve;
    this.pendingSlotPromises.set(slotData.slotId, promise);

    const started = this.startSlotLeaving(slotSphere, {
      nextMemory,
      interaction: BubbleInteraction.NONE,
      force: waitForFade,
    });
    if (!started) {
      this.pendingSlotPromises.delete(slotData.slotId);
      slotData.pendingResolve = null;
      pendingResolve?.(null);
    }

    this.assignMotionRoles();
    this.refreshPreviewPlayback();
    return promise;
  }

  ensureMemoryVisible(memoryId, { waitForFade = false } = {}) {
    const existing = this.memorySpheres.get(memoryId);
    if (existing) {
      if (existing.userData.lifecycle === BubbleLifecycle.ACTIVE) return Promise.resolve(existing);
      if (existing.userData.lifecycle === BubbleLifecycle.ENTERING) {
        return new Promise((resolve) => {
          const previousResolve = existing.userData.pendingResolve;
          existing.userData.pendingResolve = (sphere) => {
            previousResolve?.(sphere);
            resolve(sphere);
          };
        });
      }
      return Promise.resolve(existing);
    }

    const memory = this.currentMemoryById.get(memoryId);
    if (!memory) return Promise.resolve(null);

    const slot = this.getReplaceableSphere();
    if (!slot) {
      const fallbackSlot = this.spheres.find((sphere) =>
        sphere.userData.lifecycle === BubbleLifecycle.ACTIVE &&
        sphere.userData.memoryId !== this.hoveredId &&
        sphere.userData.memoryId !== this.activeFocusId &&
        sphere.userData.interaction === BubbleInteraction.NONE
      );
      if (!fallbackSlot) return Promise.resolve(null);
      return this.replaceVisibleMemory(fallbackSlot, memory, { waitForFade });
    }
    return this.replaceVisibleMemory(slot, memory, { waitForFade });
  }

  updatePoolTransitions(delta) {
    const ease = dampFactor(this.reducedMotion ? 14 : 5.6, delta);

    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      if (data.lifecycle === BubbleLifecycle.POOLED || data.lifecycle === BubbleLifecycle.PRELOADING) return;

      const target = data.targetOpacity ?? data.visibleTarget ?? 1;
      data.visibleAlpha += (target - data.visibleAlpha) * ease;
      data.visibleAlpha = clamp(data.visibleAlpha, 0, 1);
    });
  }

  updateVisibleMemoryRotation(time) {
    if (this.currentMemories.length <= this.visibleMemoryIds.length) return;
    if (this.focusAmount > 0.001 || this.activeFocusId) return;
    if (!this.pageVisible) return;
    if (time < this.nextMemoryRotationAt) return;
    const transitionCount = this.getTransitionCount();
    const enteringCount = this.spheres.filter((sphere) => sphere.userData.lifecycle === BubbleLifecycle.ENTERING).length;
    const leavingCount = this.spheres.filter((sphere) => sphere.userData.lifecycle === BubbleLifecycle.LEAVING).length;
    if (
      transitionCount >= MEMORY_STREAM_CONFIG.maxSimultaneousTransitions ||
      enteringCount >= MEMORY_STREAM_CONFIG.maxSimultaneousEntering ||
      leavingCount >= MEMORY_STREAM_CONFIG.maxSimultaneousLeaving
    ) {
      this.scheduleNextMemoryRotation(time);
      return;
    }

    const nextMemory = this.getNextQueuedMemory();
    const slot = this.getReplaceableSphere();
    if (nextMemory && slot) {
      void this.replaceVisibleMemory(slot, nextMemory);
      this.lastRecycleAt = time;
    }
    this.primePreloadQueue();
    this.scheduleNextMemoryRotation(time);
  }

  assignMotionRoles({ immediate = false } = {}) {
    const visibleSpheres = this.spheres.filter((sphere) => isRenderableLifecycle(sphere.userData.lifecycle));
    if (visibleSpheres.length === 0) return;

    const config = VISUAL_COMPOSITION.motionRoles;
    const activeRatio = this.reducedMotion ? config.reducedActiveRatio : config.activeRatio;
    const activeCount = Math.max(0, Math.round(visibleSpheres.length * activeRatio));
    const calmCount = Math.max(0, Math.round(visibleSpheres.length * config.calmRatio));
    const ranked = visibleSpheres
      .map((sphere) => {
        const data = sphere.userData;
        const largePenalty = data.sizeBucket === 'emphasis' ? 0.42 : 0;
        const foregroundPenalty = data.depthBand === 'near' ? 0.22 : 0;
        return {
          sphere,
          score: hashString(`${this.layoutSeed}:role:${this.motionRoleEpoch}:${data.memoryId}`) / 4294967296 -
            largePenalty -
            foregroundPenalty,
        };
      })
      .sort((a, b) => b.score - a.score);
    const active = new Set(ranked.slice(0, activeCount).map((entry) => entry.sphere));
    const calm = new Set(ranked.slice(-calmCount).map((entry) => entry.sphere));

    visibleSpheres.forEach((sphere) => {
      const data = sphere.userData;
      const role = active.has(sphere) ? 'active' : calm.has(sphere) ? 'calm' : 'normal';
      data.motionRole = role;
      data.motionRoleTargetFactor = config.factors[role] ?? config.factors.normal;
      if (this.reducedMotion && role !== 'active') data.motionRoleTargetFactor = config.factors.calm;
      if (immediate) data.motionRoleFactor = data.motionRoleTargetFactor;
    });
  }

  updateMotionRoles(delta, time) {
    if (time >= this.nextMotionRoleRotationAt && !this.hoveredId && !this.activeFocusId) {
      this.motionRoleEpoch += 1;
      this.assignMotionRoles();
      this.scheduleNextMotionRoleRotation(time);
    }

    const ease = dampFactor(this.reducedMotion ? 6 : 1.35, delta);
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      data.motionRoleFactor += ((data.motionRoleTargetFactor ?? 0.62) - data.motionRoleFactor) * ease;
    });
  }

  getInteractiveHit() {
    if (this.interactiveMemoryObjects.length === 0) return null;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates = this.interactiveMemoryObjects.filter((sphere) =>
      sphere.visible &&
      sphere.userData.lifecycle === BubbleLifecycle.ACTIVE &&
      sphere.userData.interaction !== BubbleInteraction.PRESSED &&
      sphere.userData.memoryId
    );
    const hits = this.raycaster.intersectObjects(candidates, false);
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

    const previousSphere = this.hoveredId ? this.memorySpheres.get(this.hoveredId) : null;
    if (previousSphere?.userData.interaction === BubbleInteraction.HOVERED) {
      previousSphere.userData.interaction = BubbleInteraction.NONE;
      if (previousSphere.userData.lifecycle === BubbleLifecycle.ACTIVE) this.addInteractiveObject(previousSphere);
    }

    this.hoveredId = memoryId;
    this.canvas.style.cursor = memoryId ? 'pointer' : '';

    const sphere = memoryId ? this.memorySpheres.get(memoryId) : null;
    if (sphere?.userData.lifecycle === BubbleLifecycle.ACTIVE) {
      sphere.userData.interaction = BubbleInteraction.HOVERED;
      sphere.userData.lastInteractionAt = performance.now();
      this.addInteractiveObject(sphere);
    }
    this.onHoverChange?.(sphere?.userData.memory ?? null, memoryId ? {
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
    } : null);
  }

  pickBubble(memoryId = null) {
    const hit = memoryId ? null : this.getInteractiveHit();
    const sphere = memoryId ? this.memorySpheres.get(memoryId) : hit?.object;
    if (!sphere || sphere.userData.lifecycle !== BubbleLifecycle.ACTIVE) return;

    sphere.userData.pulse = 1;
    this.onPick?.(sphere.userData.memory);
  }

  pulseMemory(memoryId) {
    const sphere = this.memorySpheres.get(memoryId);
    if (sphere) sphere.userData.pulse = 1;
  }

  async focusBubble(memoryId) {
    const sphere = await this.ensureMemoryVisible(memoryId, { waitForFade: true });
    if (!sphere || sphere.userData.lifecycle !== BubbleLifecycle.ACTIVE) return Promise.resolve(false);

    this.setHoveredBubble(null);
    this.cancelTransition(false);
    this.transitionToken += 1;
    const transitionId = this.transitionToken;
    this.focusedId = memoryId;
    this.activeFocusId = memoryId;
    sphere.userData.interaction = BubbleInteraction.FOCUSING;
    sphere.userData.lastInteractionAt = performance.now();
    this.removeInteractiveObject(sphere);
    sphere.userData.pulse = Math.max(sphere.userData.pulse ?? 0, 1);
    sphere.userData.focusStartPosition = sphere.position.clone();
    sphere.userData.currentPosition.copy(sphere.position);
    this.markMemoryDisplayed(memoryId);
    this.markMemoryOpened(memoryId);
    this.refreshPreviewPlayback();

    return this.startTransition({
      transitionId,
      from: this.focusAmount,
      to: 1,
      duration: this.reducedMotion ? REDUCED_MOTION_DURATION : FOCUS_DURATION,
      onDone: () => {
        if (sphere.userData.memoryId === memoryId) sphere.userData.interaction = BubbleInteraction.VIEWING;
      },
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
      const activeSphere = this.activeFocusId ? this.memorySpheres.get(this.activeFocusId) : null;
      if (activeSphere?.userData.lifecycle === BubbleLifecycle.ACTIVE) {
        activeSphere.userData.interaction = BubbleInteraction.NONE;
        this.addInteractiveObject(activeSphere);
      }
      this.focusAmount = 0;
      this.focusedId = null;
      this.activeFocusId = null;
      this.refreshPreviewPlayback();
      return Promise.resolve(true);
    }

    const closingMemoryId = this.activeFocusId;
    return this.startTransition({
      transitionId,
      from: this.focusAmount,
      to: 0,
      duration: this.reducedMotion ? REDUCED_MOTION_DURATION : EXIT_DURATION,
      onDone: () => {
        if (closingMemoryId && MEMORY_STREAM_CONFIG.closeBehavior === 'continue-and-recycle') {
          this.releaseFocusedBubbleToStream(closingMemoryId);
        }
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

  releaseFocusedBubbleToStream(memoryId) {
    const sphere = this.memorySpheres.get(memoryId);
    if (!sphere) return;
    const data = sphere.userData;
    if (data.lifecycle !== BubbleLifecycle.ACTIVE) return;

    data.currentPosition.copy(sphere.position);
    data.motionTarget.copy(sphere.position);
    data.interaction = BubbleInteraction.RETURNING;
    data.lastInteractionAt = performance.now();
    const nextMemory = this.getNextQueuedMemory();
    if (!nextMemory) {
      data.interaction = BubbleInteraction.NONE;
      this.markSlotActive(sphere);
      this.startRoute(sphere, 'internal');
      return;
    }
    this.startSlotLeaving(sphere, {
      nextMemory,
      interaction: BubbleInteraction.RETURNING,
      force: true,
    });
    this.primePreloadQueue();
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

  setBarrierMode(enabled) {
    this.barrierEnabled = Boolean(enabled);
    this.renderPipeline.setBarrierEnabled(this.barrierEnabled);
    this.resize();
    this.viewDirty = true;
    return this.barrierEnabled;
  }

  setDebugLayerMode(mode) {
    this.debugLayerMode = [
      'mediaOnly',
      'ambientOnly',
      'backgroundOnly',
      'quietZone',
      'motionRoles',
      'combined',
    ].includes(mode) ? mode : 'combined';
    this.applyDebugLayerVisibility();
    return this.debugLayerMode;
  }

  setOfficialReferenceMotion(enabled) {
    this.officialReferenceMotion = Boolean(enabled);
    this.ambientController.setOfficialReferenceMotion(this.officialReferenceMotion);
    return this.officialReferenceMotion;
  }

  applyDebugLayerVisibility() {
    if (!this.memoryBubbleGroup || !this.ambientBubbleGroup) return;
    this.memoryBubbleGroup.visible = !['ambientOnly', 'backgroundOnly'].includes(this.debugLayerMode);
    this.ambientBubbleGroup.visible = !['mediaOnly', 'backgroundOnly'].includes(this.debugLayerMode);
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
    this.assignMotionRoles();
    this.scheduleNextMemoryRotation();
    this.scheduleNextMotionRoleRotation();
    this.configureAmbientLayer();
  }

  setPageVisible(isVisible) {
    this.pageVisible = Boolean(isVisible);
    if (this.pageVisible) {
      this.lastFrameTime = performance.now();
      this.scheduleNextMemoryRotation();
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
      this.scene.environment = this.customEnvironmentTexture;
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
      this.scene.environment = cubeTexture;
      this.currentEnvMap = cubeTexture;
      this.updateSphereEnvironmentMap();
      this.viewDirty = true;
    });
    cubeTexture.colorSpace = THREE.SRGBColorSpace;
    this.customCubeTexture = cubeTexture;
    this.scene.background = cubeTexture;
    this.scene.environment = cubeTexture;
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
      this.scene.environment = this.defaultBackgroundTexture;
      this.currentEnvMap = this.defaultBackgroundTexture;
      this.updateFlatBackgroundTransform();
      this.updateSphereEnvironmentMap();
    });
    this.viewDirty = true;
  }

  resetBackground() {
    this.disposeCustomBackground();
    this.currentEnvMap = this.defaultBackgroundTexture;
    this.scene.background = this.defaultBackgroundTexture;
    this.scene.environment = this.defaultBackgroundTexture;
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
      sphere.material.needsUpdate = true;
      if (sphere.userData.shellMaterial) {
        sphere.userData.shellMaterial.envMap = this.currentEnvMap || this.defaultBackgroundTexture;
        sphere.userData.shellMaterial.needsUpdate = true;
      }
    });
    this.memoryShellMaterial.envMap = this.currentEnvMap || this.defaultBackgroundTexture;
    this.memoryShellMaterial.needsUpdate = true;
    this.ambientController.setEnvironmentMap(this.currentEnvMap, this.defaultBackgroundTexture);
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
      this.disposeSphereResources(sphere);
      this.memoryBubbleGroup.remove(sphere);
    });

    this.spheres = [];
    this.memorySlots = [];
    this.interactiveMemoryObjects = [];
    this.memorySpheres.clear();
    this.visibleMemoryIds = [];
    this.visibleMemoryIdSet.clear();
    this.pendingSlotPromises.clear();
    this.disposeTextureCache();
    this.layoutMetrics = null;
    this.setHoveredBubble(null);
    this.configureAmbientLayer();
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

    const roleFactor = clamp(data.motionRoleFactor ?? 0.62, 0.04, 1.1);
    amplitudeScale *= roleFactor;
    timeScale *= lerp(0.42, 1, roleFactor);

    return { amplitudeScale, timeScale };
  }

  getActiveMotionRamp(data, time) {
    if (data.lifecycle !== BubbleLifecycle.ACTIVE) return 1;
    const activeAge = Math.max(0, time - (data.enteredAt ?? time));
    return smoothstep(0, ACTIVE_MOTION_RAMP_MS, activeAge);
  }

  updateMotionHomeAnchor(data, delta) {
    if (!data.homeAnchor || !data.anchorPosition || data.layoutTransition) return;
    data.homeAnchor.lerp(data.anchorPosition, dampFactor(this.reducedMotion ? 1.6 : 0.24, delta));
    data.home = data.homeAnchor;
  }

  updateCameraParallax(delta, focusActive) {
    const viewport = this.getMotionViewport();
    const preset = this.motionPreset.cameraParallax;
    const viewMode = this.viewMode;
    const useParallax =
      this.parallaxEnabled &&
      !this.reducedMotion &&
      !focusActive &&
      this.pageVisible;
    const depth = CAMERA_HOME.z;
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    const translationScale = viewport.isMobile
      ? CAMERA_PARALLAX_CONFIG.mobileMultiplier
      : CAMERA_PARALLAX_CONFIG.desktopNdcMultiplier;
    const lookScale = viewport.isMobile
      ? CAMERA_PARALLAX_CONFIG.mobileMultiplier
      : CAMERA_PARALLAX_CONFIG.desktopLookMultiplier;
    const targetX = useParallax ? this.mouseX * halfWidth * preset.ndcX * viewMode.translationScale * translationScale : 0;
    const targetY = useParallax ? -this.mouseY * halfHeight * preset.ndcY * viewMode.translationScale * translationScale : 0;
    const targetLookX = useParallax ? -this.mouseX * halfWidth * preset.lookNdcX * lookScale : 0;
    const targetLookY = useParallax ? this.mouseY * halfHeight * preset.lookNdcY * lookScale : 0;
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
    const flowScale = profile.globalResponse * depthResponse * amplitudeScale * (viewport.isMobile ? 0.76 : 1) * (this.reducedMotion ? 0.08 : 1);
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

  updateStreamRouteMotion(sphere, delta, { timeScale = 1, amplitudeScale = 1 } = {}, viewport) {
    const data = sphere.userData;
    if (!data.route) {
      this.startRoute(sphere, data.lifecycle === BubbleLifecycle.ENTERING ? 'entering' : 'internal');
    }

    const route = data.route;
    if (!route) {
      this.tmpMotionTarget.copy(data.currentPosition ?? sphere.position);
      return this.tmpMotionTarget;
    }

    const duration = Math.max(0.001, route.duration);
    if (this.pageVisible && data.lifecycle !== BubbleLifecycle.POOLED && data.lifecycle !== BubbleLifecycle.PRELOADING) {
      data.routeProgress += (delta * timeScale * (data.speedMultiplier ?? 1)) / duration;
    }

    const sampleProgress = getRouteSampleProgress(route, data.routeProgress);
    sampleCubicBezier(route, sampleProgress, this.tmpRoutePosition);

    const profile = data.motionProfile;
    const cohort = STREAM_COHORTS[data.cohortId % STREAM_COHORTS.length] ?? STREAM_COHORTS[0];
    const depth = Math.max(0.8, this.getMotionDepth(data));
    const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
    const flowConfig = MEMORY_STREAM_CONFIG.cohortFlow;
    const flowScale =
      amplitudeScale *
      (viewport.isMobile ? MEMORY_STREAM_CONFIG.routeMobileScale : 1) *
      (this.reducedMotion ? flowConfig.reducedMotionScale : 1);
    const phaseX = profile?.phasePrimary?.x ?? 0;
    const phaseY = profile?.phasePrimary?.y ?? 0;
    const phaseZ = profile?.phasePrimary?.z ?? 0;

    this.tmpGlobalFlowOffset.set(
      Math.sin((this.motionElapsed * TWO_PI) / cohort.period + phaseX) * halfWidth * flowConfig.ndcX * flowScale,
      Math.sin((this.motionElapsed * TWO_PI) / (cohort.period * 1.23) + phaseY) * halfHeight * flowConfig.ndcY * flowScale,
      Math.sin((this.motionElapsed * TWO_PI) / (cohort.period * 1.61) + phaseZ) * depth * flowConfig.depth * flowScale,
    );

    this.tmpMotionTarget
      .copy(this.tmpRoutePosition)
      .add(this.tmpGlobalFlowOffset);
    data.roamingTarget.copy(this.tmpMotionTarget);
    return this.tmpMotionTarget;
  }

  isSlotOffscreen(sphere) {
    const margin = MEMORY_STREAM_CONFIG.offscreenMarginNdc * 0.72;
    const projected = this.tmpProjected.copy(sphere.position).project(this.camera);
    return (
      Math.abs(projected.x) > 1 + margin ||
      Math.abs(projected.y) > 1 + margin ||
      projected.z < -1 ||
      projected.z > 1
    );
  }

  updateStreamLifecycleAfterMotion(sphere, time) {
    const data = sphere.userData;
    if (data.lifecycle === BubbleLifecycle.ENTERING) {
      if (data.routeProgress >= 1) {
        this.markSlotActive(sphere, time);
        this.startRoute(sphere, 'internal');
      }
      return;
    }

    if (data.lifecycle === BubbleLifecycle.ACTIVE) {
      if (data.routeProgress >= 1) this.startRoute(sphere, 'internal');
      return;
    }

    if (data.lifecycle === BubbleLifecycle.LEAVING) {
      const invisibleEnough = data.visibleAlpha < MEMORY_STREAM_CONFIG.hiddenOpacityThreshold;
      if (invisibleEnough && sphere.visible) {
        this.setSlotRenderable(sphere, false);
      }
      if (data.routeProgress >= 1 || (invisibleEnough && this.isSlotOffscreen(sphere))) {
        this.finishLeavingSlot(sphere);
      }
    }
  }

  updateBoundaryOffset(data, position, target, centerOccupancy = null, scale = 1) {
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

    const occupancy = centerOccupancy ?? { total: 0, large: 0 };
    const centerX = projected.x / MEMORY_STREAM_CONFIG.centerNdcRadiusX;
    const centerY = projected.y / MEMORY_STREAM_CONFIG.centerNdcRadiusY;
    const centerDistance = Math.hypot(centerX, centerY);
    const centerOverflow =
      Math.max(0, occupancy.total - MEMORY_STREAM_CONFIG.maxCenterSlots) +
      (data.sizeBucket === 'emphasis'
        ? Math.max(0, occupancy.large - MEMORY_STREAM_CONFIG.maxLargeCenterSlots) * 1.4
        : 0);

    if (centerOverflow > 0 && centerDistance < 1) {
      const pushAmount = (1 - centerDistance) * Math.min(3, centerOverflow + 0.4) * preset.strength;
      const dirX = Math.abs(projected.x) > 0.02 ? Math.sign(projected.x) : (data.cohortId % 2 === 0 ? 1 : -1);
      const dirY = Math.abs(projected.y) > 0.02 ? Math.sign(projected.y) : (data.cohortId % 3 === 0 ? 1 : -1);
      correctionX += dirX * halfWidth * 0.22 * pushAmount;
      correctionY += dirY * halfHeight * 0.18 * pushAmount;
    }

    target.set(correctionX, correctionY, correctionZ).multiplyScalar(scale);
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
        const enteringSeparationScale = data.lifecycle === BubbleLifecycle.ENTERING
          ? getEnteringRamp(
            data.routeProgress ?? 0,
            MEMORY_STREAM_CONFIG.enteringSeparationStartProgress,
            MEMORY_STREAM_CONFIG.enteringSeparationFullProgress,
          )
          : 1;
        const participates =
          data.lifecycle === BubbleLifecycle.ACTIVE ||
          (data.lifecycle === BubbleLifecycle.ENTERING && enteringSeparationScale > 0.001);
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
        entry.forceScale = enteringSeparationScale;
        entry.active = participates && !data.isFocused && center.z >= -1 && center.z <= 1;
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

          const forceScale = Math.min(first.forceScale ?? 1, second.forceScale ?? 1);
          if (forceScale <= 0.001) continue;
          const overlap = desiredDistance - distance;
          const nx = dx / distance;
          const ny = dy / distance;
          const force = overlap * preset.strength * (sameDepth ? 0.52 : 0.28) * forceScale;
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
      const enteringSeparationScale = data.lifecycle === BubbleLifecycle.ENTERING
        ? getEnteringRamp(
          data.routeProgress ?? 0,
          MEMORY_STREAM_CONFIG.enteringSeparationStartProgress,
          MEMORY_STREAM_CONFIG.enteringSeparationFullProgress,
        )
        : 1;
      if (
        data.isFocused ||
        (data.lifecycle !== BubbleLifecycle.ACTIVE && data.lifecycle !== BubbleLifecycle.ENTERING) ||
        enteringSeparationScale <= 0.001
      ) {
        data.separationTargetOffset.set(0, 0, 0);
      }
      data.separationOffset.lerp(data.separationTargetOffset, ease);
    });
  }

  updateCenterLimit(delta) {
    const entries = [];

    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      data.centerLimitTargetOffset?.set(0, 0, 0);
      if (
        data.lifecycle !== BubbleLifecycle.ACTIVE &&
        data.lifecycle !== BubbleLifecycle.ENTERING
      ) {
        return;
      }

      const projected = this.tmpProjected.copy(data.isFocused ? sphere.position : data.motionTarget).project(this.camera);
      const normalizedX = projected.x / MEMORY_STREAM_CONFIG.centerNdcRadiusX;
      const normalizedY = projected.y / MEMORY_STREAM_CONFIG.centerNdcRadiusY;
      const distance = Math.hypot(normalizedX, normalizedY);
      if (distance >= 1) return;

      entries.push({
        sphere,
        data,
        projectedX: projected.x,
        projectedY: projected.y,
        distance,
        centerAmount: 1 - distance,
        isLarge: data.sizeBucket === 'emphasis',
        fixedKeep: data.isFocused || data.interaction === BubbleInteraction.VIEWING,
      });
    });

    entries.sort((a, b) => {
      if (a.fixedKeep !== b.fixedKeep) return a.fixedKeep ? -1 : 1;
      if (a.isLarge !== b.isLarge) return a.isLarge ? -1 : 1;
      return b.centerAmount - a.centerAmount;
    });

    let keptTotal = 0;
    let keptLarge = 0;
    entries.forEach((entry) => {
      if (entry.fixedKeep) {
        keptTotal += 1;
        if (entry.isLarge) keptLarge += 1;
        return;
      }

      const canKeep =
        keptTotal < MEMORY_STREAM_CONFIG.maxCenterSlots &&
        (!entry.isLarge || keptLarge < MEMORY_STREAM_CONFIG.maxLargeCenterSlots);

      if (canKeep) {
        keptTotal += 1;
        if (entry.isLarge) keptLarge += 1;
        return;
      }

      const data = entry.data;
      const depth = Math.max(0.8, this.getMotionDepth(data));
      const { halfWidth, halfHeight } = this.getVisibleHalfSizeAtDepth(depth);
      const dirX = Math.abs(entry.projectedX) > 0.025 ? Math.sign(entry.projectedX) : (data.cohortId % 2 === 0 ? 1 : -1);
      const dirY = Math.abs(entry.projectedY) > 0.025 ? Math.sign(entry.projectedY) : (data.cohortId % 3 === 0 ? 1 : -1);
      const push = Math.max(0, 1 - entry.distance) * 0.78;

      data.centerLimitTargetOffset.set(
        dirX * halfWidth * MEMORY_STREAM_CONFIG.centerNdcRadiusX * push,
        dirY * halfHeight * MEMORY_STREAM_CONFIG.centerNdcRadiusY * push,
        0,
      );
    });

    const ease = dampFactor(this.reducedMotion ? 10 : 7.2, delta);
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      if (!data.centerLimitOffset || !data.centerLimitTargetOffset) return;
      data.centerLimitOffset.lerp(data.centerLimitTargetOffset, ease);
    });
  }

  sampleMotionDebug(time, viewport) {
    if (!this.motionDebug || time - this.motionSampleAt < 250) return;
    this.motionSampleAt = time;

    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      if (!isRenderableLifecycle(data.lifecycle)) return;
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

  updateLocalHoverFocus(delta, viewport, focusActive) {
    let hoverScreen = null;
    if (this.hoveredId && !focusActive) {
      const hoveredSphere = this.memorySpheres.get(this.hoveredId);
      if (hoveredSphere) {
        const data = hoveredSphere.userData;
        hoverScreen = projectBubbleToScreen({
          position: hoveredSphere.position,
          radius: Math.max(data.radius * this.bubbleScale, data.radius),
          camera: this.camera,
          viewport,
        });
      }
    }

    const influenceRadius = viewport.shortSide * 0.26;
    const ease = dampFactor(hoverScreen ? 7.5 : 4.2, delta);
    this.spheres.forEach((sphere) => {
      const data = sphere.userData;
      let target = 0;

      if (hoverScreen && data.memoryId !== this.hoveredId && data.lifecycle === BubbleLifecycle.ACTIVE) {
        const screen = projectBubbleToScreen({
          position: sphere.position,
          radius: Math.max(data.radius * this.bubbleScale, data.radius),
          camera: this.camera,
          viewport,
        });
        const distance = Math.hypot(screen.x - hoverScreen.x, screen.y - hoverScreen.y);
        target = distance < influenceRadius
          ? Math.pow(1 - distance / influenceRadius, 1.7)
          : 0;
      }

      data.localFocus += (target - (data.localFocus ?? 0)) * ease;
    });
  }

  setSceneQuality(qualityName) {
    const nextQuality = normalizeQualityName(qualityName, this.qualityPreset);
    if (nextQuality === this.qualityPreset) return false;

    this.qualityPreset = nextQuality;
    this.ambientController.setQualityName(nextQuality);
    this.resize();
    return true;
  }

  updatePerformanceStats(delta, time, viewport) {
    if (!this.pageVisible || delta <= 0) return;

    const frameMs = delta * 1000;
    this.frameSamples.push({ time, frameMs });
    const sampleWindow = RENDER_QUALITY_CONFIG.frameSampleWindowMs;
    while (this.frameSamples.length > 0 && time - this.frameSamples[0].time > sampleWindow) {
      this.frameSamples.shift();
    }

    if (this.frameSamples.length === 0) return;
    const totalFrameMs = this.frameSamples.reduce((sum, sample) => sum + sample.frameMs, 0);
    this.averageFrameMs = totalFrameMs / this.frameSamples.length;
    this.averageFps = this.averageFrameMs > 0 ? 1000 / this.averageFrameMs : 0;

    if (time - this.lastQualitySwitchAt < RENDER_QUALITY_CONFIG.minQualitySwitchMs) return;
    const qualityIndex = SCENE_QUALITY_ORDER.indexOf(this.qualityPreset);
    const baseIndex = SCENE_QUALITY_ORDER.indexOf(this.baseQualityPreset);

    if (this.averageFrameMs > RENDER_QUALITY_CONFIG.downgradeFrameMs && qualityIndex > 0) {
      if (this.setSceneQuality(getLowerQuality(this.qualityPreset))) this.lastQualitySwitchAt = time;
      return;
    }

    if (
      this.averageFrameMs < RENDER_QUALITY_CONFIG.upgradeFrameMs &&
      qualityIndex >= 0 &&
      qualityIndex < baseIndex &&
      !viewport.isMobile
    ) {
      if (this.setSceneQuality(getHigherQuality(this.qualityPreset))) this.lastQualitySwitchAt = time;
    }
  }

  getMotionSnapshot() {
    const viewport = this.getMotionViewport();
    const lifecycleCounts = this.spheres.reduce((counts, sphere) => {
      const lifecycle = sphere.userData.lifecycle ?? BubbleLifecycle.POOLED;
      counts[lifecycle] = (counts[lifecycle] ?? 0) + 1;
      return counts;
    }, {
      [BubbleLifecycle.POOLED]: 0,
      [BubbleLifecycle.PRELOADING]: 0,
      [BubbleLifecycle.ENTERING]: 0,
      [BubbleLifecycle.ACTIVE]: 0,
      [BubbleLifecycle.LEAVING]: 0,
    });
    const shownInSession = Array.from(this.memoryExposure.values())
      .filter((entry) => entry.shownInCurrentSession).length;
    return {
      time: this.motionElapsed,
      preset: this.motionPresetName,
      viewMode: this.viewModeName,
      reducedMotion: this.reducedMotion,
      renderMode: this.renderPipeline.getMode(),
      barrierEnabled: this.barrierEnabled,
      cameraParallaxEnabled: this.parallaxEnabled,
      quality: this.qualityPreset,
      dpr: this.renderPipeline.currentDpr,
      averageFps: this.averageFps,
      averageFrameMs: this.averageFrameMs,
      activeVideoTextures: this.spheres.filter((sphere) => Boolean(sphere.userData.video)).length,
      totalMemoryCount: this.currentMemories.length,
      visibleMemoryCount: this.visibleMemoryIdSet.size,
      slotCount: this.spheres.length,
      lifecycleCounts,
      shownInSession,
      completedRecycleCount: this.completedRecycleCount,
      lastRecycleAt: this.lastRecycleAt,
      nextRecycleInMs: Math.max(0, this.nextMemoryRotationAt - performance.now()),
      preloadQueue: this.nextMemoryQueue.map((entry) => ({ ...entry })),
      hoveredId: this.hoveredId,
      focusedId: this.activeFocusId,
      motionRoleCounts: this.spheres.reduce((counts, sphere) => {
        const role = sphere.userData.motionRole ?? 'normal';
        counts[role] = (counts[role] ?? 0) + 1;
        return counts;
      }, { active: 0, normal: 0, calm: 0 }),
      composition: {
        desktop: VISUAL_COMPOSITION.desktop,
        mobile: VISUAL_COMPOSITION.mobile,
        centerQuietZone: VISUAL_COMPOSITION.centerQuietZone,
      },
      raycasterCandidates: this.interactiveMemoryObjects.length,
      cameraParallax: this.cameraParallaxOffset.toArray(),
      cameraLook: this.cameraLookOffset.toArray(),
      cameraRotation: this.cameraRotationOffset.toArray(),
      ambient: this.ambientController.getSnapshot({
        camera: this.camera,
        viewport,
      }),
      bubbles: this.spheres.map((sphere) => {
        const data = sphere.userData;
        const screen = projectBubbleToScreen({
          position: sphere.position,
          radius: Math.max(data.radius * this.bubbleScale, data.radius),
          camera: this.camera,
          viewport,
        });

        return {
          slotId: data.slotId,
          id: data.memoryId,
          depthBand: data.depthBand,
          objectVisible: sphere.visible,
          x: screen.x,
          y: screen.y,
          radius: screen.radius,
          ndcX: screen.ndcX,
          ndcY: screen.ndcY,
          visible: screen.isVisible,
          poolState: data.poolState,
          lifecycle: data.lifecycle,
          interaction: data.interaction,
          visibleAlpha: data.visibleAlpha ?? 1,
          routeProgress: data.routeProgress ?? 0,
          routeMode: data.route?.mode ?? null,
          routeDuration: data.route?.duration ?? 0,
          routeNdcDistance: data.route?.ndcDistance ?? 0,
          routeCurveLength: data.route?.curveLength ?? 0,
          speedMultiplier: data.speedMultiplier ?? 1,
          slotReplacementCount: data.slotReplacementCount ?? 0,
          lastSlotReplacementAt: data.lastSlotReplacementAt ?? 0,
          motionRole: data.motionRole ?? 'normal',
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
    this.updatePerformanceStats(delta, time, viewport);
    this.updatePoolTransitions(delta);
    this.updateVisibleMemoryRotation(time);
    this.updateMotionRoles(delta, time);
    this.updateCameraParallax(delta, focusActive);
    const focusTarget = this.getFocusTarget();
    const positionEase = dampFactor(this.reducedMotion ? 9 : this.motionPreset.positionDamping, delta);
    const centerOccupancy = this.getCenterOccupancy();

    for (let index = 0, total = this.spheres.length; index < total; index += 1) {
      const sphere = this.spheres[index];
      const data = sphere.userData;
      if (!isRenderableLifecycle(data.lifecycle)) continue;
      const isFocused = data.memoryId === this.activeFocusId;
      const isHovered = data.memoryId === this.hoveredId && !focusActive;
      const isPointerLocked = this.pointerDown?.memoryId === data.memoryId && !focusActive;
      data.isFocused = isFocused;
      data.isHovered = isHovered;
      this.updateAnchorTransition(data, time);

      const hoverTarget = isHovered || isPointerLocked ? 1 : 0;
      const hoverDamping = hoverTarget ? this.motionPreset.hoverSlowdown.dampingIn : this.motionPreset.hoverSlowdown.dampingOut;
      data.hoverMotion += (hoverTarget - data.hoverMotion) * dampFactor(hoverDamping, delta);
      data.targetSpeedMultiplier = isPointerLocked
        ? MEMORY_STREAM_CONFIG.pointerLockSpeedScale
        : isHovered
          ? MEMORY_STREAM_CONFIG.hoverSpeedScale
          : 1;
      const speedDamping = data.targetSpeedMultiplier < data.speedMultiplier
        ? MEMORY_STREAM_CONFIG.hoverDampingIn
        : MEMORY_STREAM_CONFIG.hoverDampingOut;
      data.speedMultiplier += (data.targetSpeedMultiplier - data.speedMultiplier) * dampFactor(speedDamping, delta);

      const exitingFocus = isFocused && this.focusTransition?.to === 0;
      const pausedForFocus = isFocused && !exitingFocus;
      const motionScale = this.getBubbleMotionScale({
        data,
        isFocused,
        focusActive,
        isPointerLocked,
      });
      const activeMotionRamp = this.getActiveMotionRamp(data, time);
      motionScale.amplitudeScale *= activeMotionRamp;

      if (this.pageVisible && !pausedForFocus) {
        data.motionTime += delta * motionScale.timeScale * (data.speedMultiplier ?? 1);
        data.driftTime += delta * motionScale.timeScale * (data.speedMultiplier ?? 1);
      }

      if (data.lifecycle === BubbleLifecycle.ACTIVE) {
        this.updateMotionHomeAnchor(data, delta);
        this.updateMacroRoaming(data, this.tmpMotionTarget, {
          amplitudeScale: motionScale.amplitudeScale,
          viewport,
        });
      } else {
        this.updateStreamRouteMotion(sphere, delta, motionScale, viewport);
      }
      this.updateMicroDrift(data, this.tmpMicroOffset);
      data.motionTarget
        .copy(data.roamingTarget)
        .add(this.tmpMicroOffset);
      if (data.lifecycle !== BubbleLifecycle.LEAVING) {
        const enteringBoundaryScale = data.lifecycle === BubbleLifecycle.ENTERING
          ? getEnteringRamp(
            data.routeProgress ?? 0,
            MEMORY_STREAM_CONFIG.enteringBoundaryStartProgress,
            MEMORY_STREAM_CONFIG.enteringBoundaryFullProgress,
          )
          : 1;
        if (enteringBoundaryScale > 0.001) {
          this.updateBoundaryOffset(data, data.motionTarget, this.tmpBoundaryOffset, centerOccupancy, enteringBoundaryScale);
          data.boundaryOffset.lerp(this.tmpBoundaryOffset, dampFactor(this.reducedMotion ? 12 : 6.2, delta));
        } else {
          this.tmpBoundaryOffset.set(0, 0, 0);
          data.boundaryOffset.lerp(this.tmpBoundaryOffset, dampFactor(this.reducedMotion ? 12 : 6.2, delta));
        }
        data.motionTarget.add(data.boundaryOffset);
      } else {
        data.boundaryOffset.set(0, 0, 0);
      }
    }

    this.updateCenterLimit(delta);
    this.updateSeparation(delta, viewport);
    this.updateLocalHoverFocus(delta, viewport, focusActive);

    for (let index = 0, total = this.spheres.length; index < total; index += 1) {
      const sphere = this.spheres[index];
      const data = sphere.userData;
      if (!isRenderableLifecycle(data.lifecycle)) continue;
      const isFocused = data.memoryId === this.activeFocusId;
      const isHovered = data.memoryId === this.hoveredId && !focusActive;

      this.tmpNormalPosition
        .copy(data.motionTarget)
        .add(data.centerLimitOffset ?? this.tmpBoundaryOffset.set(0, 0, 0))
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
      const enteringVisualProgress = data.lifecycle === BubbleLifecycle.ENTERING
        ? getEnteringRamp(
          data.routeProgress ?? 0,
          MEMORY_STREAM_CONFIG.enteringFadeStartProgress,
          MEMORY_STREAM_CONFIG.enteringFadeFullProgress,
        )
        : 1;
      const displayScale =
        this.getDisplayScale(data.baseScale, data.pulse, data.hover, focusScale) *
        (1 + breath) *
        lerp(0.84, 1, enteringVisualProgress);
      sphere.scale.setScalar(displayScale);

      const dimAmount = focusActive && !isFocused ? this.focusAmount : 0;
      const visibleAlpha = (data.visibleAlpha ?? 1) * enteringVisualProgress;
      const focusedOpacity = isFocused
        ? lerp(0.92, 0.72, this.focusAmount)
        : VISUAL_COMPOSITION.memoryMaterial.browsingOpacity;
      const localDim = clamp(data.localFocus ?? 0, 0, 1) * 0.22;
      const opacity = lerp(focusedOpacity, VISUAL_COMPOSITION.memoryMaterial.dimmedOpacity, dimAmount) *
        visibleAlpha *
        (1 - localDim);
      data.ownedMaterial.opacity = opacity;
      data.ownedMaterial.color.setScalar(
        lerp(1 - localDim * 0.5, 1.16, data.hover + (isFocused ? this.focusAmount * 0.22 : 0)),
      );

      data.auraMaterial.opacity =
        visibleAlpha * (
          data.hover * 0.2 +
          data.pulse * 0.16 +
          (isFocused ? this.focusAmount * 0.32 : 0)
        );
      data.shellMaterial.opacity =
        visibleAlpha *
        VISUAL_COMPOSITION.memoryMaterial.shellOpacity *
        (isFocused ? lerp(1, 0.32, this.focusAmount) : 1);

      sphere.renderOrder = isFocused ? 10 : 0;
      this.updateStreamLifecycleAfterMotion(sphere, time);
    }

    this.ambientController.update(delta, {
      elapsed: this.motionElapsed,
      viewport,
      focusAmount: this.focusAmount,
      focusActive,
      reducedMotion: this.reducedMotion,
      pageVisible: this.pageVisible,
      officialReferenceMotion: this.officialReferenceMotion,
    });
    this.applyDebugLayerVisibility();
    this.renderPipeline.render(this.scene, this.camera);

    this.sampleMotionDebug(time, viewport);
    if (this.layoutDebug || this.motionDebug || this.sceneDebug || this.compositionDebug || this.streamDebug) this.updateLayoutDebug();
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

    if (this.compositionDebug || this.debugLayerMode === 'quietZone') {
      const quietZone = VISUAL_COMPOSITION.centerQuietZone;
      context.save();
      context.translate(width * 0.5, height * 0.5);
      context.scale(quietZone.radiusX * width * 0.5, quietZone.radiusY * height * 0.5);
      context.beginPath();
      context.arc(0, 0, 1, 0, Math.PI * 2);
      context.restore();
      context.fillStyle = 'rgba(168, 255, 208, 0.055)';
      context.strokeStyle = 'rgba(168, 255, 208, 0.5)';
      context.setLineDash([4, 8]);
      context.fill();
      context.stroke();
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
      if (!isRenderableLifecycle(data.lifecycle)) return;
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
      const roleColor = data.motionRole === 'active'
        ? '#a8ffd0'
        : data.motionRole === 'calm'
          ? '#9aa8b2'
          : '#9fd8ff';
      const debugColor = this.debugLayerMode === 'motionRoles' || this.compositionDebug
        ? roleColor
        : data.debugColor ?? 'rgba(255,255,255,0.8)';
      context.strokeStyle = debugColor;
      context.fillStyle = debugColor;
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
    const panelHeight = this.sceneDebug || this.compositionDebug || this.streamDebug ? 212 : this.motionDebug ? 132 : 94;
    const panelWidth = this.sceneDebug || this.compositionDebug || this.streamDebug ? 680 : this.motionDebug ? 520 : 410;
    context.globalAlpha = 1;
    context.fillStyle = 'rgba(5, 10, 8, 0.72)';
    context.fillRect(16, height - panelHeight, panelWidth, panelHeight - 20);
    context.fillStyle = 'rgba(235, 255, 244, 0.92)';
    context.fillText(`layout=${this.layoutMode} seed=${this.layoutSeed}`, 28, height - panelHeight + 24);
    context.fillText(
      `regions LT:${counts.leftTop ?? 0} RT:${counts.rightTop ?? 0} LB:${counts.leftBottom ?? 0} RB:${counts.rightBottom ?? 0} C:${counts.center ?? 0}`,
      28,
      height - panelHeight + 44,
    );
    context.fillText(
      `depth near:${depths.near ?? 0} mid:${depths.mid ?? 0} far:${depths.far ?? 0} overlaps:${overlapCount} focused:${this.activeFocusId ?? '-'}`,
      28,
      height - panelHeight + 64,
    );
    if (this.motionDebug || this.sceneDebug) {
      context.fillText(
        `motion=${this.motionPresetName}(${this.getMotionPresetLabel()}) view=${this.viewModeName}(${this.getViewModeLabel()}) reduced=${this.reducedMotion} median5s=${Math.round(medianDisplacement)}px`,
        28,
        height - panelHeight + 84,
      );
      context.fillText(
        `cameraParallax=${this.cameraParallaxOffset.x.toFixed(3)},${this.cameraParallaxOffset.y.toFixed(3)} look=${this.cameraLookOffset.x.toFixed(3)},${this.cameraLookOffset.y.toFixed(3)} rot=${this.cameraRotationOffset.x.toFixed(2)},${this.cameraRotationOffset.y.toFixed(2)}`,
        28,
        height - panelHeight + 104,
      );
    }
    if (this.sceneDebug) {
      const ambient = this.ambientController.getSnapshot({ camera: this.camera, viewport: { width, height } });
      context.fillText(
        `renderer=${this.renderPipeline.getMode()} barrier=${this.barrierEnabled} dpr=${this.renderPipeline.currentDpr.toFixed(2)} quality=${this.qualityPreset} fps=${this.averageFps.toFixed(1)} frame=${this.averageFrameMs.toFixed(1)}ms`,
        28,
        height - panelHeight + 124,
      );
      context.fillText(
        `media=${this.spheres.length} ambient=${ambient.visibleCount}/${ambient.targetCount} cohorts=${ambient.cohortCount} videos=${this.spheres.filter((sphere) => Boolean(sphere.userData.video)).length} ray=${this.interactiveMemoryObjects.length}`,
        28,
        height - panelHeight + 144,
      );
      context.fillText(
        `layer=${this.debugLayerMode} officialReferenceMotion=${this.officialReferenceMotion}`,
        28,
        height - panelHeight + 164,
      );
    }
    if (this.streamDebug) {
      const snapshot = this.getMotionSnapshot();
      const countsText = Object.entries(snapshot.lifecycleCounts)
        .map(([key, value]) => `${key}:${value}`)
        .join(' ');
      context.fillText(
        `stream slots=${snapshot.slotCount} shown=${snapshot.shownInSession}/${snapshot.totalMemoryCount} recycle=${snapshot.completedRecycleCount} next=${(snapshot.nextRecycleInMs / 1000).toFixed(1)}s ray=${snapshot.raycasterCandidates}`,
        28,
        height - panelHeight + 124,
      );
      context.fillText(
        countsText,
        28,
        height - panelHeight + 144,
      );
      context.fillText(
        `queue=${snapshot.preloadQueue.map((entry) => `${entry.memoryId}:${entry.status}`).join(', ') || '-'} hover=${snapshot.hoveredId ?? '-'} focus=${snapshot.focusedId ?? '-'}`,
        28,
        height - panelHeight + 164,
      );
      context.fillText(
        `renderer=${this.renderPipeline.getMode()} dpr=${this.renderPipeline.currentDpr.toFixed(2)} fps=${this.averageFps.toFixed(1)} reduced=${this.reducedMotion}`,
        28,
        height - panelHeight + 184,
      );
    }
    if (this.compositionDebug && !this.sceneDebug) {
      const ambient = this.ambientController.getSnapshot({ camera: this.camera, viewport: { width, height } });
      const sizes = this.layoutMetrics?.sizeCounts ?? {};
      const quiet = this.layoutMetrics?.quietZoneCounts ?? {};
      const roleCounts = this.spheres.reduce((counts, sphere) => {
        const role = sphere.userData.motionRole ?? 'normal';
        counts[role] = (counts[role] ?? 0) + 1;
        return counts;
      }, { active: 0, normal: 0, calm: 0 });
      context.fillText(
        `composition total=${this.currentMemories.length} visible=${this.visibleMemoryIdSet.size} ambient=${ambient.visibleCount}/${ambient.targetCount} ray=${this.interactiveMemoryObjects.length}`,
        28,
        height - panelHeight + 124,
      );
      context.fillText(
        `large=${sizes.emphasis ?? 0} foreground=${depths.near ?? 0} quiet=${quiet.total ?? 0}/${VISUAL_COMPOSITION.centerQuietZone.maxMemoryCount} quietLarge=${quiet.large ?? 0}`,
        28,
        height - panelHeight + 144,
      );
      context.fillText(
        `roles active=${roleCounts.active ?? 0} normal=${roleCounts.normal ?? 0} calm=${roleCounts.calm ?? 0} hover=${this.hoveredId ?? '-'} focus=${this.activeFocusId ?? '-'}`,
        28,
        height - panelHeight + 164,
      );
      context.fillText(
        `renderer=${this.renderPipeline.getMode()} dpr=${this.renderPipeline.currentDpr.toFixed(2)} fps=${this.averageFps.toFixed(1)} layer=${this.debugLayerMode}`,
        28,
        height - panelHeight + 184,
      );
    }
    context.restore();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.clearTimeout(this.layoutResizeTimer);
    this.cancelTransition(false);
    this.clearBubbles();
    this.ambientController?.dispose?.();
    this.disposeCustomBackground();
    this.defaultBackgroundTexture?.dispose?.();
    this.geometry?.dispose?.();
    this.memoryShellMaterial?.dispose?.();
    this.renderPipeline?.dispose?.();
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
