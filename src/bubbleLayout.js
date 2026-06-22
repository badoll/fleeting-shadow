import * as THREE from 'three';
import { hashString, seededRandom } from './domain.js';

export const BUBBLE_GEOMETRY_RADIUS = 0.1;
export const MEMORY_CLOUD_LAYOUT = 'memoryCloud';

const TWO_PI = Math.PI * 2;
const REGION_TARGETS = Object.freeze({
  leftTop: 0.19,
  rightTop: 0.19,
  leftBottom: 0.21,
  rightBottom: 0.21,
  center: 0.2,
});

const DEPTH_COLORS = Object.freeze({
  near: '#a8ffd0',
  mid: '#9fd8ff',
  far: '#ffc47d',
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function degToRad(value) {
  return THREE.MathUtils.degToRad(value);
}

function stableMemoryKey(memory, index) {
  return String(memory?.id ?? memory?.source ?? memory?.name ?? `memory-${index}`);
}

function getDepthCounts(total, isMobile) {
  if (total <= 0) return { near: 0, mid: 0, far: 0 };
  if (total === 1) return { near: 0, mid: 1, far: 0 };
  if (total === 2) return { near: 1, mid: 0, far: 1 };
  if (total === 3) return { near: 1, mid: 1, far: 1 };

  const nearShare = isMobile ? 0.12 : 0.18;
  const farShare = isMobile ? 0.3 : 0.27;
  const near = Math.max(1, Math.round(total * nearShare));
  const far = Math.max(1, Math.round(total * farShare));
  return {
    near,
    far,
    mid: Math.max(1, total - near - far),
  };
}

function getSizeCounts(total) {
  if (total <= 0) return { small: 0, normal: 0, emphasis: 0 };

  const emphasis = total >= 8 ? Math.max(1, Math.round(total * 0.1)) : 0;
  const small = total >= 4 ? Math.max(1, Math.round(total * 0.2)) : Math.max(0, total - 1);
  return {
    emphasis,
    small,
    normal: Math.max(0, total - emphasis - small),
  };
}

function assignBuckets(memories, seed, isMobile) {
  const total = memories.length;
  const depthCounts = getDepthCounts(total, isMobile);
  const sizeCounts = getSizeCounts(total);

  const depthOrder = memories
    .map((memory, index) => ({
      key: stableMemoryKey(memory, index),
      hash: hashString(`${seed}:depth:${stableMemoryKey(memory, index)}`),
    }))
    .sort((a, b) => a.hash - b.hash);

  const sizeOrder = memories
    .map((memory, index) => ({
      key: stableMemoryKey(memory, index),
      hash: hashString(`${seed}:size:${stableMemoryKey(memory, index)}`),
    }))
    .sort((a, b) => a.hash - b.hash);

  const depthByKey = new Map();
  depthOrder.forEach((entry, index) => {
    if (index < depthCounts.near) {
      depthByKey.set(entry.key, 'near');
    } else if (index < depthCounts.near + depthCounts.mid) {
      depthByKey.set(entry.key, 'mid');
    } else {
      depthByKey.set(entry.key, 'far');
    }
  });

  const sizeByKey = new Map();
  sizeOrder.forEach((entry, index) => {
    if (index < sizeCounts.emphasis) {
      sizeByKey.set(entry.key, 'emphasis');
    } else if (index < sizeCounts.emphasis + sizeCounts.small) {
      sizeByKey.set(entry.key, 'small');
    } else {
      sizeByKey.set(entry.key, 'normal');
    }
  });

  return { depthByKey, sizeByKey, depthCounts, sizeCounts };
}

function normalizeViewport(viewport = {}) {
  const width = Math.max(2, Number(viewport.width) || 2);
  const height = Math.max(2, Number(viewport.height) || 2);
  return {
    width,
    height,
    shortSide: Math.min(width, height),
  };
}

export function createSafeViewport(viewport, { isMobile = false, avoidRects = [] } = {}) {
  const normalized = normalizeViewport(viewport);
  const edgePad = clamp(
    normalized.shortSide * (isMobile ? 0.075 : 0.055),
    isMobile ? 22 : 34,
    isMobile ? 54 : 86,
  );
  const verticalPad = clamp(
    normalized.shortSide * (isMobile ? 0.085 : 0.065),
    isMobile ? 28 : 42,
    isMobile ? 64 : 96,
  );

  const safeRect = {
    left: edgePad,
    top: verticalPad,
    right: normalized.width - edgePad,
    bottom: normalized.height - verticalPad,
  };

  const safeWidth = Math.max(1, safeRect.right - safeRect.left);
  const safeHeight = Math.max(1, safeRect.bottom - safeRect.top);

  return {
    ...normalized,
    isMobile,
    safeRect,
    safeWidth,
    safeHeight,
    ndc: {
      minX: (safeRect.left / normalized.width) * 2 - 1,
      maxX: (safeRect.right / normalized.width) * 2 - 1,
      minY: 1 - (safeRect.bottom / normalized.height) * 2,
      maxY: 1 - (safeRect.top / normalized.height) * 2,
    },
    avoidRects: avoidRects
      .filter((rect) => rect && rect.right > rect.left && rect.bottom > rect.top)
      .map((rect) => ({
        left: clamp(rect.left, 0, normalized.width),
        top: clamp(rect.top, 0, normalized.height),
        right: clamp(rect.right, 0, normalized.width),
        bottom: clamp(rect.bottom, 0, normalized.height),
        weight: rect.weight ?? 1,
      })),
  };
}

function getCameraBasis(camera) {
  camera.updateMatrixWorld();
  return {
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize(),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize(),
  };
}

function getDepthRange(camera, depthBand, isMobile) {
  const fovScale = clamp(Math.tan(degToRad(60 * 0.5)) / Math.tan(degToRad(camera.fov * 0.5)), 0.78, 1.28);
  const sceneDistance = Math.max(2.85, camera.position.length() || 3);
  const unit = sceneDistance * fovScale * (isMobile ? 1.08 : 1);

  if (depthBand === 'near') return [unit * 0.88, unit * 1.2];
  if (depthBand === 'far') return [unit * 1.92, unit * 2.62];
  return [unit * 1.28, unit * 1.78];
}

export function screenRadiusToWorld(screenRadius, depth, camera, viewport) {
  const height = Math.max(1, viewport.height || 1);
  return (screenRadius / height) * 2 * Math.tan(degToRad(camera.fov * 0.5)) * depth;
}

export function worldFromCameraNdc({ camera, basis, ndcX, ndcY, depth, target = new THREE.Vector3() }) {
  const halfHeight = Math.tan(degToRad(camera.fov * 0.5)) * depth;
  const halfWidth = halfHeight * camera.aspect;

  return target
    .copy(camera.position)
    .addScaledVector(basis.forward, depth)
    .addScaledVector(basis.right, ndcX * halfWidth)
    .addScaledVector(basis.up, ndcY * halfHeight);
}

export function projectBubbleToScreen({ position, radius, camera, viewport, basis = getCameraBasis(camera) }) {
  const center = position.clone().project(camera);
  const edge = position.clone().addScaledVector(basis.right, radius).project(camera);
  const width = Math.max(1, viewport.width || 1);
  const height = Math.max(1, viewport.height || 1);
  const x = (center.x * 0.5 + 0.5) * width;
  const y = (-center.y * 0.5 + 0.5) * height;
  const edgeX = (edge.x * 0.5 + 0.5) * width;
  const edgeY = (-edge.y * 0.5 + 0.5) * height;
  const screenRadius = Math.hypot(edgeX - x, edgeY - y);

  return {
    x,
    y,
    ndcX: center.x,
    ndcY: center.y,
    ndcZ: center.z,
    radius: screenRadius,
    isVisible: Math.abs(center.x) <= 1.08 && Math.abs(center.y) <= 1.08 && center.z >= -1 && center.z <= 1,
  };
}

function getRegion(screen, viewport) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const centeredX = (screen.x - width * 0.5) / width;
  const centeredY = (screen.y - height * 0.5) / height;

  if (Math.abs(centeredX) < 0.18 && Math.abs(centeredY) < 0.16) return 'center';
  if (screen.y < height * 0.5) return screen.x < width * 0.5 ? 'leftTop' : 'rightTop';
  return screen.x < width * 0.5 ? 'leftBottom' : 'rightBottom';
}

function circleRectOverlap(screen, radius, rect) {
  const closestX = clamp(screen.x, rect.left, rect.right);
  const closestY = clamp(screen.y, rect.top, rect.bottom);
  const distance = Math.hypot(screen.x - closestX, screen.y - closestY);
  const centerInside =
    screen.x >= rect.left &&
    screen.x <= rect.right &&
    screen.y >= rect.top &&
    screen.y <= rect.bottom;

  if (distance >= radius && !centerInside) return 0;
  return Math.max(0, radius - distance) + (centerInside ? radius * 0.75 : 0);
}

function screenDiameterRange(bucket, { viewport, total, depthBand, isMobile }) {
  const densityScale =
    total > 60
      ? lerp(1, 0.74, clamp((total - 60) / 50, 0, 1))
      : total < 8
        ? 1.12
        : 1;
  const bandScale = depthBand === 'near' ? 0.86 : depthBand === 'far' ? 0.9 : 1;
  const mobileScale = isMobile ? 0.86 : 1;
  const shortSide = viewport.shortSide;
  const maxDiameter = shortSide * (isMobile ? 0.145 : 0.18);
  const minDiameter = isMobile ? 38 : 54;

  const ranges = {
    small: [shortSide * 0.055, shortSide * 0.074],
    normal: [shortSide * 0.074, shortSide * 0.108],
    emphasis: [shortSide * 0.118, shortSide * 0.155],
  };
  const range = ranges[bucket] ?? ranges.normal;

  return [
    clamp(range[0] * densityScale * bandScale * mobileScale, minDiameter, maxDiameter),
    clamp(range[1] * densityScale * bandScale * mobileScale, minDiameter, maxDiameter),
  ];
}

function createProfiles(memories, options) {
  const { seed, viewport, camera, isMobile } = options;
  const { depthByKey, sizeByKey } = assignBuckets(memories, seed, isMobile);
  const total = memories.length;

  return memories.map((memory, index) => {
    const key = stableMemoryKey(memory, index);
    const profileRandom = seededRandom(`${seed}:profile:${key}`);
    const depthBand = depthByKey.get(key) ?? 'mid';
    const sizeBucket = sizeByKey.get(key) ?? 'normal';
    const [minDiameter, maxDiameter] = screenDiameterRange(sizeBucket, {
      viewport,
      total,
      depthBand,
      isMobile,
    });
    const screenDiameter = lerp(minDiameter, maxDiameter, profileRandom());
    const emphasis = sizeBucket === 'emphasis';
    const orderHash = hashString(`${seed}:order:${key}`);

    return {
      key,
      index,
      memory,
      memoryId: memory?.id ?? key,
      orderHash,
      depthBand,
      sizeBucket,
      screenRadius: screenDiameter * 0.5,
      depthRange: getDepthRange(camera, depthBand, isMobile),
      random: seededRandom(`${seed}:candidate:${key}`),
      driftRandom: seededRandom(`${seed}:drift:${key}`),
      emphasis,
    };
  });
}

function makeCandidate(profile, context) {
  const {
    camera,
    basis,
    viewport,
    tempWorld,
  } = context;
  const random = profile.random;
  const ndcX = lerp(viewport.ndc.minX, viewport.ndc.maxX, random());
  const ndcY = lerp(viewport.ndc.minY, viewport.ndc.maxY, random());
  const depth = lerp(profile.depthRange[0], profile.depthRange[1], random());
  const worldRadius = screenRadiusToWorld(profile.screenRadius, depth, camera, viewport);
  const worldPosition = worldFromCameraNdc({
    camera,
    basis,
    ndcX,
    ndcY,
    depth,
    target: tempWorld,
  }).clone();
  const screen = projectBubbleToScreen({
    position: worldPosition,
    radius: worldRadius,
    camera,
    viewport,
    basis,
  });

  return {
    ndcX,
    ndcY,
    depth,
    worldPosition,
    worldRadius,
    screen,
    region: getRegion(screen, viewport),
  };
}

function scoreCandidate(candidate, profile, context) {
  const { placed, viewport, regionCounts, sideCounts, total } = context;
  const screen = candidate.screen;
  const safe = viewport.safeRect;
  const radius = screen.radius;
  const shortSide = viewport.shortSide;
  let minEdgeGap = shortSide * 0.28;
  let overlapPenalty = 0;
  let densityPenalty = 0;

  for (const existing of placed) {
    const distance = Math.hypot(screen.x - existing.screen.x, screen.y - existing.screen.y);
    const sameDepth = profile.depthBand === existing.depthBand;
    const requiredGap = (radius + existing.screen.radius) * (sameDepth ? 1.06 : 0.68);
    const edgeGap = distance - requiredGap;
    minEdgeGap = Math.min(minEdgeGap, edgeGap);

    if (edgeGap < 0) {
      const overlap = -edgeGap;
      overlapPenalty += overlap * overlap * (sameDepth ? 1.65 : 0.58);
    }

    const severeSameLayerOverlap = sameDepth && distance < radius + existing.screen.radius - Math.min(radius, existing.screen.radius) * 0.7;
    if (severeSameLayerOverlap) overlapPenalty += shortSide * shortSide * 0.18;

    const largePair =
      radius > shortSide * 0.055 &&
      existing.screen.radius > shortSide * 0.055 &&
      distance < (radius + existing.screen.radius) * 1.2;
    if (largePair) densityPenalty += 220;

    if (distance < shortSide * 0.22) {
      densityPenalty += (1 - distance / (shortSide * 0.22)) * 70;
    }
  }

  const edgeMargin = Math.min(
    screen.x - safe.left,
    safe.right - screen.x,
    screen.y - safe.top,
    safe.bottom - screen.y,
  ) - radius * 0.65;
  const centerDistance = Math.hypot(
    (screen.x - viewport.width * 0.5) / viewport.width,
    (screen.y - viewport.height * 0.5) / viewport.height,
  );
  const regionTarget = REGION_TARGETS[candidate.region] ?? 0.2;
  const projectedRegionCount = (regionCounts[candidate.region] ?? 0) + 1;
  const projectedRegionShare = projectedRegionCount / Math.max(1, total);
  const regionOverflow = Math.max(0, projectedRegionShare - regionTarget * 1.62);
  const regionUnderfill = Math.max(0, regionTarget - (regionCounts[candidate.region] ?? 0) / Math.max(1, placed.length + 1));

  const projectedLeft = sideCounts.left + (screen.x < viewport.width * 0.5 ? 1 : 0);
  const projectedRight = sideCounts.right + (screen.x >= viewport.width * 0.5 ? 1 : 0);
  const sideImbalance = Math.abs(projectedLeft - projectedRight) / Math.max(1, placed.length + 1);

  let uiPenalty = 0;
  for (const rect of viewport.avoidRects) {
    const overlap = circleRectOverlap(screen, radius * (profile.emphasis || profile.depthBand === 'near' ? 1.25 : 1), rect);
    uiPenalty += overlap * rect.weight * (profile.emphasis || profile.depthBand === 'near' ? 4 : 2.2);
  }

  const exactCenterPenalty =
    total <= 3 && centerDistance < 0.18
      ? (0.18 - centerDistance) * 1050
      : centerDistance < 0.06
        ? (0.06 - centerDistance) * 620
        : 0;
  const centerCrowdingPenalty =
    candidate.region === 'center' && projectedRegionShare > REGION_TARGETS.center * 1.22
      ? (projectedRegionShare - REGION_TARGETS.center * 1.22) * 600
      : 0;

  return (
    minEdgeGap * 2.8 +
    clamp(edgeMargin, -shortSide * 0.2, shortSide * 0.18) * 1.4 +
    regionUnderfill * 90 -
    regionOverflow * 900 -
    sideImbalance * 120 -
    overlapPenalty * 0.018 -
    densityPenalty -
    uiPenalty -
    exactCenterPenalty -
    centerCrowdingPenalty +
    profile.random() * 0.01
  );
}

function createDrift(profile, worldRadius, viewport) {
  const random = profile.driftRandom;
  const bandScale = profile.depthBand === 'near' ? 0.72 : profile.depthBand === 'far' ? 0.62 : 1;
  const mobileScale = viewport.isMobile ? 0.72 : 1;
  const amplitudeBase = worldRadius * bandScale * mobileScale;

  return {
    amplitude: new THREE.Vector3(
      amplitudeBase * lerp(0.32, 0.58, random()),
      amplitudeBase * lerp(0.28, 0.52, random()),
      amplitudeBase * lerp(0.18, 0.34, random()),
    ),
    frequency: new THREE.Vector3(
      TWO_PI / lerp(10, 24, random()),
      TWO_PI / lerp(9, 22, random()),
      TWO_PI / lerp(12, 28, random()),
    ),
    phase: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    secondaryPhase: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    startTime: random() * TWO_PI,
  };
}

function createMotionProfile(profile, seed) {
  const random = seededRandom(`${seed}:motion:${profile.key}`);
  const rate = (min, max) => lerp(min, max, random());

  return {
    amplitudeMix: new THREE.Vector3(random(), random(), random()),
    periodMix: new THREE.Vector3(random(), random(), random()),
    microMix: new THREE.Vector3(random(), random(), random()),
    phasePrimary: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    phaseSecondary: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    microPhase: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    microSecondaryPhase: new THREE.Vector3(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI),
    secondaryRate: new THREE.Vector3(rate(0.31, 0.48), rate(0.34, 0.52), rate(0.27, 0.44)),
    secondaryWeight: new THREE.Vector3(rate(0.24, 0.38), rate(0.2, 0.34), rate(0.18, 0.3)),
    microRate: new THREE.Vector3(rate(0.74, 1.12), rate(0.82, 1.2), rate(0.66, 1.02)),
    microWeight: new THREE.Vector3(rate(0.16, 0.28), rate(0.14, 0.26), rate(0.12, 0.22)),
    globalResponse: rate(0.76, 1.18),
    timeOffset: rate(0, 48),
    depthPhase: random() * TWO_PI,
    debugHue: random(),
  };
}

function pickCandidate(profile, context) {
  const attempts = context.total > 80 ? 30 : context.total <= 8 ? 52 : 40;
  let best = null;
  let bestScore = -Infinity;

  for (let index = 0; index < attempts; index += 1) {
    const candidate = makeCandidate(profile, context);
    const score = scoreCandidate(candidate, profile, context);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function countRegions(placed, viewport) {
  const counts = {
    leftTop: 0,
    rightTop: 0,
    leftBottom: 0,
    rightBottom: 0,
    center: 0,
  };
  const sides = { left: 0, right: 0 };

  placed.forEach((item) => {
    counts[item.region] += 1;
    if (item.screen.x < viewport.width * 0.5) sides.left += 1;
    else sides.right += 1;
  });

  return { counts, sides };
}

export function summarizeScreenLayout(layoutItems, viewport) {
  const quadrantCounts = {
    leftTop: 0,
    rightTop: 0,
    leftBottom: 0,
    rightBottom: 0,
    center: 0,
  };
  const depthCounts = { near: 0, mid: 0, far: 0 };
  let overlapCount = 0;

  layoutItems.forEach((item, index) => {
    quadrantCounts[item.region] += 1;
    depthCounts[item.depthBand] += 1;

    for (let otherIndex = index + 1; otherIndex < layoutItems.length; otherIndex += 1) {
      const other = layoutItems[otherIndex];
      const distance = Math.hypot(item.screen.x - other.screen.x, item.screen.y - other.screen.y);
      const sameDepth = item.depthBand === other.depthBand;
      const allowedOverlap = Math.min(item.screen.radius, other.screen.radius) * (sameDepth ? 0.7 : 1.08);
      if (distance < item.screen.radius + other.screen.radius - allowedOverlap) {
        overlapCount += 1;
      }
    }
  });

  return {
    total: layoutItems.length,
    quadrantCounts,
    depthCounts,
    overlapCount,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      safeRect: viewport.safeRect,
      avoidRects: viewport.avoidRects,
    },
  };
}

export function createMemoryCloudLayout({
  memories = [],
  camera,
  viewport,
  seed = 'memory-bubbles',
  avoidRects = [],
  geometryRadius = BUBBLE_GEOMETRY_RADIUS,
} = {}) {
  if (!camera) throw new Error('createMemoryCloudLayout requires a camera');

  const normalizedViewport = normalizeViewport(viewport);
  const isMobile = normalizedViewport.width < 700 || normalizedViewport.height > normalizedViewport.width * 1.35;
  const safeViewport = createSafeViewport(normalizedViewport, { isMobile, avoidRects });
  const layoutSeed = `${MEMORY_CLOUD_LAYOUT}:${seed}`;
  const basis = getCameraBasis(camera);
  const profiles = createProfiles(memories, {
    seed: layoutSeed,
    viewport: safeViewport,
    camera,
    isMobile,
  }).sort((a, b) => {
    if (b.screenRadius !== a.screenRadius) return b.screenRadius - a.screenRadius;
    return a.orderHash - b.orderHash;
  });

  const placed = [];
  const byKey = new Map();
  const context = {
    camera,
    basis,
    viewport: safeViewport,
    placed,
    regionCounts: { leftTop: 0, rightTop: 0, leftBottom: 0, rightBottom: 0, center: 0 },
    sideCounts: { left: 0, right: 0 },
    total: memories.length,
    tempWorld: new THREE.Vector3(),
  };

  profiles.forEach((profile) => {
    const candidate = pickCandidate(profile, context);
    const drift = createDrift(profile, candidate.worldRadius, safeViewport);
    const motionProfile = createMotionProfile(profile, layoutSeed);
    const baseScale = candidate.worldRadius / geometryRadius;
    const item = {
      layout: MEMORY_CLOUD_LAYOUT,
      layoutSeed,
      index: profile.index,
      memoryId: profile.memoryId,
      key: profile.key,
      anchorPosition: candidate.worldPosition,
      homeAnchor: candidate.worldPosition.clone(),
      currentPosition: candidate.worldPosition.clone(),
      roamingTarget: candidate.worldPosition.clone(),
      separationOffset: new THREE.Vector3(),
      interactionOffset: new THREE.Vector3(),
      motionProfile,
      radius: candidate.worldRadius,
      baseScale,
      depth: candidate.depth,
      depthBand: profile.depthBand,
      sizeBucket: profile.sizeBucket,
      driftAmplitude: drift.amplitude,
      driftFrequency: drift.frequency,
      driftPhase: drift.phase,
      driftSecondaryPhase: drift.secondaryPhase,
      driftTime: drift.startTime,
      screen: candidate.screen,
      region: candidate.region,
      debugColor: DEPTH_COLORS[profile.depthBand] ?? '#ffffff',
      isFocused: false,
      isHovered: false,
    };

    placed.push(item);
    byKey.set(profile.key, item);
    const regions = countRegions(placed, safeViewport);
    context.regionCounts = regions.counts;
    context.sideCounts = regions.sides;
  });

  const layoutItems = memories.map((memory, index) => byKey.get(stableMemoryKey(memory, index))).filter(Boolean);
  return {
    layout: MEMORY_CLOUD_LAYOUT,
    seed: layoutSeed,
    items: layoutItems,
    metrics: summarizeScreenLayout(layoutItems, safeViewport),
  };
}

export function updateBubbleDrift(data, target, motionScale = 1) {
  if (!data || motionScale <= 0) {
    target.set(0, 0, 0);
    return target;
  }

  const t = data.driftTime ?? 0;
  const amplitude = data.driftAmplitude;
  const frequency = data.driftFrequency;
  const phase = data.driftPhase;
  const secondary = data.driftSecondaryPhase;

  target.set(
    (Math.sin(t * frequency.x + phase.x) + Math.sin(t * frequency.x * 0.37 + secondary.x) * 0.25) *
      amplitude.x *
      motionScale,
    (Math.sin(t * frequency.y + phase.y) + Math.sin(t * frequency.y * 0.41 + secondary.y) * 0.18) *
      amplitude.y *
      motionScale,
    (Math.sin(t * frequency.z + phase.z) + Math.sin(t * frequency.z * 0.29 + secondary.z) * 0.2) *
      amplitude.z *
      motionScale,
  );

  return target;
}
