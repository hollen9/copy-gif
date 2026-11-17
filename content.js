// Remember the real context target. contextMenus.OnClickData has no pageX/pageY.
let contextTarget = null;
let convertingVideo = false;
const isTwitter = /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(location.hostname);

document.addEventListener('contextmenu', (event) => {
  contextTarget = event.composedPath()[0];
  // Keep the browser menu instead of X's "Copy video address" menu.
  if (findTwitterGif(contextTarget)) event.stopImmediatePropagation();
}, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getGifCandidate') {
    getCandidate(message.directUrl).then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message.action === 'copyGifResult') showNotification(message.message, message.success);
});

function looksLikeGif(url) { return /\.gif(?:[?#]|$)/i.test(url || '') || /^data:image\/gif[;,]/i.test(url || ''); }

function findGif(element) {
  if (!(element instanceof Element)) return null;
  const nodes = [element, ...Array.from(element.querySelectorAll('img, source, a, video')).slice(0, 100)];
  for (const node of nodes) {
    const urls = [node.currentSrc, node.src, node.href, node.poster, node.getAttribute('data-src')];
    if (node.srcset) urls.push(...node.srcset.split(',').map(item => item.trim().split(/\s+/)[0]));
    const bg = getComputedStyle(node).backgroundImage;
    for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) urls.push(match[1]);
    const url = urls.find(looksLikeGif);
    if (url) return new URL(url, document.baseURI).href;
  }
  return null;
}

async function getCandidate(directUrl) {
  const twitterVideo = findTwitterGif(contextTarget);
  if (twitterVideo) return convertTwitterGif(twitterVideo);
  const url = (looksLikeGif(directUrl) && directUrl) || findGif(contextTarget) ||
    findGif(contextTarget?.parentElement) || directUrl;
  if (!url) throw new Error('No GIF found. Right-click the original GIF image.');
  if (/^(blob:|data:)/i.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Unable to read this image.');
    const blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024) throw new Error('GIF exceeds 25 MiB.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Unable to read GIF.'));
      reader.readAsDataURL(blob);
    });
    return { url, data };
  }
  return { url };
}

function findTwitterGif(target) {
  if (!isTwitter || !(target instanceof Element)) return null;
  const player = target.closest('[data-testid="videoComponent"], [data-testid="videoPlayer"]');
  const video = target.matches('video') ? target : player?.querySelector('video');
  return CopyGifVideo.twitterUrl(video) ? video : null;
}

async function convertTwitterGif(video) {
  if (convertingVideo) throw new Error('A GIF is already being converted.');
  convertingVideo = true;
  try {
    showNotification('Converting GIF…', true, 0);
    let lastProgress = -1;
    const data = await CopyGifVideo.convert(CopyGifVideo.twitterUrl(video), percent => {
      const step = Math.floor(percent / 10) * 10;
      if (step !== lastProgress) {
        lastProgress = step;
        showNotification('Converting GIF… ' + step + '%', true, 0);
        // Progress messages also keep the service worker alive during conversion.
        void chrome.runtime.sendMessage({ action: 'copyGifProgress', percent: step }).catch(() => {});
      }
    });
    return { data };
  } finally { convertingVideo = false; }
}

function addTwitterButtons() {
  // X reuses player containers while scrolling; discard stale buttons first.
  for (const button of document.querySelectorAll('[data-copy-gif-button]')) {
    const video = button.parentElement.querySelector('video');
    if (!CopyGifVideo.twitterUrl(video)) button.remove();
  }
  for (const video of document.querySelectorAll('video')) {
    if (!CopyGifVideo.twitterUrl(video)) continue;
    const player = video.closest('[data-testid="videoComponent"], [data-testid="videoPlayer"]');
    if (!player || player.querySelector('[data-copy-gif-button]')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy GIF';
    button.dataset.copyGifButton = '';
    button.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5;padding:7px 11px;border:1px solid #ffffff80;border-radius:6px;background:#171717e6;color:#fff;font:600 13px/1.4 system-ui,sans-serif;cursor:pointer';
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted || button.disabled) return;
      button.disabled = true;
      button.textContent = 'Converting…';
      try {
        const candidate = await convertTwitterGif(player.querySelector('video'));
        button.textContent = 'Copying…';
        await chrome.runtime.sendMessage({ action: 'copyGifData', data: candidate.data });
      } catch (error) { showNotification(error.message, false); }
      finally { button.disabled = false; button.textContent = 'Copy GIF'; }
    });
    player.appendChild(button);
  }
}

if (isTwitter) {
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; addTwitterButtons(); }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  addTwitterButtons();
}

function showNotification(message, success, duration = success ? 4500 : 12000) {
  document.getElementById('copy-gif-notice')?.remove();
  const notice = document.createElement('div');
  notice.id = 'copy-gif-notice';
  notice.textContent = message;
  notice.setAttribute('role', success ? 'status' : 'alert');
  notice.style.cssText = 'position:fixed;top:20px;right:20px;padding:14px 20px;background:' +
    (success ? '#247246' : '#bc3434') +
    ';color:white;border-radius:6px;z-index:2147483647;font:14px/1.6 system-ui,sans-serif;max-width:420px;white-space:pre-wrap;pointer-events:none;box-shadow:0 2px 12px #0003';
  (document.body || document.documentElement).appendChild(notice);
  if (duration) setTimeout(() => notice.remove(), duration);
}
