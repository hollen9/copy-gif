const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function background(options = {}) {
  const calls = { messages: [], sent: [], badges: [], menus: [], timers: new Set() };
  let menuListener, actionListener, installedListener, messageListener;
  const chrome = {
    runtime: {
      onInstalled: { addListener: cb => installedListener = cb },
      onMessage: { addListener: cb => messageListener = cb },
      connectNative: () => {
        const listeners = {};
        const port = {
          onMessage: { addListener: cb => listeners.message = cb },
          onDisconnect: { addListener: cb => listeners.disconnect = cb },
          disconnect: () => listeners.disconnect?.(),
          postMessage: message => {
            calls.messages.push(message);
            queueMicrotask(() => {
              if (options.disconnect) listeners.disconnect();
              else listeners.message(options.response || { success: true });
            });
          }
        };
        return port;
      }
    },
    contextMenus: { removeAll: cb => cb(), create: value => calls.menus.push(value), onClicked: { addListener: cb => menuListener = cb } },
    tabs: { sendMessage: async (tab, message, frame) => {
      calls.sent.push({ tab, message, frame });
      if (message.action === 'getGifCandidate') {
        if (options.noContent) throw new Error('no content script');
        return options.candidate || { url: 'https://cdn.example/animation?id=1' };
      }
    }},
    action: {
      setBadgeText: async value => calls.badges.push(value),
      setBadgeBackgroundColor: async () => {},
      setTitle: async value => calls.title = value,
      onClicked: { addListener: cb => actionListener = cb }
    }
  };
  const context = vm.createContext({
    chrome, console, Uint8Array, AbortSignal,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: options.fetch || (async () => { throw new Error('unexpected page/browser fetch'); }),
    setTimeout: cb => { const id = {}; calls.timers.add(id); return id; },
    clearTimeout: id => calls.timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  return { calls, context, menu: () => installedListener(), click: info => vm.runInContext(
    'copyFromContext(' + JSON.stringify(info) + ', 123)', context), action: () => actionListener({ id: 123 }),
    message: (message, sender) => new Promise(resolve => messageListener(message, sender, resolve)) };
}

test('menu is recreated and includes image/link/video', () => {
  const app = background(); app.menu();
  assert.deepEqual(Array.from(app.calls.menus[0].contexts), ['image', 'link', 'video']);
  assert.deepEqual(Array.from(app.calls.menus[1].contexts), ['page']);
  assert.deepEqual(Array.from(app.calls.menus[1].documentUrlPatterns), ['*://*.x.com/*', '*://*.twitter.com/*']);
  assert.equal(app.calls.menus.length, 2);
  assert.equal(app.calls.menus[0].documentUrlPatterns, undefined);
  assert.ok(app.calls.menus[0].contexts.every(context => !app.calls.menus[1].contexts.includes(context)));
});
test('extensionless URL goes straight to host with correct frame', async () => {
  const app = background();
  await app.click({ menuItemId: 'copy-gif', srcUrl: 'https://preview.example/image', frameId: 7 });
  assert.equal(app.calls.sent[0].frame.frameId, 7);
  assert.equal(app.calls.messages[0].url, 'https://cdn.example/animation?id=1');
  assert.equal(app.calls.sent.at(-1).frame.frameId, 7);
  assert.equal(app.calls.badges.at(-1).text, 'OK');
  assert.equal(app.calls.timers.size, 0);
});
test('direct image page without content script still copies', async () => {
  const app = background({ noContent: true });
  await app.click({ srcUrl: 'https://cdn.example/original.gif' });
  assert.equal(app.calls.messages[0].url, 'https://cdn.example/original.gif');
  assert.equal(app.calls.badges.at(-1).text, 'OK');
});
test('blob bytes from correct content frame are sent unchanged', async () => {
  const app = background({ candidate: { url: 'blob:https://example/1', data: 'R0lGODlh' } });
  await app.click({ frameId: 3 });
  assert.equal(app.calls.messages[0].data, 'R0lGODlh');
  assert.equal(app.calls.messages[0].url, undefined);
});
test('native disconnect without lastError resolves and clears timer', async () => {
  const app = background({ disconnect: true, candidate: { url: 'blob:https://example/1', data: 'R0lGODlh' } });
  await app.click({});
  assert.equal(app.calls.badges.at(-1).text, 'ERR');
  assert.match(app.calls.title.title, /disconnected before responding/);
  assert.equal(app.calls.timers.size, 0);
});
test('candidate errors do not write clipboard', async () => {
  const app = background({ candidate: { error: 'Not a GIF' } });
  await app.click({});
  assert.equal(app.calls.messages.length, 0);
  assert.equal(app.calls.badges.at(-1).text, 'ERR');
});
test('host ping does not download or overwrite clipboard', async () => {
  const app = background();
  await app.action();
  assert.equal(app.calls.messages[0].action, 'ping');
  assert.equal(app.calls.badges.at(-1).text, 'OK');
});
test('browser fetch rejects HTML masquerading as GIF', async () => {
  const app = background({ response: { success: false, error: 'HTTP 403' },
    fetch: async () => new Response('<html>GIF</html>') });
  await app.click({});
  assert.equal(app.calls.messages.length, 1);
  assert.equal(app.calls.badges.at(-1).text, 'ERR');
});
test('browser fallback sends valid GIF bytes to native host', async () => {
  const app = background({ response: { success: false, error: 'HTTP 403' },
    fetch: async () => new Response('GIF89aTEST') });
  await app.click({});
  assert.equal(app.calls.messages.length, 2);
  assert.equal(Buffer.from(app.calls.messages[1].data, 'base64').toString(), 'GIF89aTEST');
});

test('Twitter button copies converted bytes and reports to its source frame', async () => {
  const app = background();
  const result = await app.message({ action: 'copyGifData', data: 'R0lGODlh' }, { tab: { id: 456 }, frameId: 9 });
  assert.equal(result.success, true);
  assert.equal(app.calls.messages[0].data, 'R0lGODlh');
  assert.equal(app.calls.sent.at(-1).tab, 456);
  assert.equal(app.calls.sent.at(-1).frame.frameId, 9);
  assert.equal(app.calls.badges.at(-1).text, 'OK');
});

test('failed button copy returns the backend error', async () => {
  const app = background({ response: { success: false, error: 'Clipboard busy' } });
  const result = await app.message({ action: 'copyGifData', data: 'R0lGODlh' }, { tab: { id: 123 } });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Clipboard busy');
  assert.equal(app.calls.badges.at(-1).text, 'ERR');
});

test('oversized converted payload never reaches the host', async () => {
  const app = background();
  const result = await app.message({ action: 'copyGifData', data: 'A'.repeat(35 * 1024 * 1024) }, { tab: { id: 123 } });
  assert.equal(result.success, false);
  assert.equal(app.calls.messages.length, 0);
});

test('conversion progress updates the badge without touching the clipboard', async () => {
  const app = background();
  await app.message({ action: 'copyGifProgress', percent: 50 }, { tab: { id: 123 } });
  assert.equal(app.calls.badges.at(-1).text, '50%');
  assert.equal(app.calls.messages.length, 0);
});

const videoContext = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gif-video.js'), 'utf8'), videoContext);
test('only X GIF MP4 sources are eligible for conversion', () => {
  const check = url => vm.runInContext('CopyGifVideo.twitterUrl({src:' + JSON.stringify(url) + '})', videoContext);
  assert.equal(check('https://video.twimg.com/tweet_video/HWtlBQLXYAA7vhn.mp4'), 'https://video.twimg.com/tweet_video/HWtlBQLXYAA7vhn.mp4');
  for (const url of ['https://video.twimg.com/amplify_video/1/movie.mp4', 'blob:https://x.com/123',
    'https://video.twimg.com.evil.example/tweet_video/test.mp4', 'http://video.twimg.com/tweet_video/test.mp4',
    'https://x.com/name/status/123', 'not a URL']) assert.equal(check(url), null, url);
});

function converter(fetch) {
  const context = vm.createContext({ URL, fetch, AbortSignal });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gif-video.js'), 'utf8'), context);
  return () => vm.runInContext("CopyGifVideo.convert('https://video.twimg.com/tweet_video/test.mp4')", context);
}

test('video download reports HTTP errors before decoding', async () => {
  const convert = converter(async () => new Response('', { status: 403 }));
  await assert.rejects(convert(), /HTTP 403/);
});

test('oversized video content length is rejected before reading the body', async () => {
  const convert = converter(async () => new Response('', { headers: { 'content-length': String(26 * 1024 * 1024) } }));
  await assert.rejects(convert(), /exceeds 25 MiB/);
});

test('video download is bounded even without content length', async () => {
  let cancelled = false;
  const convert = converter(async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(26 * 1024 * 1024) }),
    cancel: async () => { cancelled = true; }
  }) } }));
  await assert.rejects(convert(), /exceeds 25 MiB/);
  assert.equal(cancelled, true);
});

