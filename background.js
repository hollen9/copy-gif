const NATIVE_HOST_NAME = 'com.copygif.host';
const MAX_BYTES = 25 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'copy-gif', title: 'Copy GIF (preserve animation)', contexts: ['image', 'link', 'video'] });
    chrome.contextMenus.create({ id: 'copy-twitter-gif', title: 'Copy GIF (preserve animation)', contexts: ['page'],
      documentUrlPatterns: ['*://*.x.com/*', '*://*.twitter.com/*'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (['copy-gif', 'copy-twitter-gif'].includes(info.menuItemId) && tab?.id != null) void copyFromContext(info, tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'copyGifProgress' && sender.tab?.id != null &&
      Number.isInteger(message.percent) && message.percent >= 0 && message.percent <= 100) {
    void chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.percent + '%' });
    sendResponse({ success: true });
    return;
  }
  if (message.action !== 'copyGifData' || sender.tab?.id == null) return;
  copyCandidate({ data: message.data }, sender.tab.id, sender.frameId ?? 0).then(sendResponse);
  return true;
});

async function nativeMessage(message) {
  return new Promise((resolve) => {
    let done = false;
    let port;
    const finish = (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(response);
      port?.disconnect();
    };
    const timer = setTimeout(() => finish({ success: false, error: 'Native host connection timed out.' }), 45000);
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      port.onMessage.addListener(finish);
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        finish({ success: false, error: error?.message || 'Native host disconnected before responding.' });
      });
      port.postMessage(message);
    } catch (error) { finish({ success: false, error: error.message }); }
  });
}

async function copyFromContext(info, tabId) {
  const frameId = info.frameId ?? 0;
  return copyCandidate(async () => {
    let candidate;
    try {
      candidate = await chrome.tabs.sendMessage(tabId, {
        action: 'getGifCandidate', directUrl: info.srcUrl || info.linkUrl
      }, { frameId });
    } catch { /* Already-open or browser image pages may have no content script. */ }
    if (candidate?.error) throw new Error(candidate.error);
    return { ...candidate, url: candidate?.url || info.srcUrl || info.linkUrl };
  }, tabId, frameId);
}

async function copyCandidate(source, tabId, frameId) {
  await chrome.action.setBadgeText({ tabId, text: '…' });
  try {
    const candidate = typeof source === 'function' ? await source() : source;
    const url = candidate?.url;
    if (!url && !candidate?.data) throw new Error('No GIF found. Right-click the original GIF image.');
    if (candidate?.data && (typeof candidate.data !== 'string' || candidate.data.length > Math.ceil(MAX_BYTES / 3) * 4)) {
      throw new Error('GIF exceeds 25 MiB.');
    }
    let result;
    if (candidate?.data) {
      result = await nativeMessage({ action: 'copyGif', data: candidate.data });
    } else {
      // Fetch outside the page so ordinary cross-origin GIFs do not require page CORS.
      result = await nativeMessage({ action: 'copyGif', url });
      if (!result.success && /^https?:\/\//i.test(url)) {
        // Browser fetch also supports sites using browser cookies or proxy settings.
        try {
          const data = await fetchGif(url);
          result = await nativeMessage({ action: 'copyGif', data });
        } catch (error) { result.error += '; ' + error.message; }
      }
    }
    if (!result.success) throw new Error(result.error || 'Failed to copy GIF.');
    await report(tabId, frameId, true, 'GIF copied. Press Ctrl+V to paste into Discord or LINE.');
    return { success: true };
  } catch (error) {
    await report(tabId, frameId, false, error.message);
    return { success: false, error: error.message };
  }
}

async function fetchGif(url) {
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Image download failed: HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('GIF exceeds 25 MiB.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) throw new Error('GIF exceeds 25 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!/^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)))) {
    throw new Error('This image is not a GIF. Open the original GIF; WebP and MP4 previews are not converted.');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

async function report(tabId, frameId, success, message) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: success ? '#247246' : '#bc3434' });
  await chrome.action.setBadgeText({ tabId, text: success ? 'OK' : 'ERR' });
  await chrome.action.setTitle({ tabId, title: 'Copy GIF: ' + message });
  try { await chrome.tabs.sendMessage(tabId, { action: 'copyGifResult', success, message }, { frameId }); } catch { }
}

chrome.action.onClicked.addListener(async (tab) => {
  const response = await nativeMessage({ action: 'ping' });
  if (tab.id != null) await report(tab.id, 0, response.success,
    response.success ? 'Native host connected. Right-click a GIF and select Copy GIF.' : response.error);
});
