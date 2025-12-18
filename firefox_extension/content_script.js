// content_script.js

// Configurable delay to let page load/render (ms)
const LOAD_DELAY_MS = 2000;
// scopus is almost instantaneous, webofscience takes ~6s

// Capture the full page HTML and metadata
function getDomSnapshot(callback) {
  chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
    if (!tabId) {
      callback({ error: "Cannot get tabId", token: null });
      return;
    }

    const tokenKey = `sessionToken:${tabId}`;

    chrome.storage.local.get(tokenKey, (tokenData) => {
      const token = tokenData[tokenKey] || null;
      PAGE_TOKEN = token; // update in-memory variable

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

          console.log("[EXT] Using session token:", token);
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

// Apply instructions returned by the server immediately
function applyInstructions(instructions) {
  if (!Array.isArray(instructions)) return;

  for (const ins of instructions) {
    try {
      if (ins.type === "insert_html" && ins.selector && ins.html) {
        const el = document.querySelector(ins.selector);
        if (el) el.insertAdjacentHTML(ins.position || "beforeend", ins.html);
      } 
      else if (ins.type === "set_text" && ins.selector) {
        const el = document.querySelector(ins.selector);
        if (el) el.textContent = ins.text || "";
      } 
      else if (ins.type === "remove" && ins.selector) {
        const el = document.querySelector(ins.selector);
        if (el) el.remove();
      } 
      else if (ins.type === "run_safe_script" && ins.fn_body) {
        const fn = new Function("document", "window", ins.fn_body);
        fn(document, window);
      } 
      else if (ins.type === "redirect" && ins.url) {
        try {
          const redirectUrl = new URL(ins.url);
          const baseSite = redirectUrl.origin; // e.g., https://example.com

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
        } catch (err) {
          console.error("[EXT] Redirect error:", err);
        }
      }
      else if (ins.type === "set_token" && ins.token) {
        console.log("[EXT] Setting per-tab session token:", ins.token);
        PAGE_TOKEN = ins.token;

        chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (tabId) => {
          if (!tabId) return;

          const key = `sessionToken:${tabId}`;

          chrome.storage.local.set({ [key]: PAGE_TOKEN }, () => {
            console.log("[EXT] Session token saved for tab", tabId, PAGE_TOKEN);
          });
        });
      }
      else if (ins.type === "reload") {
        console.log("[EXT] Reload instruction received");

        setTimeout(() => {
          window.location.reload();
        }, 500); // wait 0.5s
      }
      else if (ins.type === "zotero_save") {
        console.log("[EXT] Triggering Zotero save via browser extension");
        // send message to Zotero connector
        window.postMessage({ type: "Zotero-Connector_Browser_Save", data: { url: location.href } }, "*");
      }
    } catch (e) {
      console.error("applyInstruction error:", e);
    }
  }
}

// Send snapshot to the background script to POST to local server
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
