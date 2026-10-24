const tokenInput = document.getElementById('token');
const status = document.getElementById('status');
function show(data) {
  status.textContent = `Monitor: ${data.connection || 'waiting'}. Browser control ${chrome.runtime.getManifest().version}: ${data.browserConnection || (data.token ? 'waiting for Orvix' : 'not paired')}.`;
}
chrome.storage.local.get(['token', 'connection', 'browserConnection'], data => {
  if (data.token) tokenInput.value = data.token;
  show(data);
});
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') chrome.storage.local.get(['token', 'connection', 'browserConnection'], show); });
document.getElementById('save').addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) { status.textContent = 'Enter the 64-character token shown in the terminal.'; return; }
  await chrome.storage.local.set({ token, connection: 'connecting' });
  status.textContent = 'Connecting. Keep the monitor terminal open.';
});
