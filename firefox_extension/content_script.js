// content_script.js

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

// Apply instructions returned by the server immediately
function applyInstructions(instructions) {
  if (!Array.isArray(instructions)) return;

  for (const ins of instructions) {
    try {
      if (ins.type === "insert_html" && ins.selector && ins.html) {
        const el = document.querySelector(ins.selector);
        if (el) el.insertAdjacentHTML(ins.position || "beforeend", ins.html);
      } 
      else if (ins.type === "redirect" && ins.url) {
        try {
          const redirectUrl = new URL(ins.url);
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
                console.log("[EXT] Redirect allowed to", ins.url);
                window.location.href = ins.url;
              } else {
                const msg = `The server wants to redirect you to a page outside the allowed sites:\n\n${ins.url}\n\nThe page will NOT be sent back to the server until you explicitly add "${baseSite}" in the Allowed Sites.\n\nTo update the plugin settings, click "OK" to open the options page, then add the site under Allowed Sites.`;
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
                          console.log("[EXT] Redirect allowed to", ins.url);
                          window.location.href = ins.url;
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
                  console.log("[EXT] Redirect blocked by user:", ins.url);
                }
              }
            });
          });
        } catch (err) {
          console.error("[EXT] Redirect error:", err);
        }
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

// Send snapshot to the background script to POST to local server
// TODO clear token after sending request
function sendSnapshot(snapshot) {
  console.log("[EXT] Sending snapshot with token:", snapshot.token);
  chrome.runtime.sendMessage({ action: "sendSnapshot", payload: snapshot }, (resp) => {
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