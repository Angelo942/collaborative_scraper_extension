// content_script.js

// Guard against multiple injections into the same document. executeScript can
// run this file more than once (e.g. onUpdated + a toolbar click), and a second
// run of the top-level `let` declarations throws "redeclaration of let".
// Note in the console when the tab hasn't been activated yet: no pages are sent
// until the user clicks the extension toolbar button on this tab.
function warnIfTabInactive() {
  chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
    if (!tabId) return;
    chrome.storage.local.get({ activeTabs: {} }, (data) => {
      if (!data.activeTabs || !data.activeTabs[tabId]) {
        console.log("[EXT] Tab not active yet; no page will be sent until you click the extension button on this tab.");
      }
    });
  });
}

if (window.__collabScraperInjected) {
  console.debug("[EXT] content_script already active, skipping re-init");
  warnIfTabInactive();
} else {
  window.__collabScraperInjected = true;
  console.log("[EXT] content_script initializing on", location.href);
  warnIfTabInactive();

// Configurable delay to let page load/render (ms)
let LOAD_DELAY_MS = 7000;
const tokenKey = `sessionTokens`;
const TAB_STATE_KEY = 'activeTabs';

// Capture the full page HTML and metadata
function getDomSnapshot(callback) {
  removeServerBanner()
  chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
    if (!tabId) {
      callback({ error: "Cannot get tabId", token: null });
      return;
    }

    chrome.storage.local.get({ [tokenKey]: {}}, (data) => {
      const tokens = data[tokenKey] || {};
      const token = tokens[tabId] || null;
      PAGE_TOKEN = token;

      chrome.storage.local.get({ allowRedirect: false }, (settings) => {
        const allow_redirect = Boolean(settings.allowRedirect);

        try {
          const html = document.documentElement.outerHTML;
          const urlObj = new URL(location.href);

          const meta = {
            url: location.href,
            domain: urlObj.hostname,
            title: document.title,
            timestamp: new Date().toISOString()
          };

          console.log("[EXT] Using request token:", token);
          console.log("[EXT] allow_redirect:", allow_redirect);

          callback({
            html,
            meta,
            token,
            allow_redirect
          });
        } catch (err) {
          callback({
            error: String(err),
            token,
            allow_redirect
          });
        }
      });
    });
  });
}

// Submitting a page with banner breaks the parser
function removeServerBanner() {
  const el = document.getElementById("server-banner");
  if (el) el.remove();
}

// Standardized banner rendered from a { type: "banner", message, level }
// instruction. The client owns the styling so the server only sends a message
// and a level ("info" | "error"). Reuses the "server-banner" id so it is
// cleaned up by removeServerBanner() before the next snapshot is sent (a banner
// left in the DOM would otherwise break the parser).
function showServerBanner(message, level = "info") {
  removeServerBanner();
  if (!document.body || !message) return;

  const palette = {
    info:  { bg: "#fffae6", border: "#e6db9a", color: "#5c4b00" },
    error: { bg: "#ffe6e6", border: "#e6a0a0", color: "#7a1f1f" }
  };
  const c = palette[level] || palette.info;

  const banner = document.createElement("div");
  banner.id = "server-banner";
  banner.textContent = message;
  banner.style.cssText =
    `position:fixed;left:0;right:0;top:0;background:${c.bg};color:${c.color};` +
    `padding:8px;border-bottom:1px solid ${c.border};z-index:99999;` +
    "font-family:sans-serif;font-size:14px;text-align:center;";
  document.body.insertAdjacentElement("afterbegin", banner);
}

