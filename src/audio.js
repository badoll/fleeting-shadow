const DEFAULT_TRACK = {
  title: 'Dreamy Flashback',
  artist: 'Kevin MacLeod',
  source: '/audio/Dreamy%20Flashback.mp3',
  license: 'CC BY 4.0',
  attribution:
    'Dreamy Flashback Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0',
};

function clampVolume(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(numericValue, 1));
}

export class AmbientBgm {
  constructor({ volume = 0.42, duckedVolume = 0.16, track = DEFAULT_TRACK } = {}) {
    this.audio = null;
    this.enabled = false;
    this.ducked = false;
    this.volume = clampVolume(volume);
    this.duckedVolume = clampVolume(duckedVolume);
    this.track = track;
    this.fadeFrame = 0;
  }

  get isEnabled() {
    return this.enabled;
  }

  get attribution() {
    return this.track.attribution;
  }

  get currentVolume() {
    return this.volume;
  }

  async toggle() {
    if (this.enabled) {
      this.mute();
      return false;
    }

    await this.unmute();
    return true;
  }

  async unmute() {
    const audio = this.ensureAudio();
    audio.muted = false;
    audio.volume = 0;

    await audio.play();
    this.enabled = true;
    this.fadeTo(this.getTargetVolume(), 520);
  }

  mute() {
    if (!this.audio) {
      this.enabled = false;
      return;
    }

    this.enabled = false;
    this.fadeTo(0, 260, () => {
      if (!this.enabled) this.audio.pause();
    });
  }

  setDucked(ducked) {
    this.ducked = Boolean(ducked);
    if (this.enabled) this.fadeTo(this.getTargetVolume(), 360);
  }

  setVolume(volume) {
    this.volume = clampVolume(volume);
    if (this.enabled) this.fadeTo(this.getTargetVolume(), 160);
  }

  playMemoryCue() {
    // The selected track already carries the memory mood; avoid stacking UI chimes over it.
  }

  dispose() {
    window.cancelAnimationFrame(this.fadeFrame);
    this.fadeFrame = 0;

    if (!this.audio) return;

    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.remove();
    this.audio = null;
  }

  ensureAudio() {
    if (this.audio) return this.audio;

    const audio = document.createElement('audio');
    audio.src = this.track.source;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.dataset.bgm = this.track.title;
    audio.dataset.artist = this.track.artist;
    audio.dataset.license = this.track.license;
    audio.setAttribute('aria-hidden', 'true');
    document.body.append(audio);

    this.audio = audio;
    return audio;
  }

  getTargetVolume() {
    return this.ducked ? this.duckedVolume : this.volume;
  }

  fadeTo(targetVolume, durationMs, onDone) {
    const audio = this.ensureAudio();
    const target = clampVolume(targetVolume);
    const start = audio.volume;
    const startedAt = performance.now();

    window.cancelAnimationFrame(this.fadeFrame);

    const tick = (now) => {
      const rawProgress = durationMs <= 0 ? 1 : (now - startedAt) / durationMs;
      const progress = Math.max(0, Math.min(rawProgress, 1));
      audio.volume = clampVolume(start + (target - start) * progress);

      if (progress < 1) {
        this.fadeFrame = window.requestAnimationFrame(tick);
        return;
      }

      this.fadeFrame = 0;
      onDone?.();
    };

    this.fadeFrame = window.requestAnimationFrame(tick);
  }
}
