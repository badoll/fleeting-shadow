const IMAGE_PREFIX = 'image/';
const VIDEO_PREFIX = 'video/';
const BYTE = 1024;
const DEFAULT_MAX_MEDIA_FILES = 96;
const DEFAULT_MAX_MEDIA_FILE_BYTES = 500 * BYTE * BYTE;
const DEFAULT_MAX_MEDIA_TOTAL_BYTES = 1400 * BYTE * BYTE;

const FILE_EXTENSION_KIND = Object.freeze({
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  heic: 'image',
  heif: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
  webp: 'image',
  m4v: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
});

export function classifyBackground(width, height) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);

  if (
    !Number.isFinite(numericWidth) ||
    !Number.isFinite(numericHeight) ||
    numericWidth <= 0 ||
    numericHeight <= 0
  ) {
    return {
      accepted: false,
      reason: '图片尺寸过小',
    };
  }

  const ratio = numericWidth / numericHeight;
  const longSide = Math.max(numericWidth, numericHeight);
  const shortSide = Math.min(numericWidth, numericHeight);
  const isPanoramaCandidate = ratio >= 1.9 && ratio <= 2.1;

  if (isPanoramaCandidate) {
    return {
      accepted: true,
      mode: 'panorama',
      quality: numericWidth >= 4096 && numericHeight >= 2048 ? 'normal' : 'low',
    };
  }

  return {
    accepted: true,
    mode: 'flat',
    quality: longSide >= 1920 && shortSide >= 1080 ? 'normal' : 'low',
  };
}

export function classifyCubeFace(width, height) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);

  if (
    !Number.isFinite(numericWidth) ||
    !Number.isFinite(numericHeight) ||
    numericWidth <= 0 ||
    numericHeight <= 0
  ) {
    return {
      accepted: false,
      reason: '图片尺寸过小',
    };
  }

  const ratio = numericWidth / numericHeight;
  if (ratio < 0.98 || ratio > 1.02) {
    return {
      accepted: false,
      reason: 'Cube 每一面需为正方形',
    };
  }

  const side = Math.min(numericWidth, numericHeight);
  return {
    accepted: true,
    mode: 'cube',
    quality: side >= 2048 ? 'normal' : 'low',
  };
}

export function classifyFile(file) {
  if (!file) return null;

  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (type.startsWith(IMAGE_PREFIX)) return 'image';
  if (type.startsWith(VIDEO_PREFIX)) return 'video';

  const extension = getFileExtension(file);
  return FILE_EXTENSION_KIND[extension] ?? null;
}

export function getFileExtension(file) {
  const name = String(file?.name || '');
  const extension = name.includes('.') ? name.split('.').pop() : '';
  return extension ? extension.toLowerCase() : '';
}

export function formatBytes(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) return '0 MB';

  const megabytes = numericBytes / BYTE / BYTE;
  if (megabytes < 1024) return `${Math.max(1, Math.round(megabytes))} MB`;

  const gigabytes = megabytes / 1024;
  return `${Number(gigabytes.toFixed(gigabytes >= 10 ? 0 : 1))} GB`;
}

export function validateMediaFiles(fileList, options = {}) {
  const files = Array.from(fileList ?? []);
  const maxFiles = Number.isFinite(options.maxFiles) ? Math.max(0, options.maxFiles) : DEFAULT_MAX_MEDIA_FILES;
  const maxFileBytes = Number.isFinite(options.maxFileBytes)
    ? Math.max(0, options.maxFileBytes)
    : DEFAULT_MAX_MEDIA_FILE_BYTES;
  const maxTotalBytes = Number.isFinite(options.maxTotalBytes)
    ? Math.max(0, options.maxTotalBytes)
    : DEFAULT_MAX_MEDIA_TOTAL_BYTES;
  const acceptedFiles = [];
  const rejectedFiles = [];
  let acceptedBytes = 0;

  files.forEach((file) => {
    const kind = classifyFile(file);
    const size = Number(file?.size) || 0;

    if (!kind) {
      rejectedFiles.push({
        file,
        code: 'unsupported',
        reason: '仅支持照片或视频文件',
      });
      return;
    }

    if (maxFileBytes > 0 && size > maxFileBytes) {
      rejectedFiles.push({
        file,
        code: 'file-too-large',
        reason: `单个文件不能超过 ${formatBytes(maxFileBytes)}`,
      });
      return;
    }

    if (acceptedFiles.length >= maxFiles) {
      rejectedFiles.push({
        file,
        code: 'too-many',
        reason: `最多一次选择 ${maxFiles} 个文件`,
      });
      return;
    }

    if (maxTotalBytes > 0 && acceptedBytes + size > maxTotalBytes) {
      rejectedFiles.push({
        file,
        code: 'total-too-large',
        reason: `本次选择总大小不能超过 ${formatBytes(maxTotalBytes)}`,
      });
      return;
    }

    acceptedFiles.push(file);
    acceptedBytes += size;
  });

  return {
    files,
    acceptedFiles,
    rejectedFiles,
    acceptedBytes,
    acceptedCount: acceptedFiles.length,
    rejectedCount: rejectedFiles.length,
  };
}

