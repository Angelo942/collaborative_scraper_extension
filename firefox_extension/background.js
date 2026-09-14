// background.js
let SERVER_URL = `http://127.0.0.1:5000/receive`;

function loadServerConfig() {
  chrome.storage.local.get(
    { serverIP: "127.0.0.1", serverPort: "5000" }, // defaults
    (data) => {
      SERVER_IP = data.serverIP || "127.0.0.1";
      SERVER_PORT = data.serverPort || "5000";

      SERVER_URL = `http://${SERVER_IP}:${SERVER_PORT}/receive`;
      console.log("[EXT] Server URL set to:", SERVER_URL);
    }
  );
}

// Load at startup
loadServerConfig();

// Update when user changes settings via options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    if (changes.serverIP) SERVER_IP = changes.serverIP.newValue || SERVER_IP;
    if (changes.serverPort) SERVER_PORT = changes.serverPort.newValue || SERVER_PORT;
    SERVER_URL = `http://${SERVER_IP}:${SERVER_PORT}/receive`;
    console.log("[EXT] Server URL updated:", SERVER_URL);
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;

  // Only inject into regular web pages. Injecting into extension pages
  // (moz-extension://), about:, view-source:, etc. is blocked by Firefox
  // and logs a "Content Script execution ... has been blocked" error.
  if (!/^https?:\/\//.test(tab.url)) return;

  chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
    const allowed = allowedSites.some(site => tab.url.startsWith(site));

    if (allowed) {
      // ✅ Allowed → inject capture script
      chrome.tabs.executeScript(tabId, {
        file: "content_script.js",
        runAt: "document_idle"
      }, () => {
        if (chrome.runtime.lastError) {
          console.debug("[EXT] Capture injection skipped:", chrome.runtime.lastError.message);
        }
      });
    } else {
      // 🚧 Not allowed → inject gatekeeper only
      chrome.tabs.executeScript(tabId, {
        file: "gatekeeper.js",
        runAt: "document_idle"
      }, () => {
        if (chrome.runtime.lastError) {
          console.debug("[EXT] Gatekeeper injection skipped:", chrome.runtime.lastError.message);
        }
      });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "sendSnapshot") {
    fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload)
    })
      .then(r => r.json())
      .then(data => {
        sendResponse({ instructions: data.instructions || [], server_response: data.status || "ok" });
      })
      .catch(err => {
        console.error("Upload failed:", err);
        sendResponse({ error: String(err) });
      });
    // keep channel open for async response
    return true;
  }
  else if (msg.action === "openOptions") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      console.warn("[EXT] Cannot open options page.");
    }
  }
  else if (msg.type === "GET_TAB_ID") {
    sendResponse(sender.tab?.id);
  }
});

chrome.browserAction.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url) return;

  // Only act on regular web pages; extension/about: pages can't be injected.
  if (!/^https?:\/\//.test(tab.url)) return;

  const site = new URL(tab.url).origin;

  chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
    if (allowedSites.includes(site)) {
      chrome.tabs.sendMessage(tab.id, { action: "CAPTURE_PAGE" });
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { action: "ASK_ADD_SITE", site },
      (response) => {
        if (!response || !response.accepted) {
          console.log("[EXT] User refused to allow site:", site);
          return;
        }

        // User accepted → add site and capture
        chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
          if (!allowedSites.includes(site)) {
            allowedSites.push(site);
          }
        
          chrome.tabs.executeScript(tab.id, {
            file: "content_script.js",
            runAt: "document_idle"
          }, () => {
            if (chrome.runtime.lastError) {
              console.debug("[EXT] Capture injection skipped:", chrome.runtime.lastError.message);
            }
          });

          chrome.storage.local.set({ allowedSites }, () => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { action: "CAPTURE_PAGE" });
            }, 1000); // Wait 1s for the extension to load
          });
        });
      }
    );
  });
});

// Clear data when closing tab and restarting browser
const TAB_STATE_KEY = 'activeTabs';
const TOKENS_KEY = 'sessionTokens';
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get({ [TAB_STATE_KEY]: {} }, (data) => {
    const activeTabs = data[TAB_STATE_KEY] || {};
    if (activeTabs[tabId]) {
      delete activeTabs[tabId];
      chrome.storage.local.set({ [TAB_STATE_KEY]: activeTabs });
    }
  });
  chrome.storage.local.get({ [TOKENS_KEY]: {} }, (data) => {
    const activeTabs = data[TOKENS_KEY] || {};
    if (activeTabs[tabId]) {
      delete activeTabs[tabId];
      chrome.storage.local.set({ [TOKENS_KEY]: activeTabs });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ [TAB_STATE_KEY]: {} });
  chrome.storage.local.set({ [TOKENS_KEY]: {} });
});