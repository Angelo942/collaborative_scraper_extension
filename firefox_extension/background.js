// background.js
let SERVER_IP = "127.0.0.1";
let SERVER_PORT = "5000";
let SERVER_BASE = `http://${SERVER_IP}:${SERVER_PORT}`;
let SERVER_URL = `${SERVER_BASE}/receive`;
let FETCH_RESULT_URL = `${SERVER_BASE}/fetch_result`;
let PING_URL = `${SERVER_BASE}/ping`;

function rebuildServerUrls() {
  SERVER_BASE = `http://${SERVER_IP}:${SERVER_PORT}`;
  SERVER_URL = `${SERVER_BASE}/receive`;
  FETCH_RESULT_URL = `${SERVER_BASE}/fetch_result`;
  PING_URL = `${SERVER_BASE}/ping`;
}

function loadServerConfig() {
  chrome.storage.local.get(
    { serverIP: "127.0.0.1", serverPort: "5000" }, // defaults
    (data) => {
      SERVER_IP = data.serverIP || "127.0.0.1";
      SERVER_PORT = data.serverPort || "5000";

      rebuildServerUrls();
      console.log("[EXT] Server URL set to:", SERVER_URL);
    }
  );
}

// Ping the server once to check it is reachable/working. Stores the result in
// storage (so the options page can display it) and logs it to the console.
const SERVER_STATUS_KEY = "serverStatus";
function pingServer(callback) {
  // Read the configured IP/port fresh so the ping reflects the current
  // settings even if the in-memory URL hasn't been updated yet.
  chrome.storage.local.get({ serverIP: SERVER_IP, serverPort: SERVER_PORT }, (data) => {
    const ip = data.serverIP || SERVER_IP;
    const port = data.serverPort || SERVER_PORT;
    const pingUrl = `http://${ip}:${port}/ping`;
    doPing(pingUrl, callback);
  });
}

function doPing(pingUrl, callback) {
  fetch(pingUrl, { method: "GET" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json().catch(() => ({}));
    })
    .then(data => {
      const status = { ok: true, server_response: data.status || "ok", checkedAt: Date.now() };
      console.log("[EXT] Server ping ok:", status.server_response);
      chrome.storage.local.set({ [SERVER_STATUS_KEY]: status });
      if (callback) callback(status);
    })
    .catch(err => {
      const status = { ok: false, error: String(err), checkedAt: Date.now() };
      console.warn("[EXT] Server ping failed:", err);
      chrome.storage.local.set({ [SERVER_STATUS_KEY]: status });
      if (callback) callback(status);
    });
}

// Load config at startup, then ping the server once to confirm it works.
loadServerConfig();
pingServer();

// Update when user changes settings via options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    if (changes.serverIP) SERVER_IP = changes.serverIP.newValue || SERVER_IP;
    if (changes.serverPort) SERVER_PORT = changes.serverPort.newValue || SERVER_PORT;
    rebuildServerUrls();
    console.log("[EXT] Server URL updated:", SERVER_URL);
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;

  // Only inject into regular web pages. Injecting into extension pages
  // (moz-extension://), about:, view-source:, etc. is blocked by Firefox
  // and logs a "Content Script execution ... has been blocked" error.
  if (!/^https?:\/\//.test(tab.url)) return;

  // Allowed sites get the capture script. Not-allowed sites get nothing here:
  // the gatekeeper is injected on demand when the toolbar button is clicked.
  // Use the same origin match as the click handler.
  const site = new URL(tab.url).origin;
  chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
    if (isSiteAllowed(allowedSites, site)) {
      injectScript(tabId, "content_script.js", () => {});
    }
  });
});

// True if `origin` matches one of the saved allowed sites. Saved entries are
// reduced to their origin first, so "https://example.com/path/" still matches.
function isSiteAllowed(allowedSites, origin) {
  return allowedSites.some(site => {
    try {
      return new URL(site).origin === origin;
    } catch {
      return false;
    }
  });
}

// Inject a script into the tab (scripts guard against double injection themselves).
// Calls done(true) once the script has run, done(false) if it couldn't be injected.
function injectScript(tabId, file, done) {
  chrome.tabs.executeScript(tabId, { file, runAt: "document_idle" }, () => {
    if (chrome.runtime.lastError) {
      console.debug(`[EXT] ${file} injection skipped:`, chrome.runtime.lastError.message);
      done(false);
      return;
    }
    done(true);
  });
}

// POST a payload to the server and pass its instructions back to the content script.
function postToServer(url, payload, sendResponse) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(r => r.json())
    .then(data => {
      sendResponse({ instructions: data.instructions || [], server_response: data.status || "ok" });
    })
    .catch(err => {
      console.error("Upload failed:", err);
      sendResponse({ error: String(err) });
    });
}

