import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBackground,
  classifyCubeFace,
  classifyFile,
  createMediaRecordsFromFiles,
  disposeMediaRecords,
  generateBubbleLayout,
  selectRandomMemory,
} from '../src/domain.js';

test('classifies image and video files by MIME type', () => {
  assert.equal(classifyFile({ type: 'image/jpeg' }), 'image');
  assert.equal(classifyFile({ type: 'video/mp4' }), 'video');
  assert.equal(classifyFile({ type: 'application/pdf' }), null);
});

test('classifies flat and panorama background dimensions', () => {
  assert.deepEqual(classifyBackground(4096, 2048), {
    accepted: true,
    mode: 'panorama',
    quality: 'normal',
  });
  assert.deepEqual(classifyBackground(2048, 1024), {
    accepted: true,
    mode: 'panorama',
    quality: 'low',
  });
  assert.deepEqual(classifyBackground(1920, 1080), {
    accepted: true,
    mode: 'flat',
    quality: 'normal',
  });
  assert.deepEqual(classifyBackground(1280, 720), {
    accepted: true,
    mode: 'flat',
    quality: 'low',
  });
  assert.deepEqual(classifyBackground(900, 600), {
    accepted: true,
    mode: 'flat',
    quality: 'low',
  });
  assert.deepEqual(classifyBackground(512, 256), {
    accepted: true,
    mode: 'panorama',
    quality: 'low',
  });
  assert.deepEqual(classifyBackground(256, 256), {
    accepted: true,
    mode: 'flat',
    quality: 'low',
  });
});

test('classifies cube face dimensions', () => {
  assert.deepEqual(classifyCubeFace(2048, 2048), {
    accepted: true,
    mode: 'cube',
    quality: 'normal',
  });
  assert.deepEqual(classifyCubeFace(1024, 1024), {
    accepted: true,
    mode: 'cube',
    quality: 'low',
  });
  assert.deepEqual(classifyCubeFace(256, 256), {
    accepted: true,
    mode: 'cube',
    quality: 'low',
  });
  assert.deepEqual(classifyCubeFace(2048, 1024), {
    accepted: false,
    reason: 'Cube 每一面需为正方形',
  });
});

test('creates media records and reports unsupported files', () => {
  const urls = [];
  const { records, unsupported } = createMediaRecordsFromFiles(
    [
      { name: 'a.jpg', type: 'image/jpeg', size: 120, lastModified: 1 },
      { name: 'notes.txt', type: 'text/plain', size: 20, lastModified: 2 },
    ],
    {
      createObjectURL(file) {
        const url = `blob:test/${file.name}`;
        urls.push(url);
        return url;
      },
    },
  );

  assert.deepEqual(urls, ['blob:test/a.jpg']);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'image');
  assert.equal(records[0].revokeOnReset, true);
  assert.equal(unsupported.length, 1);
});

test('generates deterministic bubble layouts for a seed', () => {
  const first = generateBubbleLayout(4, 'same-seed');
  const second = generateBubbleLayout(4, 'same-seed');
  const other = generateBubbleLayout(4, 'other-seed');

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.equal(first.length, 4);
  assert.ok(first.every((bubble) => bubble.radius >= 95 && bubble.radius <= 340));
  assert.ok(first.every((bubble) => bubble.z <= -600 && bubble.z >= -9800));
});

test('selects a valid random memory and avoids previous when possible', () => {
  const memories = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const picked = selectRandomMemory(memories, 'a', () => 0);

  assert.equal(picked.id, 'b');
  assert.equal(selectRandomMemory([], null), null);
  assert.deepEqual(selectRandomMemory([{ id: 'only' }], 'only'), { id: 'only' });
});

test('releases object URLs only for file-backed records', () => {
  const released = [];
  const count = disposeMediaRecords(
    [
      { objectUrl: 'blob:a', revokeOnReset: true },
      { objectUrl: 'data:image/png;base64,abc', revokeOnReset: false },
    ],
    (url) => released.push(url),
  );

  assert.equal(count, 1);
  assert.deepEqual(released, ['blob:a']);
});