// Apply instructions returned by the server immediately
function applyInstructions(instructions) {
  if (!Array.isArray(instructions)) return;

  for (const ins of instructions) {
    try {
      if (ins.type === "banner" && ins.message) {
        // Standardized banner command: the server sends a message (+ optional
        // level), the client renders it. Preferred over raw insert_html.
        showServerBanner(ins.message, ins.level);
      }
      else if (ins.type === "insert_html" && ins.selector && ins.html) {
        const el = document.querySelector(ins.selector);
        if (el) el.insertAdjacentHTML(ins.position || "beforeend", ins.html);
      }
      else if (ins.type === "GET" && ins.url) {
        navigateIfAllowed(ins.url);
      }
      else if (ins.type === "FETCH" && ins.url) {
        // PAGE_TOKEN was just set by the set_token preceding this instruction.
        fetchFromPage(ins, PAGE_TOKEN);
      }
      else if (ins.type === "CLICK" && ins.xpath) {
        clickThenSendPage(ins, PAGE_TOKEN);
      }
      else if (ins.type === "DOWNLOAD" && ins.url) {
        downloadInChunks(ins, PAGE_TOKEN);
      }
      else if (ins.type === "set_token" && ins.token) {
        console.log("[EXT] Setting per-tab session token:", ins.token);
        PAGE_TOKEN = ins.token;

        // Get current tab ID via runtime message
        chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
          if (!tabId) return;

          // Get existing tokens object
          chrome.storage.local.get({ [tokenKey]: {} }, (data) => {
            const tokens = data[tokenKey] || {};
            tokens[tabId] = PAGE_TOKEN; // set/update token for this tab

            // Save updated object back to storage
            chrome.storage.local.set({ [tokenKey]: tokens }, () => {
              console.log("[EXT] Session token saved for tab", tabId, PAGE_TOKEN);
            });
          });
        });
      }
      else if (ins.type === "reload") {
        console.log("[EXT] Reload instruction received.");
      
        chrome.storage.local.get({ allowRedirect: false }, (settings) => {
          const allow_redirect = Boolean(settings.allowRedirect);

          if (allow_redirect) {
            LOAD_DELAY_MS += 1000;
            setTimeout(() => {
              window.location.reload();
            }, 500); // wait 0.5s
          } else {
            console.log("[EXT] Redirect blocked so won't reload page.");
          }
        });
      }
    } catch (e) {
      console.error("applyInstruction error:", e);
    }
  }
}

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

// GET instruction: navigate the tab to url, if the user allows redirects and the
// site is allowed. Otherwise offer to open the options page to add the site.
function navigateIfAllowed(url) {
  try {
    const redirectUrl = new URL(url);
    const baseSite = redirectUrl.origin; // e.g., https://example.com
    chrome.storage.local.get({ allowRedirect: false }, (settings) => {
      const allow_redirect = Boolean(settings.allowRedirect);

      if (!allow_redirect) {
        console.log("[EXT] User didn't allow redirect!");
        return;
      } else {
        console.log("[EXT] Redirect was allowed!");
      }

      chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
        const isAllowed = isSiteAllowed(allowedSites, baseSite);

        if (isAllowed) {
          console.log("[EXT] Redirect allowed to", url);
          window.location.href = url;
        } else {
          const msg = `The server wants to redirect you to a page outside the allowed sites:\n\n${url}\n\nThe page will NOT be sent back to the server until you explicitly add "${baseSite}" in the Allowed Sites.\n\nTo update the plugin settings, click "OK" to open the options page, then add the site under Allowed Sites.`;
          const follow = confirm(msg);
          if (follow) {
            // Open options page so user can add the site
            chrome.runtime.sendMessage({ action: "openOptions" });
            // Wait and then re-check the allowed sites
            setTimeout(() => {
              const followMsg = `Once you have added "${baseSite}" to the Allowed Sites, click OK to follow the redirect.`;
              const followNow = confirm(followMsg);

              if (followNow) {
                // Re-check allowed sites before redirecting
                chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
                  const isNowAllowed = isSiteAllowed(allowedSites, baseSite);
                  if (isNowAllowed) {
                    console.log("[EXT] Redirect allowed to", url);
                    window.location.href = url;
                  } else {
                    console.log("[EXT] Redirect blocked: site not in allowed list after user update:", baseSite);
                    alert(`"${baseSite}" was not found in the allowed sites.`);
                  }
                });
              } else {
                console.log("[EXT] Redirect cancelled by user after updating settings.");
              }
            }, 500); // small delay to let options page open. Somehow without the program crashes.
          } else {
            console.log("[EXT] Redirect blocked by user:", url);
          }
        }
      });
    });
  } catch (err) {
    console.error("[EXT] Redirect error:", err);
  }
}

