import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientBgm } from '../src/audio.js';

function createAudioMock() {
  let volume = 0;

  return {
    dataset: {},
    get volume() {
      return volume;
    },
    set volume(value) {
      if (value < 0 || value > 1) {
        throw new RangeError(`volume outside range: ${value}`);
      }
      volume = value;
    },
    load() {},
    pause() {},
    play() {
      return Promise.resolve();
    },
    remove() {},
    removeAttribute() {},
    setAttribute() {},
  };
}

test('clamps BGM fade progress before writing media volume', () => {
  const originalDocument = globalThis.document;
  const originalPerformance = globalThis.performance;
  const originalWindow = globalThis.window;
  const frames = [];
  const audio = createAudioMock();

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {
        append() {},
      },
      createElement(tagName) {
        assert.equal(tagName, 'audio');
        return audio;
      },
    },
  });
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: {
      now: () => 100,
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cancelAnimationFrame() {},
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
    },
  });

  try {
    const bgm = new AmbientBgm({ volume: 0.42 });
    bgm.fadeTo(0.42, 520);

    assert.equal(frames.length, 1);
    assert.doesNotThrow(() => frames[0](99.8));
    assert.equal(audio.volume, 0);
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: originalPerformance,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});
