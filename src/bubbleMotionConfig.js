export const DEFAULT_MOTION_PRESET = 'flowing';
export const DEFAULT_VIEW_MODE = 'soft';

export const MOTION_PRESET_LABELS = Object.freeze({
  calm: '静谧',
  flowing: '流动',
  vivid: '灵动',
});

export const VIEW_MODE_LABELS = Object.freeze({
  soft: '柔和',
  sixWay: '环顾',
});

export const VIEW_MODES = Object.freeze({
  soft: {
    type: 'lookAt',
    translationScale: 1,
    yawDegrees: 0,
    pitchDegrees: 0,
  },
  sixWay: {
    type: 'directRotation',
    translationScale: 0.62,
    yawDegrees: 78,
    pitchDegrees: 52,
  },
});

// NDC amplitudes are converted to world units at each bubble's layout depth.
// Higher values make bubbles cross more of the screen, but also increase the
// amount of separation and boundary correction needed to preserve density.
export const MOTION_PRESETS = Object.freeze({
  calm: {
    intensity: 0.52,
    bands: {
      near: { ndcX: [0.13, 0.24], ndcY: [0.09, 0.18], depth: [0.05, 0.1], period: [16, 28] },
      mid: { ndcX: [0.1, 0.2], ndcY: [0.08, 0.16], depth: [0.04, 0.09], period: [18, 31] },
      far: { ndcX: [0.06, 0.13], ndcY: [0.045, 0.1], depth: [0.025, 0.06], period: [22, 38] },
    },
    microAmplitudeRatio: [0.07, 0.13],
    microPeriod: [6, 11],
    globalFlow: { ndcX: 0.018, ndcY: 0.012, depth: 0.012, periodX: 32, periodY: 25, periodZ: 37 },
    cameraParallax: { ndcX: 0.032, ndcY: 0.022, lookNdcX: 0.1, lookNdcY: 0.07, damping: 4.4, lookDamping: 3.8 },
    boundary: { overscan: 0.18, strength: 0.56 },
    separation: { strength: 0.46, damping: 5.8, maxMacroRatio: 0.22, interval: 2 },
    hoverSlowdown: { motionScale: 0.24, dampingIn: 10, dampingOut: 3.3 },
    focus: { backgroundMotionScale: 0.38 },
    mobileAmplitudeScale: 0.82,
    reducedMotion: { macroAmplitudeScale: 0.09, microAmplitudeScale: 0.42, cameraParallaxScale: 0, depthScale: 0 },
    positionDamping: 5.1,
  },
  flowing: {
    intensity: 0.78,
    bands: {
      near: { ndcX: [0.2, 0.34], ndcY: [0.13, 0.25], depth: [0.08, 0.16], period: [12, 22] },
      mid: { ndcX: [0.15, 0.28], ndcY: [0.1, 0.22], depth: [0.06, 0.13], period: [14, 26] },
      far: { ndcX: [0.08, 0.18], ndcY: [0.06, 0.15], depth: [0.04, 0.09], period: [18, 32] },
    },
    microAmplitudeRatio: [0.09, 0.17],
    microPeriod: [4.8, 9.5],
    globalFlow: { ndcX: 0.032, ndcY: 0.02, depth: 0.018, periodX: 29, periodY: 23, periodZ: 34 },
    cameraParallax: { ndcX: 0.056, ndcY: 0.038, lookNdcX: 0.16, lookNdcY: 0.11, damping: 4.8, lookDamping: 4.2 },
    boundary: { overscan: 0.22, strength: 0.62 },
    separation: { strength: 0.56, damping: 6.4, maxMacroRatio: 0.25, interval: 2 },
    hoverSlowdown: { motionScale: 0.22, dampingIn: 11.5, dampingOut: 2.6 },
    focus: { backgroundMotionScale: 0.46 },
    mobileAmplitudeScale: 0.76,
    reducedMotion: { macroAmplitudeScale: 0.1, microAmplitudeScale: 0.38, cameraParallaxScale: 0, depthScale: 0 },
    positionDamping: 5.6,
  },
  vivid: {
    intensity: 0.96,
    bands: {
      near: { ndcX: [0.24, 0.39], ndcY: [0.16, 0.29], depth: [0.1, 0.18], period: [10, 19] },
      mid: { ndcX: [0.18, 0.32], ndcY: [0.12, 0.25], depth: [0.07, 0.15], period: [12, 23] },
      far: { ndcX: [0.1, 0.22], ndcY: [0.07, 0.17], depth: [0.045, 0.1], period: [16, 29] },
    },
    microAmplitudeRatio: [0.11, 0.18],
    microPeriod: [4.2, 8.4],
    globalFlow: { ndcX: 0.04, ndcY: 0.024, depth: 0.022, periodX: 27, periodY: 21, periodZ: 31 },
    cameraParallax: { ndcX: 0.066, ndcY: 0.046, lookNdcX: 0.2, lookNdcY: 0.14, damping: 5.2, lookDamping: 4.4 },
    boundary: { overscan: 0.24, strength: 0.68 },
    separation: { strength: 0.62, damping: 7, maxMacroRatio: 0.27, interval: 2 },
    hoverSlowdown: { motionScale: 0.2, dampingIn: 12, dampingOut: 2.7 },
    focus: { backgroundMotionScale: 0.52 },
    mobileAmplitudeScale: 0.72,
    reducedMotion: { macroAmplitudeScale: 0.09, microAmplitudeScale: 0.34, cameraParallaxScale: 0, depthScale: 0 },
    positionDamping: 6,
  },
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

export function dampFactor(lambda, deltaSeconds) {
  return 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, deltaSeconds));
}

export function getMotionPreset(name = DEFAULT_MOTION_PRESET) {
  return MOTION_PRESETS[name] ?? MOTION_PRESETS[DEFAULT_MOTION_PRESET];
}

export function isMotionPresetName(name) {
  return Object.hasOwn(MOTION_PRESETS, name);
}

export function getViewMode(name = DEFAULT_VIEW_MODE) {
  return VIEW_MODES[name] ?? VIEW_MODES[DEFAULT_VIEW_MODE];
}

export function isViewModeName(name) {
  return Object.hasOwn(VIEW_MODES, name);
}
