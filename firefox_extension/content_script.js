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
        const isAllowed = allowedSites.some(site => baseSite === site);

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
                  const isNowAllowed = allowedSites.includes(baseSite);
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
    if (target.origin !== location.origin || !allowedSites.includes(target.origin)) {
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