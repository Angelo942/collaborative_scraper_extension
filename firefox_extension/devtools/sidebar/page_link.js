const PAGE_SCRIPTS = ["xpath.js", "values.js", "selection.js", "highlights.js", "picker.js", "action.js", "main.js"]
  .map(file => `/devtools/page/${file}`);

// The connection to the page half (devtools/page/), injected into the tab on first use.
export class PageLink {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.port = null;
    this.attempt = 0;
  }

  get connected() {
    return this.port !== null;
  }

  // Resolves to false when the page can't be scripted or another tab was chosen meanwhile.
  async connect(tabId) {
    this.disconnect();
    const attempt = ++this.attempt;
    try {
      await injectOnce(tabId);
    } catch {
      return false;
    }
    if (attempt !== this.attempt) return false;

    const port = browser.tabs.connect(tabId, { name: "devtools" });
    port.onMessage.addListener(this.onMessage);
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
    });
    this.port = port;
    return true;
  }

  disconnect() {
    this.port?.disconnect();
    this.port = null;
  }

  send(type, data = {}) {
    this.port?.postMessage({ type, ...data });
  }
}

async function injectOnce(tabId) {
  const [loaded] = await browser.tabs.executeScript(tabId, { code: "window.collabScraperDevtoolsLoaded === true" });
  if (loaded) return;
  for (const file of PAGE_SCRIPTS) await browser.tabs.executeScript(tabId, { file, runAt: "document_idle" });
}
