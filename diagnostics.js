document.getElementById('identity').textContent = 'Extension ID: ' + chrome.runtime.id;
document.getElementById('test').addEventListener('click', testNativeHost);
function testNativeHost() {
  const result = document.getElementById('result');
  result.textContent = 'Connecting...';
  chrome.runtime.sendNativeMessage('com.copygif.host', { action: 'ping' }, response => {
    const error = chrome.runtime.lastError;
    result.textContent = error ? 'Connection failed: ' + error.message : 'Native host connected\n' + JSON.stringify(response, null, 2);
  });
}
testNativeHost();