// FETCH instruction: call an API from the current page without navigating, then
// report the response to the server's /fetch_result, which answers with the
// next instructions. A blocked or failed fetch is still reported (status 0) so
// the server moves on; an unreported one would leave this tab waiting forever.
function fetchFromPage(ins, token) {
  const report = (status, body) => {
    console.log("[EXT] Reporting fetch result with token:", token, "status:", status);
    relayToServer("sendFetchResult", { token, status, body });
  };

  let target;
  try {
    target = new URL(ins.url, location.href);
  } catch (err) {
    report(0, `Invalid fetch url: ${ins.url}`);
    return;
  }

  chrome.storage.local.get({ allowRedirect: false, allowedSites: [] }, ({ allowRedirect, allowedSites }) => {
    if (!allowRedirect) {
      // Interactive mode was turned off: stop here, like a blocked GET. Reporting
      // would only make the server hand out the next request.
      console.log("[EXT] User didn't allow redirect, so won't fetch", target.href);
      return;
    }
    // The request carries the page's cookies, so it may only go to the page's
    // own origin, and only if that site is allowed.
    if (target.origin !== location.origin || !isSiteAllowed(allowedSites, target.origin)) {
      console.log("[EXT] Fetch blocked: not the page's origin or not an allowed site:", target.href);
      report(0, `Fetch blocked: ${target.origin} is not the current page's origin or not an allowed site`);
      return;
    }

    // A FETCH is always a POST of a JSON body; the headers are ours to set.
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(ins.body != null ? ins.body : {}),
    };

    // In Firefox a content script's fetch() runs as the extension; content.fetch
    // makes the request as the page, with its origin and cookies.
    const pageFetch = (typeof content !== "undefined" && content.fetch)
      ? (url, opts) => content.fetch(url, opts)
      : (url, opts) => fetch(url, opts);

    console.log("[EXT] Fetching", init.method, target.href);
    pageFetch(target.href, init)
      .then(r => r.text().then(body => report(r.status, body)))
      .catch(err => {
        console.warn("[EXT] Fetch failed:", err);
        report(0, String(err));
      });
  });
}

// In Firefox a content script's fetch() runs as the extension; content.fetch
// makes the request as the page, with its origin and cookies.
const PAGE_FETCH = (typeof content !== "undefined" && content.fetch)
  ? (url, opts) => content.fetch(url, opts)
  : (url, opts) => fetch(url, opts);

// Sites the user refused downloads from on this page: asked once, not per file.
const REFUSED_DOWNLOAD_SITES = new Set();

// Ask whether to allow downloads from origin. On yes it is added to the Allowed
// Sites, as from the options page, so it is not asked again.
function askToAllowSite(origin, url) {
  if (REFUSED_DOWNLOAD_SITES.has(origin)) return Promise.resolve(false);
  const allow = confirm(`The server wants to download a file from a site that is not in your Allowed Sites:\n\n${url}\n\nAllow "${origin}"? It will be added to the Allowed Sites.`);
  if (!allow) {
    REFUSED_DOWNLOAD_SITES.add(origin);
    return Promise.resolve(false);
  }
  return new Promise(resolve => chrome.storage.local.get({ allowedSites: [] }, ({ allowedSites }) => {
    chrome.storage.local.set({ allowedSites: [...allowedSites, origin] }, () => {
      console.log("[EXT] Added to the Allowed Sites:", origin);
      resolve(true);
    });
  }));
}

const CHUNK_ATTEMPTS = 3;

