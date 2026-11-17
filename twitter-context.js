// Register before X installs its player handlers, including window capture handlers.
const CopyGifTwitterContext = (() => {
  let target = null;

  function gifAt(element) {
    if (!(element instanceof Element)) return null;
    const player = element.closest('[data-testid="videoComponent"], [data-testid="videoPlayer"]');
    const video = element.matches('video') ? element : player?.querySelector('video');
    try {
      const url = new URL(video?.currentSrc || video?.src);
      return url.protocol === 'https:' && url.hostname === 'video.twimg.com' &&
        /^\/tweet_video\/[\w-]+\.mp4$/.test(url.pathname) ? video : null;
    } catch { return null; }
  }

  window.addEventListener('contextmenu', event => {
    target = event.composedPath()[0];
    // Preserve the browser's default action; only stop the site's handlers.
    if (gifAt(target)) event.stopImmediatePropagation();
  }, true);

  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
    window.addEventListener(name, event => {
      if (event.button === 2 && gifAt(event.composedPath()[0])) event.stopImmediatePropagation();
    }, true);
  }

  return { get target() { return target; } };
})();