function twitterPage(src = 'https://video.twimg.com/tweet_video/example.mp4') {
  class Element {
    matches(selector) { return selector === 'video' && this === video; }
    closest(selector) {
      return this === outside ? null : player;
    }
    querySelector(selector) {
      if (selector === 'video') return video;
      return null;
    }
  }
  const window = new EventTarget();
  const video = Object.assign(new Element(), { src });
  const player = new Element(), overlay = new Element(), outside = new Element();
  let listener;
  const context = vm.createContext({
    window, Element, URL,
    location: { hostname: 'x.com', href: 'https://x.com/home' },
    document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {} },
    MutationObserver: class { observe() {} },
    chrome: { runtime: { onMessage: { addListener: cb => listener = cb } } }
  });
  for (const file of ['twitter-context.js', 'gif-video.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return {
    window, overlay, outside, context,
    event(type = 'contextmenu', target = overlay, button = 2) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'button', { value: button });
      event.composedPath = () => [target];
      window.dispatchEvent(event);
      return event;
    },
    message: message => new Promise(resolve => listener(message, {}, resolve))
  };
}

test('early window capture stops X context handlers without cancelling the browser menu', () => {
  const page = twitterPage();
  let siteCalls = 0;
  page.window.addEventListener('contextmenu', event => { siteCalls++; event.preventDefault(); }, true);
  const event = page.event();
  assert.equal(siteCalls, 0);
  assert.equal(event.defaultPrevented, false);
});

