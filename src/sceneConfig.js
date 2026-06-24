export const SCENE_QUALITY_ORDER = Object.freeze(['low', 'medium', 'high']);

export const VISUAL_COMPOSITION = Object.freeze({
  desktop: {
    visibleMemoryCount: 16,
    visibleAmbientCount: 22,
    maxLargeMemoryCount: 3,
    maxForegroundMemoryCount: 2,
  },
  mobile: {
    visibleMemoryCount: 10,
    visibleAmbientCount: 14,
    maxLargeMemoryCount: 2,
    maxForegroundMemoryCount: 1,
  },
  centerQuietZone: {
    radiusX: 0.26,
    radiusY: 0.22,
    maxMemoryCount: 3,
    maxLargeMemoryCount: 1,
    ambientPassThrough: 0.32,
  },
  memoryMaterial: {
    mapReflectivity: 0,
    shellReflectivity: 0.08,
    shellOpacity: 0.052,
    browsingOpacity: 0.96,
    dimmedOpacity: 0.26,
  },
  ambientMaterial: {
    opacity: 0.14,
    roughness: 0.78,
    metalness: 0.04,
    envMapIntensity: 0,
    focusOpacityScale: 0.42,
    reducedMotionOpacityScale: 0.74,
  },
  motionRoles: {
    activeRatio: 0.35,
    normalRatio: 0.5,
    calmRatio: 0.15,
    reducedActiveRatio: 0.05,
    rotateIntervalMin: 8,
    rotateIntervalMax: 12,
    factors: {
      active: 1.08,
      normal: 0.72,
      calm: 0.32,
    },
  },
  memoryRotation: {
    intervalMin: 8,
    intervalMax: 16,
    fadeDuration: 760,
    reducedMotionFadeDuration: 220,
  },
});

// Counts are instance counts. Increasing them improves spatial density, but
// also increases per-frame matrix updates and ParallaxBarrierEffect cost.
export const AMBIENT_BUBBLE_CONFIG = Object.freeze({
  maxCount: 64,
  counts: {
    high: VISUAL_COMPOSITION.desktop.visibleAmbientCount,
    medium: 18,
    low: 14,
    mobile: VISUAL_COMPOSITION.mobile.visibleAmbientCount,
  },
  emptyMultiplier: 0.38,
  barrierMultiplier: 0.72,
  reducedMotionMultiplier: 0.72,
  depthShares: {
    near: 0.1,
    mid: 0.44,
    far: 0.46,
  },
  depthRanges: {
    // Camera-space depth in world units. Smaller values feel faster and risk occluding media.
    near: [2.3, 3.2],
    mid: [3.7, 5.5],
    far: [5.9, 8.6],
  },
  screenDiameterRatios: {
    // Diameter as a fraction of the short viewport side.
    small: [0.01, 0.021],
    medium: [0.021, 0.034],
    large: [0.034, 0.048],
  },
  cohortCount: [4, 6],
  cohortMotion: {
    near: { ndcX: [0.16, 0.32], ndcY: [0.1, 0.23], depth: [0.045, 0.1], period: [16, 28] },
    mid: { ndcX: [0.18, 0.38], ndcY: [0.12, 0.27], depth: [0.055, 0.12], period: [18, 32] },
    far: { ndcX: [0.12, 0.28], ndcY: [0.075, 0.2], depth: [0.04, 0.1], period: [24, 42] },
  },
  individualMotionRatio: [0.24, 0.38],
  brightness: {
    browsing: 0.78,
    focus: 0.36,
    reducedMotion: 0.62,
  },
  speed: {
    browsing: 0.82,
    focus: 0.34,
    reducedMotion: 0.18,
  },
});

// NDC multipliers are converted to world units at the camera home depth.
// Larger values make mouse parallax more cinematic, but can become tiring.
export const CAMERA_PARALLAX_CONFIG = Object.freeze({
  desktopNdcMultiplier: 1.52,
  desktopLookMultiplier: 1.34,
  mobileMultiplier: 0.48,
  pointerIdleDamping: 2.7,
});

export const RENDER_QUALITY_CONFIG = Object.freeze({
  effectDprCap: {
    high: 1.45,
    medium: 1.3,
    low: 1.12,
    mobile: 1.08,
  },
  frameSampleWindowMs: 2600,
  minQualitySwitchMs: 5600,
  downgradeFrameMs: 23.5,
  upgradeFrameMs: 17.2,
});

export function normalizeQualityName(name, fallback = 'high') {
  return SCENE_QUALITY_ORDER.includes(name) ? name : fallback;
}

export function getLowerQuality(name) {
  const index = SCENE_QUALITY_ORDER.indexOf(normalizeQualityName(name));
  return SCENE_QUALITY_ORDER[Math.max(0, index - 1)];
}

export function getHigherQuality(name) {
  const index = SCENE_QUALITY_ORDER.indexOf(normalizeQualityName(name));
  return SCENE_QUALITY_ORDER[Math.min(SCENE_QUALITY_ORDER.length - 1, index + 1)];
}

export function getCompositionSettings({ isMobile = false } = {}) {
  return isMobile ? VISUAL_COMPOSITION.mobile : VISUAL_COMPOSITION.desktop;
}

export function resolveVisibleMemoryCount({ total = 0, isMobile = false } = {}) {
  const settings = getCompositionSettings({ isMobile });
  return Math.max(0, Math.min(total, settings.visibleMemoryCount));
}

export function resolveAmbientTargetCount({
  qualityName = 'high',
  isMobile = false,
  barrierEnabled = false,
  reducedMotion = false,
  empty = false,
} = {}) {
  const quality = normalizeQualityName(qualityName);
  const baseCount = isMobile ? AMBIENT_BUBBLE_CONFIG.counts.mobile : AMBIENT_BUBBLE_CONFIG.counts[quality];
  const barrierScale = barrierEnabled ? AMBIENT_BUBBLE_CONFIG.barrierMultiplier : 1;
  const reducedScale = reducedMotion ? AMBIENT_BUBBLE_CONFIG.reducedMotionMultiplier : 1;
  const emptyScale = empty ? AMBIENT_BUBBLE_CONFIG.emptyMultiplier : 1;

  return Math.max(0, Math.min(
    AMBIENT_BUBBLE_CONFIG.maxCount,
    Math.round(baseCount * barrierScale * reducedScale * emptyScale),
  ));
}

export function resolveEffectDprCap({ qualityName = 'high', isMobile = false } = {}) {
  if (isMobile) return RENDER_QUALITY_CONFIG.effectDprCap.mobile;
  return RENDER_QUALITY_CONFIG.effectDprCap[normalizeQualityName(qualityName)] ?? RENDER_QUALITY_CONFIG.effectDprCap.high;
}