// DOWNLOAD instruction: download a file without navigating and post it to the
// server's /download_result in chunks of ins.chunk_bytes, one at a time, so the
// whole file is never held in memory. The background script tries first: CORS
// does not apply there, so it can fetch a file on another origin, with the
// browser's cookies for that host. If it cannot fetch the file at all, the page
// tries (with its own cookies, readable only if the file's server allows it).
// The last post (final) carries the file's HTTP status and is answered with the
// next instructions. A blocked or failed download is still reported so the
// server moves on; one refused here (the user did not allow its site) is
// reported with retry=false, since trying again cannot help.
async function downloadInChunks(ins, token) {
  // One post through the background script, which can reach the server. A
  // message cannot carry binary data, so the chunk travels as a data: url.
  const post = (params, chunk) => new Promise((resolve, reject) => {
    const send = (data) => chrome.runtime.sendMessage(
      { action: "sendDownloadChunk", payload: { token, ...params, data } },
      (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!resp || resp.error) reject(new Error(resp ? resp.error : "no response"));
        else resolve(resp);
      });
    if (!chunk) {
      send(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => send(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(chunk);
  });
  const report = async (offset, status, retry = true) => {
    try {
      const resp = await post({ offset, final: true, status, retry }, null);
      applyInstructions(resp.instructions || []);
    } catch (err) {
      console.error("[EXT] Could not report the download:", err);
    }
  };

  const { allowRedirect, allowedSites } = await new Promise(resolve =>
    chrome.storage.local.get({ allowRedirect: false, allowedSites: [] }, resolve));
  if (!allowRedirect) {
    // Interactive mode was turned off: stop here, like a blocked GET.
    console.log("[EXT] User didn't allow redirect, so won't download", ins.url);
    return;
  }

  let target;
  try {
    target = new URL(ins.url, location.href);
  } catch (err) {
    console.warn("[EXT] Invalid download url:", ins.url);
    await report(0, 0, false);
    return;
  }
  // The server picks the url and the request may carry the volunteer's
  // cookies, so the file's site must be allowed, like a GET's: ask the first time.
  if (!isSiteAllowed(allowedSites, target.origin) && !(await askToAllowSite(target.origin, target.href))) {
    console.warn(`[EXT] Download blocked: ${target.origin} is not in the Allowed Sites`, target.href);
    await report(0, 0, false);
    return;
  }

  // First try: the background script downloads and posts the file itself.
  console.log("[EXT] Downloading", target.href);
  const first = await new Promise(resolve => chrome.runtime.sendMessage(
    { action: "downloadFile", payload: { url: target.href, token, chunk_bytes: ins.chunk_bytes } },
    (resp) => resolve(chrome.runtime.lastError || !resp ? { fallback: 0 } : resp)));
  if (first.instructions) {
    applyInstructions(first.instructions);
    return;
  }
  if (first.error) {
    console.error("[EXT] Could not report the download:", first.error);
    return;
  }
  console.log(`[EXT] Background download failed (status ${first.fallback}); trying as the page`);

  let offset = 0;
  // Post one chunk, retried when it or its reply is lost. A "resend" whose
  // offset already includes the chunk means an earlier try got through.
  const sendChunk = async (pieces) => {
    const chunk = new Blob(pieces);
    for (let attempt = 1; ; attempt++) {
      try {
        const resp = await post({ offset }, chunk);
        if (resp.instructions) return resp.instructions;
        if (resp.status === "resend" && resp.offset !== offset + chunk.size) {
          throw new Error(`server has ${resp.offset} bytes, expected ${offset}`);
        }
        offset += chunk.size;
        return null;
      } catch (err) {
        if (attempt === CHUNK_ATTEMPTS) throw err;
        console.warn(`[EXT] Chunk at ${offset} failed (${err}); retrying`);
      }
    }
  };

  // Second try: as the page, with its cookies even on another origin.
  let status = 0;
  try {
    const response = await PAGE_FETCH(target.href, { credentials: "include" });
    status = response.status;
    if (response.ok) {
      const reader = response.body.getReader();
      let pieces = [], size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          pieces.push(value);
          size += value.length;
        }
        if (size >= ins.chunk_bytes || (done && size > 0)) {
          const instructions = await sendChunk(pieces);
          if (instructions) {
            applyInstructions(instructions);
            return;
          }
          pieces = [];
          size = 0;
        }
        if (done) break;
      }
    }
  } catch (err) {
    console.warn("[EXT] Download failed:", err);
    status = 0;
  }
  await report(offset, status || first.fallback);
}

const CLICK_TIMEOUT_MS = 10000;
const CLICK_SETTLED_AFTER_MS = 700;

