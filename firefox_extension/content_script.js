// content_script.js

// Configurable delay to let page load/render (ms)
const LOAD_DELAY_MS = 2000;
// scopus is almost instantaneous, webofscience takes ~6s

let SESSION_TOKEN = null; // token set by server via instructions

// Load the token from storage (if previously set)
chrome.storage.local.get("sessionToken", (data) => {
  SESSION_TOKEN = data.sessionToken || null;
  console.log("[EXT] Loaded session token from storage:", SESSION_TOKEN);
});

// Capture the full page HTML and metadata
function getDomSnapshot() {
  try {
    const html = document.documentElement.outerHTML;
    const urlObj = new URL(location.href);
    const meta = {
      url: location.href,
      domain: urlObj.hostname,
      title: document.title,
      timestamp: new Date().toISOString()
    };

    console.log("[EXT] Using session token:", SESSION_TOKEN);
    return { html, meta, token: SESSION_TOKEN }; // include token
  } catch (err) {
    return { error: String(err), token: SESSION_TOKEN };
  }
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
        console.log("Redirecting to", ins.url);
        window.location.href = ins.url; // navigate immediately
      } 
      else if (ins.type === "set_token" && ins.token) {
        console.log("[EXT] Setting session token:", ins.token);
        SESSION_TOKEN = ins.token;
        chrome.storage.local.set({ sessionToken: SESSION_TOKEN }, () => {
          console.log("[EXT] Session token saved to storage:", SESSION_TOKEN);
        });
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
  const snapshot = getDomSnapshot();
  sendSnapshot(snapshot);
}, LOAD_DELAY_MS);

// 🔁 Poll every few seconds for pending instructions (added section)
setInterval(() => {
  chrome.runtime.sendMessage({ action: "getInstructions" }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp?.instructions) {
      applyInstructions(resp.instructions);
    }
  });
}, 3000 + Math.random() * 2000); // 3–5s random interval
