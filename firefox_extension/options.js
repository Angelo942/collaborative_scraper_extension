// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  const ipInput = document.getElementById('server-ip');
  const portInput = document.getElementById('server-port');
  const saveBtn = document.getElementById('save-btn');
  const allowRedirect = document.getElementById('interactive-mode')
  const status = document.getElementById('status');

  if (!ipInput || !portInput || !saveBtn || !status) {
    console.error("Options page elements missing");
    return;
  }

  // Load saved settings with defaults
  chrome.storage.local.get(
    {
      serverIP: "127.0.0.1",
      serverPort: "5000",
      allowRedirect: false
    },
    (data) => {
      ipInput.value = data.serverIP;
      portInput.value = data.serverPort;
      allowRedirect.checked = Boolean(data.allowRedirect);
    }
  );

  // Save settings
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set(
      { serverIP: ipInput.value, serverPort: portInput.value, allowRedirect: allowRedirect.checked},
      () => {
        status.textContent = 'Settings saved!';
        setTimeout(() => status.textContent = '', 2000);
      }
    );
  });
});
