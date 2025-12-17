// background.js
const SERVER_URL = "http://127.0.0.1:5000/receive";

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
});