export function summarizeMediaValidation(validation) {
  const acceptedCount = validation?.acceptedCount ?? validation?.acceptedFiles?.length ?? 0;
  const rejectedFiles = Array.from(validation?.rejectedFiles ?? []);
  if (rejectedFiles.length === 0) return null;

  const reasons = rejectedFiles.reduce((counts, item) => {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    return counts;
  }, new Map());
  const reasonText = Array.from(reasons, ([reason, count]) => (count > 1 ? `${reason} × ${count}` : reason)).join('；');

  if (acceptedCount === 0) return `没有可加入的媒体：${reasonText}`;
  return `${acceptedCount} 个文件可加入，已忽略 ${rejectedFiles.length} 个：${reasonText}`;
}

export function hashString(value) {
  const input = String(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function seededRandom(seedInput = 'memory-bubbles') {
  let state = hashString(seedInput) || 0x6d2b79f5;

  return function nextRandom() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMemoryId(file, index) {
  const name = file?.name ?? `memory-${index}`;
  const size = file?.size ?? 0;
  const modified = file?.lastModified ?? 0;
  return `memory-${hashString(`${name}:${size}:${modified}:${index}`).toString(36)}`;
}

export function createMediaRecordsFromFiles(
  fileList,
  { createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL) } = {},
) {
  const files = Array.from(fileList ?? []);
  const records = [];
  const unsupported = [];

  files.forEach((file, index) => {
    const kind = classifyFile(file);

    if (!kind || typeof createObjectURL !== 'function') {
      unsupported.push(file);
      return;
    }

    const objectUrl = createObjectURL(file);

    records.push({
      id: createMemoryId(file, index),
      kind,
      name: file.name || `memory-${index + 1}`,
      type: file.type,
      size: file.size ?? 0,
      source: objectUrl,
      previewSource: objectUrl,
      objectUrl,
      revokeOnReset: true,
      aspectRatio: kind === 'video' ? 16 / 9 : 4 / 3,
      createdFrom: 'file',
    });
  });

  return { records, unsupported };
}

export function generateBubbleLayout(count, seedInput = 'memory-bubbles-layout') {
  const random = seededRandom(seedInput);
  const total = Math.max(0, Number(count) || 0);
  const placed = [];
  const width = 7200;
  const height = 4600;

  for (let index = 0; index < total; index += 1) {
    const radius = 95 + random() * 245;
    let best = null;
    let bestScore = -Infinity;
    const attempts = total > 80 ? 24 : 36;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = {
        x: (random() - 0.5) * width,
        y: (random() - 0.5) * height,
        z: -600 - random() * 9200,
      };
      const edgeMargin = Math.min(
        width * 0.5 - Math.abs(candidate.x),
        height * 0.5 - Math.abs(candidate.y),
      );
      let minGap = Math.min(width, height) * 0.35;

      placed.forEach((other) => {
        const distance = Math.hypot(candidate.x - other.x, candidate.y - other.y);
        minGap = Math.min(minGap, distance - (radius + other.radius) * 1.1);
      });

      const centerPenalty = Math.max(0, 540 - Math.hypot(candidate.x, candidate.y)) * (total <= 3 ? 1.6 : 0.25);
      const score = minGap * 1.8 + edgeMargin * 0.28 - centerPenalty + random() * 0.01;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    placed.push({
      index,
      x: best.x,
      y: best.y,
      z: best.z,
      radius,
      phase: random() * Math.PI * 2,
      drift: 90 + random() * 540,
      driftY: 70 + random() * 420,
      speed: 0.08 + random() * 0.22,
      orbitSpeed: 0.08 + random() * 0.28,
      forwardSpeed: 0.68 + random() * 1.7,
      hue: 0.28 + random() * 0.55,
      opacity: 0.34 + random() * 0.26,
    });
  }

  return placed;
}

export function selectRandomMemory(memories, previousId, random = Math.random) {
  const available = Array.from(memories ?? []);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const candidates = available.filter((item) => item.id !== previousId);
  const index = Math.floor(random() * candidates.length);
  return candidates[Math.max(0, Math.min(index, candidates.length - 1))];
}

export function disposeMediaRecords(records, revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)) {
  if (typeof revokeObjectURL !== 'function') return 0;

  return Array.from(records ?? []).reduce((released, record) => {
    if (record?.revokeOnReset && record.objectUrl) {
      revokeObjectURL(record.objectUrl);
      return released + 1;
    }

    return released;
  }, 0);
}
