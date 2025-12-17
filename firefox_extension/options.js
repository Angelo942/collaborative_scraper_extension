// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['serverIP', 'serverPort'], (data) => {
    if (data.serverIP) document.getElementById('server-ip').value = data.serverIP;
    if (data.serverPort) document.getElementById('server-port').value = data.serverPort;
  });
});

// Save settings
document.getElementById('save-btn').addEventListener('click', () => {
  const ip = document.getElementById('server-ip').value;
  const port = document.getElementById('server-port').value;

  chrome.storage.sync.set({ serverIP: ip, serverPort: port }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Settings saved!';
    setTimeout(() => status.textContent = '', 2000);
  });
});
