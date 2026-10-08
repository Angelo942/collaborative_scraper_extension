"use strict";

// Answers the sidebar over the port it opens. When the port closes (sidebar
// closed, or it moved to another tab) the page is left as it was.
// In a block because all of the extension's content scripts share one global scope.
{
  const selection = new PageSelection();
  const highlights = new Highlights();
  const picker = new Picker({
    isOwnElement: (element) => highlights.isOwnElement(element),
    onPick: pick,
    onStop: () => sendToSidebar("modeChanged", { mode: "idle" }),
    onRedrawNeeded: redrawSoon,
  });
  let sidebar = null;

  function pick(element, mode) {
    if (mode === "action") {
      recordAction(element);
      return;
    }
    if (mode === "field") {
      sendToSidebar("fieldPicked", { field: selection.fieldFor(element) });
      return;
    }
    const lists = selection.listsAround(element);
    if (lists) sendToSidebar("listPicked", lists);
    else sendToSidebar("notice", { text: "Nothing repeats around this element. Pick another one, or pick it as a single field." });
  }

  // The click goes on to the page; one click is recorded as a field read as "click", then picking stops.
  async function recordAction(element) {
    picker.setMode("idle");
    sendToSidebar("modeChanged", { mode: "idle" });
    sendToSidebar("notice", { text: "Recording what the click changes…" });
    const reportNavigation = () => sendToSidebar("notice", {
      text: "This click loads another page: the server can follow it with GET, no action needed.",
    });
    window.addEventListener("pagehide", reportNavigation, { once: true });

    const target = clickTargetOf(element, selection.itemAround(element)?.item);
    const region = await changedRegionAfterClick((node) => highlights.isOwnElement(node));
    window.removeEventListener("pagehide", reportNavigation);
    const field = selection.clickFieldFor(target, region);
    sendToSidebar("fieldPicked", { field });
    if (!field.waitFor) sendToSidebar("notice", {
      text: "The click changed nothing on the page, or all of it: the server will wait for any change.",
    });
  }

  function redraw() {
    highlights.draw({
      items: selection.items,
      matches: [...selection.matches.values()],
      hovered: picker.hovered,
    });
  }

  let pendingFrame = 0;
  function redrawSoon() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      redraw();
    });
  }

  const sidebarRequests = {
    setMode({ mode }) {
      picker.setMode(mode);
    },
    showSelection(request) {
      selection.apply(request);
      sendToSidebar("evaluated", selection.evaluation());
      redraw();
    },
    requestPageHtml() {
      sendToSidebar("pageHtml", { html: highlights.pageHtmlWithoutHighlights() });
    },
  };

  function sendToSidebar(type, data = {}) {
    sidebar?.postMessage({ type, ...data });
  }

  function connect(port) {
    if (sidebar) sidebar.disconnect();
    else {
      picker.attach();
      highlights.show();
    }
    sidebar = port;
    port.onMessage.addListener((message) => sidebarRequests[message.type]?.(message));
    port.onDisconnect.addListener(() => {
      if (sidebar === port) disconnect();
    });
  }

  function disconnect() {
    sidebar = null;
    picker.detach();
    highlights.hide();
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "devtools") connect(port);
  });
}

window.collabScraperDevtoolsLoaded = true;
