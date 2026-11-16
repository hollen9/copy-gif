// Remember the real context target. contextMenus.OnClickData has no pageX/pageY.
let contextTarget = null;
document.addEventListener('contextmenu', (event) => { contextTarget = event.composedPath()[0]; }, true);

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

function showNotification(message, success) {
  document.getElementById('copy-gif-notice')?.remove();
  const notice = document.createElement('div');
  notice.id = 'copy-gif-notice';
  notice.textContent = message;
  notice.setAttribute('role', success ? 'status' : 'alert');
  notice.style.cssText = 'position:fixed;top:20px;right:20px;padding:14px 20px;background:' +
    (success ? '#247246' : '#bc3434') +
    ';color:white;border-radius:6px;z-index:2147483647;font:14px/1.6 system-ui,sans-serif;max-width:420px;white-space:pre-wrap;pointer-events:none;box-shadow:0 2px 12px #0003';
  (document.body || document.documentElement).appendChild(notice);
  setTimeout(() => notice.remove(), success ? 4500 : 12000);
}