test('right mouse handlers are blocked on X GIFs while left clicks still reach X', () => {
  const page = twitterPage();
  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
    let siteCalls = 0;
    page.window.addEventListener(name, () => siteCalls++, true);
    page.event(name);
    assert.equal(siteCalls, 0, name);
    page.event(name, page.overlay, 0);
    assert.equal(siteCalls, 1, name);
  }
});

test('regular video and page context menus keep their original handlers', () => {
  for (const src of ['https://video.twimg.com/amplify_video/123/movie.mp4', 'blob:https://x.com/123']) {
    const page = twitterPage(src);
    let siteCalls = 0;
    page.window.addEventListener('contextmenu', () => siteCalls++, true);
    page.event();
    page.event('contextmenu', page.outside);
    assert.equal(siteCalls, 2);
  }
});

test('animation copying uses the target captured before document handlers run', async () => {
  const page = twitterPage();
  vm.runInContext("showNotification = () => {}; CopyGifVideo.convert = async () => 'R0lGODlh';", page.context);
  page.event();
  const response = await page.message({ action: 'getGifCandidate', directUrl: 'https://x.com/author/status/123456' });
  assert.equal(response.data, 'R0lGODlh');
  assert.equal(response.error, undefined);
});

test('the context hook runs at document start only on X and Twitter', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const hook = manifest.content_scripts.find(script => script.js.includes('twitter-context.js'));
  assert.equal(hook.run_at, 'document_start');
  assert.deepEqual(hook.matches, ['*://*.x.com/*', '*://*.twitter.com/*']);
  assert.deepEqual(manifest.permissions, ['contextMenus', 'nativeMessaging']);
  for (const script of manifest.content_scripts) {
    if (script.matches.includes('<all_urls>')) assert.deepEqual(script.js, ['content.js']);
    else assert.deepEqual(script.matches, ['*://*.x.com/*', '*://*.twitter.com/*']);
  }
});
