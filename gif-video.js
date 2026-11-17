// X serves uploaded GIFs as short MP4s. Decode a separate video so copying
// neither seeks nor pauses the player's video.
const CopyGifVideo = (() => {
  const MAX_BYTES = 25 * 1024 * 1024;
  const MAX_SECONDS = 30;
  const MAX_EDGE = 480;
  const FPS = 20;

  function twitterUrl(video) {
    try {
      const url = new URL(video?.currentSrc || video?.src);
      return url.protocol === 'https:' && url.hostname === 'video.twimg.com' &&
        /^\/tweet_video\/[\w-]+\.mp4$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }

  async function download(url) {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Animation download failed: HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Animation exceeds 25 MiB.');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('Animation exceeds 25 MiB.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return new Blob(chunks, { type: 'video/mp4' });
  }

  function mediaEvent(video, name, action) {
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        video.removeEventListener(name, ready);
        video.removeEventListener('error', failed);
        error ? reject(error) : resolve();
      };
      const ready = () => finish();
      const failed = () => finish(new Error('Unable to decode this animation.'));
      const timer = setTimeout(() => finish(new Error('Animation decoding timed out.')), 10000);
      video.addEventListener(name, ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      try { action(); } catch (error) { finish(error); }
    });
  }

  async function convert(url, progress = () => {}) {
    if (!twitterUrl({ src: url })) throw new Error('This is not an X GIF video.');
    const blob = await download(url);
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      await mediaEvent(video, 'loadeddata', () => { video.src = objectUrl; video.load(); });
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) {
        throw new Error('Unable to read animation dimensions or duration.');
      }
      if (duration > MAX_SECONDS) throw new Error('X GIF conversion supports animations up to 30 seconds.');
      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const gif = gifenc.GIFEncoder();
      const frames = Math.max(1, Math.ceil(duration * FPS));
      const start = performance.now();
      for (let index = 0; index < frames; index++) {
        if (performance.now() - start > 90000) throw new Error('GIF conversion timed out.');
        const time = index * duration / frames;
        if (index > 0) await mediaEvent(video, 'seeked', () => { video.currentTime = time; });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const palette = gifenc.quantize(rgba, 256);
        const pixels = gifenc.applyPalette(rgba, palette);
        // Round cumulative timestamps to GIF's 10 ms units without stretching it.
        const delay = (Math.round((index + 1) * duration * 100 / frames) -
          Math.round(index * duration * 100 / frames)) * 10;
        gif.writeFrame(pixels, canvas.width, canvas.height, { palette, delay, repeat: 0 });
        if (gif.bytesView().byteLength >= MAX_BYTES) throw new Error('Converted GIF exceeds 25 MiB.');
        progress(Math.round((index + 1) * 100 / frames));
      }
      gif.finish();
      const bytes = gif.bytesView();
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  return { twitterUrl, convert };
})();
