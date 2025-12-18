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

  if (!ipInput || !portInput || !saveBtn || !status || !siteInput || !addSiteBtn || !siteList) {
    console.error("Options page elements missing");
    return;
  }

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
      ipInput.value = data.serverIP;
      portInput.value = data.serverPort;
      allowRedirect.checked = Boolean(data.allowRedirect);
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
     Event listeners
  ----------------------------- */

  // Save server settings
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set(
      { serverIP: ipInput.value, serverPort: portInput.value, allowRedirect: allowRedirect.checked },
      () => {
        status.textContent = 'Settings saved!';
        setTimeout(() => status.textContent = '', 2000);
      }
    );
  });

  // Add site button
  addSiteBtn.addEventListener('click', () => {
    addSite(siteInput.value.trim());
    siteInput.value = '';
  });
});