// CLICK instruction: click an element of the page (e.g. a card that opens a
// detail panel), wait for the wait_for element to change, then send the page
// with meta.click. The page is sent even when the click failed, with the error
// in meta.click, so the server moves on; an unsent page would leave this tab
// waiting forever.
function clickThenSendPage(ins, token) {
  chrome.storage.local.get({ allowRedirect: false }, ({ allowRedirect }) => {
    if (!allowRedirect) {
      console.log("[EXT] User didn't allow redirect, so won't click", ins.xpath);
      return;
    }
    const send = (error) => sendPageAfterClick(ins, token, error);

    let target, region;
    try {
      target = firstNodeAt(ins.xpath);
      region = ins.wait_for ? firstNodeAt(ins.wait_for) : null;
    } catch (err) {
      send(`Invalid XPath: ${err}`);
      return;
    }
    if (!target) {
      send(`Element to click not found: ${ins.xpath}`);
      return;
    }

    console.log("[EXT] Clicking", ins.xpath);
    changeAfterClick(ins.wait_for, region).then(send);
    clickOn(target);
  });
}

function firstNodeAt(xpath) {
  return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// SVG elements have no click().
function clickOn(target) {
  if (typeof target.click === "function") target.click();
  else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

// Resolves to "" once the page has been quiet for a moment after a change in
// the wait_for element (or anywhere, without one), or to an error message when
// nothing changed in time. The wait_for element may also be added by the click.
function changeAfterClick(waitFor, regionBefore) {
  return new Promise((resolve) => {
    let timer = setTimeout(() => finish("Nothing changed after the click"), CLICK_TIMEOUT_MS);

    const observer = new MutationObserver((records) => {
      const region = waitFor ? (regionBefore?.isConnected ? regionBefore : firstNodeAt(waitFor)) : null;
      if (!records.some(record => changesRegion(record, region))) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish(""), CLICK_SETTLED_AFTER_MS);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    function finish(error) {
      observer.disconnect();
      resolve(error);
    }
  });
}

function changesRegion(record, region) {
  if (!region) return !isInServerBanner(record.target);
  return region.contains(record.target) ||
    Array.from(record.addedNodes).some(node => node.contains(region));
}

function isInServerBanner(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(element?.closest("#server-banner"));
}

function sendPageAfterClick(ins, token, error) {
  if (error) console.warn("[EXT] Click failed:", error);
  getDomSnapshot((snapshot) => {
    snapshot.token = token;
    if (snapshot.meta) snapshot.meta.click = { xpath: ins.xpath, ok: !error, error: error || null };
    sendSnapshot(snapshot);
  });
}

// Relay a payload to the server through the background script and apply the
// instructions it answers with.
function relayToServer(action, payload) {
  chrome.runtime.sendMessage({ action, payload }, (resp) => {
    if (chrome.runtime.lastError) {
      console.warn("Message failed:", chrome.runtime.lastError);
      return;
    }
    if (!resp) return;
    if (resp.instructions) {
      applyInstructions(resp.instructions);
    }
  });
}

// Send snapshot to the background script to POST to local server
// TODO clear token after sending request
function sendSnapshot(snapshot) {
  console.log("[EXT] Sending snapshot with token:", snapshot.token);
  relayToServer("sendSnapshot", snapshot);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "CAPTURE_PAGE") {
    setTabActive();
    getDomSnapshot((snapshot) => {
      if (!snapshot) return;
      sendSnapshot(snapshot);
    });
  }
});

// Helper: mark this tab as active
function setTabActive() {
  chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
    if (!tabId) return;

    chrome.storage.local.get({ [TAB_STATE_KEY]: {} }, (data) => {
      const activeTabs = data[TAB_STATE_KEY] || {};
      activeTabs[tabId] = true;
      chrome.storage.local.set({ [TAB_STATE_KEY]: activeTabs });
    });
  });
}

// Send pages only if tab is active
chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
  if (!tabId) return;

  chrome.storage.local.get({ [TAB_STATE_KEY]: {} }, (data) => {
    const activeTabs = data[TAB_STATE_KEY] || {};
    if (Boolean(activeTabs[tabId])) {
      // Wait for initial page load delay, then capture and send
      setTimeout(() => {
        getDomSnapshot((snapshot) => {
          if (!snapshot) {
            console.error("Failed to get snapshot");
            return;
          }
          sendSnapshot(snapshot);
        });
      }, LOAD_DELAY_MS);
    }
  });
});

} // end injection guard