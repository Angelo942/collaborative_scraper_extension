// Only inject the code to ask user if they want to allow site when they try to send the page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "ASK_ADD_SITE" && msg.site) {
    const ok = confirm(
      `This site is not yet allowed:\n\n${msg.site}\n\n` +
      `Do you want to allow it and send the page to the server?`
    );

    sendResponse({ accepted: ok });
    return true;
  }
});