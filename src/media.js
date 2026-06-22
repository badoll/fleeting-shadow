import { hashString } from './domain.js';

const SAMPLE_TITLES = [
  '桃花雨后',
  '夏夜窗边',
  '旧车站',
  '海风来信',
  '山路午后',
  '灯火小巷',
  '烟花之前',
  '清晨水面',
  '远处合影',
];

const SAMPLE_PALETTES = [
  ['#102018', '#b9f8d3', '#ff9f7f', '#fff4d7'],
  ['#14110f', '#a1d8ff', '#f7c56b', '#f2efe8'],
  ['#0e1714', '#e86d8d', '#91f2c4', '#f7efe1'],
  ['#16140d', '#9ae6b4', '#f2a65a', '#fff5ea'],
  ['#101618', '#f4796b', '#bde0a8', '#f6f1e8'],
];

function loadImageAspect(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const width = image.naturalWidth || 4;
      const height = image.naturalHeight || 3;
      resolve(width / height);
    };
    image.onerror = () => resolve(4 / 3);
    image.src = source;
  });
}

function loadVideoAspect(source) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;

    const finish = (aspectRatio) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(aspectRatio);
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 16;
      const height = video.videoHeight || 9;
      finish(width / height);
    };
    video.onerror = () => finish(16 / 9);
    video.src = source;

    window.setTimeout(() => finish(16 / 9), 3600);
  });
}

export async function enrichMediaMetadata(record) {
  const aspectRatio =
    record.kind === 'video'
      ? await loadVideoAspect(record.source)
      : await loadImageAspect(record.previewSource || record.source);

  return {
    ...record,
    aspectRatio,
  };
}

export async function prepareMemoryRecords(records, { onProgress } = {}) {
  const inputRecords = Array.from(records ?? []);
  const preparedRecords = [];
  const total = inputRecords.length;

  for (let index = 0; index < total; index += 1) {
    const record = inputRecords[index];
    onProgress?.({
      completed: index,
      total,
      current: record,
      status: 'processing',
    });

    const preparedRecord = await enrichMediaMetadata(record);
    preparedRecords.push(preparedRecord);

    onProgress?.({
      completed: index + 1,
      total,
      current: preparedRecord,
      status: 'done',
    });
  }

  return preparedRecords;
}

function drawSampleMemory(index, title, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 820;
  const ctx = canvas.getContext('2d');
  const [base, accentA, accentB, paper] = palette;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, base);
  gradient.addColorStop(0.55, '#1f2b22');
  gradient.addColorStop(1, '#090d0b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.78;
  ctx.fillStyle = accentA;
  ctx.fillRect(88 + index * 11, 118, 290, 512);
  ctx.fillStyle = accentB;
  ctx.fillRect(424, 178 + index * 7, 612, 350);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = paper;
  ctx.lineWidth = 2;
  for (let line = 0; line < 16; line += 1) {
    const y = 70 + line * 46 + (index % 3) * 6;
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.bezierCurveTo(310, y - 70, 610, y + 80, 1140, y - 20);
    ctx.stroke();
  }

  const random = hashString(`${title}-${index}`);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = paper;
  for (let dot = 0; dot < 150; dot += 1) {
    const x = (hashString(`${random}-x-${dot}`) % canvas.width);
    const y = (hashString(`${random}-y-${dot}`) % canvas.height);
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fffaf1';
  ctx.font = '700 74px Georgia, "Songti SC", serif';
  ctx.fillText(title, 92, 724);
  ctx.font = '500 28px "Avenir Next", "Trebuchet MS", sans-serif';
  ctx.fillText(`sample memory ${String(index + 1).padStart(2, '0')}`, 94, 770);

  return canvas.toDataURL('image/png', 0.92);
}

export function createSampleMemories(count = 9) {
  return Array.from({ length: count }, (_, index) => {
    const title = SAMPLE_TITLES[index % SAMPLE_TITLES.length];
    const palette = SAMPLE_PALETTES[index % SAMPLE_PALETTES.length];
    const source = drawSampleMemory(index, title, palette);

    return {
      id: `sample-${index + 1}`,
      kind: 'image',
      name: title,
      type: 'image/png',
      size: source.length,
      source,
      previewSource: source,
      aspectRatio: 1200 / 820,
      revokeOnReset: false,
      createdFrom: 'sample',
    };
  });
}
