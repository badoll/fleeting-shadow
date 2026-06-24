export const BubbleLifecycle = Object.freeze({
  POOLED: 'POOLED',
  PRELOADING: 'PRELOADING',
  ENTERING: 'ENTERING',
  ACTIVE: 'ACTIVE',
  LEAVING: 'LEAVING',
});

export const BubbleInteraction = Object.freeze({
  NONE: 'NONE',
  HOVERED: 'HOVERED',
  PRESSED: 'PRESSED',
  FOCUSING: 'FOCUSING',
  VIEWING: 'VIEWING',
  RETURNING: 'RETURNING',
});

// Units:
// - durations and intervals are seconds.
// - NDC ranges use normalized device coordinates at the route depth.
// - speed scales multiply per-slot route progress, not global time.
export const MEMORY_STREAM_CONFIG = Object.freeze({
  desktopSlotCount: 16,
  mobileSlotCount: 10,
  lowPerformanceSlotCount: 8,

  recycleIntervalMin: 2.5,
  recycleIntervalMax: 4.2,
  mobileRecycleIntervalMin: 3.5,
  mobileRecycleIntervalMax: 6,
  reducedMotionRecycleIntervalMin: 6,
  reducedMotionRecycleIntervalMax: 10,

  minVisibleResidence: 8,
  mobileMinVisibleResidence: 12,
  reducedMotionMinVisibleResidence: 16,
  maxVisibleResidence: 42,

  enterDurationMin: 1.8,
  enterDurationMax: 3,
  leaveDurationMin: 0.9,
  leaveDurationMax: 1.5,
  internalRouteDurationMin: 11,
  internalRouteDurationMax: 22,
  internalRouteReferenceDistanceNdc: 0.34,
  internalRouteDistanceDurationScale: 0.82,
  internalRouteMaxStepNdcX: 0.26,
  internalRouteMaxStepNdcY: 0.2,
  internalRouteNearStepScale: 0.68,
  reducedMotionDurationScale: 1.35,

  maxSimultaneousEntering: 1,
  maxSimultaneousLeaving: 1,
  maxSimultaneousTransitions: 2,

  offscreenMarginNdc: 0.24,
  hiddenOpacityThreshold: 0.04,
  enteringInteractiveProgress: 0.72,
  enteringFadeStartProgress: 0.2,
  enteringFadeFullProgress: 0.76,
  enteringBoundaryStartProgress: 0.46,
  enteringBoundaryFullProgress: 0.92,
  enteringSeparationStartProgress: 0.58,
  enteringSeparationFullProgress: 0.94,

  hoverExitProtection: 4,
  recentCloseProtection: 5,
  pointerLockSpeedScale: 0.04,
  hoverSpeedScale: 0.18,
  hoverDampingIn: 12,
  hoverDampingOut: 2.6,

  preloadQueueSize: 4,
  textureCacheLimit: 56,
  videoPosterTimeoutMs: 2600,
  imageDecodeTimeoutMs: 3200,

  centerPassProbability: 0.1,
  centerNdcRadiusX: 0.28,
  centerNdcRadiusY: 0.24,
  maxCenterSlots: 2,
  maxLargeCenterSlots: 1,

  routeBounds: {
    minX: -0.9,
    maxX: 0.9,
    minY: -0.82,
    maxY: 0.82,
  },
  routeMobileScale: 0.74,
  routeReducedMotionScale: 0.16,
  routeDepthJitter: 0.12,
  routeCurvatureNdc: [0.07, 0.22],

  cohortFlow: {
    ndcX: 0.032,
    ndcY: 0.024,
    depth: 0.016,
    reducedMotionScale: 0.08,
  },

  selectionWeights: {
    unseenBonus: 900,
    staleBonus: 260,
    unopenedBonus: 72,
    shownPenalty: 115,
    recentPenalty: 280,
    duplicateKindPenalty: 38,
    jitter: 48,
  },

  closeBehavior: 'continue-and-recycle',
});

export const STREAM_COHORTS = Object.freeze([
  {
    id: 'left-up',
    enterSide: 'left',
    exitSide: 'right',
    trendX: 0.34,
    trendY: 0.18,
    depthBias: 'mid',
    period: 24,
  },
  {
    id: 'right-down',
    enterSide: 'right',
    exitSide: 'left',
    trendX: -0.32,
    trendY: -0.2,
    depthBias: 'mid',
    period: 27,
  },
  {
    id: 'far-approach',
    enterSide: 'far',
    exitSide: 'bottom',
    trendX: -0.08,
    trendY: -0.14,
    depthBias: 'far',
    period: 31,
  },
  {
    id: 'recede-side',
    enterSide: 'bottom',
    exitSide: 'far',
    trendX: 0.18,
    trendY: 0.2,
    depthBias: 'far',
    period: 34,
  },
  {
    id: 'top-arc',
    enterSide: 'top',
    exitSide: 'right',
    trendX: 0.24,
    trendY: -0.26,
    depthBias: 'mid',
    period: 22,
  },
  {
    id: 'foreground-pass',
    enterSide: 'right',
    exitSide: 'far',
    trendX: -0.2,
    trendY: 0.08,
    depthBias: 'near',
    period: 19,
  },
  {
    id: 'center-glide',
    enterSide: 'left',
    exitSide: 'top',
    trendX: 0.16,
    trendY: 0.16,
    depthBias: 'mid',
    period: 29,
  },
]);
