const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function background(options = {}) {
  const calls = { messages: [], sent: [], badges: [], timers: new Set() };
  let menuListener, actionListener, installedListener;
  const chrome = {
    runtime: {
      onInstalled: { addListener: cb => installedListener = cb },
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
    contextMenus: { removeAll: cb => cb(), create: value => calls.menu = value, onClicked: { addListener: cb => menuListener = cb } },
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
    'copyFromContext(' + JSON.stringify(info) + ', 123)', context), action: () => actionListener({ id: 123 }) };
}

test('menu is recreated and includes image/link/video', () => {
  const app = background(); app.menu();
  assert.deepEqual(Array.from(app.calls.menu.contexts), ['image', 'link', 'video']);
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
