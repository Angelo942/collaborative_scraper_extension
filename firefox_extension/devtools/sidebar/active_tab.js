// Calls `onTabChange` with this window's active tab now, whenever another tab
// becomes active, and whenever the active tab finishes loading a page.
export async function followActiveTab(onTabChange) {
  const { id: windowId } = await browser.windows.getCurrent();
  let [current] = await browser.tabs.query({ active: true, windowId });
  onTabChange(current);

  browser.tabs.onActivated.addListener(async (activation) => {
    if (activation.windowId !== windowId) return;
    current = await browser.tabs.get(activation.tabId);
    onTabChange(current);
  });

  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tabId !== current?.id || change.status !== "complete") return;
    current = tab;
    onTabChange(tab);
  });
}
