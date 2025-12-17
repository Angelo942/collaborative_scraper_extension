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
  else if (msg.type === "GET_TAB_ID") {
    sendResponse(sender.tab?.id);
  }
});