// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  const ipInput = document.getElementById('server-ip');
  const portInput = document.getElementById('server-port');
  const saveBtn = document.getElementById('save-btn');
  const allowRedirect = document.getElementById('interactive-mode');
  const status = document.getElementById('status');
  const siteInput = document.getElementById('site-input');
  const addSiteBtn = document.getElementById('add-site-btn');
  const siteList = document.getElementById('site-list');
  const serverStatus = document.getElementById('server-status');
  const testConnectionBtn = document.getElementById('test-connection-btn');

  if (!ipInput || !portInput || !saveBtn || !status || !siteInput || !addSiteBtn || !siteList) {
    console.error("Options page elements missing");
    return;
  }

  // Last-saved server settings; the Test button pings these, so it is blocked
  // whenever the inputs have unsaved edits.
  let savedIP = "127.0.0.1";
  let savedPort = "5000";

  /* -----------------------------
     Load saved settings
  ----------------------------- */
  chrome.storage.local.get(
    {
      serverIP: "127.0.0.1",
      serverPort: "5000",
      allowRedirect: false
    },
    (data) => {
      savedIP = data.serverIP;
      savedPort = data.serverPort;
      ipInput.value = data.serverIP;
      portInput.value = data.serverPort;
      allowRedirect.checked = Boolean(data.allowRedirect);
      refreshTestButtonState();
    }
  );

  // Load allowed sites
  function loadSites() {
    chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
      const list = document.getElementById("site-list");
      list.innerHTML = "";

      allowedSites.forEach(site => {
        const box = document.createElement("div");
        box.className = "site-box";

        const span = document.createElement("span");
        span.textContent = site;

        const btn = document.createElement("button");
        btn.textContent = "×";
        btn.onclick = () => removeSite(site);

        box.appendChild(span);
        box.appendChild(btn);
        list.appendChild(box);
      });
    });
  }

  // Add site
  function addSite(site) {
    if (!site) return;
    try {
      const url = new URL(site);
      site = url.origin;
    } catch {
      alert("Invalid URL");
      return;
    }

    chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
      if (!allowedSites.includes(site)) {
        allowedSites.push(site);
        chrome.storage.local.set({ allowedSites }, loadSites);
      }
    });
  }

  // Remove site
  function removeSite(site) {
    chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
      const updated = allowedSites.filter(s => s !== site);
      chrome.storage.local.set({ allowedSites: updated }, loadSites);
    });
  }

  // Initial load
  loadSites();

  /* -----------------------------
     Server connection status
  ----------------------------- */
  function renderServerStatus(status) {
    if (!serverStatus) return;
    if (!status || status.ok === undefined) {
      serverStatus.textContent = "Unknown";
      serverStatus.style.color = "var(--muted)";
    } else if (status.ok) {
      serverStatus.textContent = "Connected";
      serverStatus.style.color = "#16a34a";
    } else {
      serverStatus.textContent = `Not responding${status.error ? " (" + status.error + ")" : ""}`;
      serverStatus.style.color = "#dc2626";
    }
  }

  // The Test button pings the *saved* IP/port, so block it (and hint why)
  // while the inputs hold unsaved changes.
  function hasUnsavedServerChanges() {
    return ipInput.value !== savedIP || portInput.value !== savedPort;
  }

  function refreshTestButtonState() {
    if (!testConnectionBtn) return;
    const unsaved = hasUnsavedServerChanges();
    testConnectionBtn.disabled = unsaved;
    testConnectionBtn.style.opacity = unsaved ? "0.5" : "";
    testConnectionBtn.style.cursor = unsaved ? "not-allowed" : "pointer";
    testConnectionBtn.title = unsaved ? "Save the settings before testing the connection" : "";
  }

  // Ask the background script to ping the server and refresh the display.
  function checkServerConnection() {
    if (hasUnsavedServerChanges()) return; // guard: never ping stale settings
    if (serverStatus) {
      serverStatus.textContent = "Checking…";
      serverStatus.style.color = "var(--muted)";
    }
    chrome.runtime.sendMessage({ action: "pingServer" }, (status) => {
      if (chrome.runtime.lastError) {
        renderServerStatus({ ok: false, error: String(chrome.runtime.lastError.message || chrome.runtime.lastError) });
        return;
      }
      renderServerStatus(status);
    });
  }

  // Show the last known status immediately, then re-check live.
  chrome.storage.local.get({ serverStatus: null }, (data) => renderServerStatus(data.serverStatus));
  checkServerConnection();

  if (testConnectionBtn) {
    testConnectionBtn.addEventListener('click', checkServerConnection);
  }

  // Block/unblock the Test button as the user edits IP/port.
  ipInput.addEventListener('input', refreshTestButtonState);
  portInput.addEventListener('input', refreshTestButtonState);

  /* -----------------------------
     Event listeners
  ----------------------------- */

  // Save server settings
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set(
      { serverIP: ipInput.value, serverPort: portInput.value, allowRedirect: allowRedirect.checked },
      () => {
        status.textContent = 'Settings saved!';
        setTimeout(() => status.textContent = '', 2000);
        // Inputs are now the saved values; unblock and re-check the connection.
        savedIP = ipInput.value;
        savedPort = portInput.value;
        refreshTestButtonState();
        checkServerConnection();
      }
    );
  });

  // Add site button
  addSiteBtn.addEventListener('click', () => {
    addSite(siteInput.value.trim());
    siteInput.value = '';
  });
});