// POST one chunk of a DOWNLOAD to /download_result. The chunk arrives as a
// data: url (a message cannot carry binary data) and is posted as raw bytes;
// the reply is passed back whatever its HTTP status, as a 409 says where to resume.
function postDownloadChunk(payload, sendResponse) {
  const { token, offset, final, status, retry, data } = payload;
  const params = new URLSearchParams({ token, offset });
  if (final) {
    params.set("final", "1");
    params.set("status", status);
    if (retry === false) params.set("retry", "0");
  }
  const body = data ? fetch(data).then(r => r.blob()) : Promise.resolve(new Blob());
  body
    .then(blob => fetch(`${SERVER_BASE}/download_result?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob
    }))
    .then(r => r.json())
    .then(reply => sendResponse(reply))
    .catch(err => {
      console.error("Download upload failed:", err);
      sendResponse({ error: String(err) });
    });
}

const CHUNK_ATTEMPTS = 3;

// DOWNLOAD instruction, first try: download url from here, where CORS does not
// apply and the browser's cookies for its host are sent, and post it to the
// server's /download_result in chunks of chunk_bytes. Calls done with the
// server's answer to the last post ({instructions}), with {fallback: status}
// when the file could not be fetched at all, so the content script tries it as
// the page, or with {error} when the server could not be reached.
async function downloadFile({ url, token, chunk_bytes }, done) {
  const base = await Promise.resolve(SERVER_BASE);
  const post = async (params, body) => {
    const query = new URLSearchParams({ token, ...params });
    const r = await fetch(`${base}/download_result?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: body || new Blob()
    });
    return r.json();
  };

  let response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (err) {
    console.warn("[EXT] Background download failed:", err);
    done({ fallback: 0 });
    return;
  }
  if (!response.ok) {
    done({ fallback: response.status });
    return;
  }

  let offset = 0;
  let status = response.status;
  // Post one chunk, retried when it or its reply is lost. A "resend" whose
  // offset already includes the chunk means an earlier try got through.
  const sendChunk = async (pieces) => {
    const chunk = new Blob(pieces);
    for (let attempt = 1; ; attempt++) {
      try {
        const reply = await post({ offset }, chunk);
        if (reply.instructions) return reply.instructions;
        if (reply.status === "resend" && reply.offset !== offset + chunk.size) {
          throw new Error(`server has ${reply.offset} bytes, expected ${offset}`);
        }
        offset += chunk.size;
        return null;
      } catch (err) {
        if (attempt === CHUNK_ATTEMPTS) throw err;
        console.warn(`[EXT] Chunk at ${offset} failed (${err}); retrying`);
      }
    }
  };
  try {
    const reader = response.body.getReader();
    let pieces = [], size = 0;
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (value) {
        pieces.push(value);
        size += value.length;
      }
      if (size >= chunk_bytes || (finished && size > 0)) {
        const instructions = await sendChunk(pieces);
        if (instructions) {
          done({ instructions });
          return;
        }
        pieces = [];
        size = 0;
      }
      if (finished) break;
    }
  } catch (err) {
    // Part of the file may be posted already: report it failed (the server
    // hands it out again) rather than let the page start over on this token.
    console.warn("[EXT] Background download failed midway:", err);
    status = 0;
  }
  try {
    done(await post({ offset, final: "1", status }, null));
  } catch (err) {
    console.error("Download upload failed:", err);
    done({ error: String(err) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "sendSnapshot") {
    postToServer(SERVER_URL, msg.payload, sendResponse);
    // keep channel open for async response
    return true;
  }
  else if (msg.action === "sendFetchResult") {
    // Response to a FETCH instruction: { token, status, body }.
    postToServer(FETCH_RESULT_URL, msg.payload, sendResponse);
    // keep channel open for async response
    return true;
  }
  else if (msg.action === "downloadFile") {
    // DOWNLOAD instruction: { url, token, chunk_bytes }.
    downloadFile(msg.payload, sendResponse);
    // keep channel open for async response
    return true;
  }
  else if (msg.action === "sendDownloadChunk") {
    // One chunk of a DOWNLOAD: { token, offset, final?, status?, data }.
    postDownloadChunk(msg.payload, sendResponse);
    // keep channel open for async response
    return true;
  }
  else if (msg.action === "pingServer") {
    // On-demand connectivity check (e.g. triggered by the options page).
    pingServer((status) => sendResponse(status));
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

  // Make sure the capture script is in the tab (it may be missing if the tab was
  // open before the extension was (re)loaded), then start capturing.
  const capture = () => {
    injectScript(tab.id, "content_script.js", (ok) => {
      if (ok) chrome.tabs.sendMessage(tab.id, { action: "CAPTURE_PAGE" });
    });
  };

  chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
    if (isSiteAllowed(allowedSites, site)) {
      capture();
      return;
    }

    // Not allowed yet → inject the gatekeeper (if not already there) and ask the user.
    injectScript(tab.id, "gatekeeper.js", (ok) => {
      if (!ok) return;

      chrome.tabs.sendMessage(
        tab.id,
        { action: "ASK_ADD_SITE", site },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[EXT] Gatekeeper not reachable:", chrome.runtime.lastError.message);
            return;
          }
          if (!response || !response.accepted) {
            console.log("[EXT] User refused to allow site:", site);
            return;
          }

          // User accepted → add site and capture
          chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
            if (!allowedSites.includes(site)) {
              allowedSites.push(site);
            }
            chrome.storage.local.set({ allowedSites }, capture);
          });
        }
      );
    });
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