const MENU_ITEM_ID = "dev-pick-elements";

async function showMenuItemInDevMode() {
  await browser.contextMenus.remove(MENU_ITEM_ID).catch(() => {});
  const { devMode } = await browser.storage.local.get({ devMode: false });
  if (!devMode) return;
  browser.contextMenus.create({
    id: MENU_ITEM_ID,
    title: "Pick elements to parse (dev mode)",
    contexts: ["browser_action", "page", "link", "image", "selection"],
  });
}

showMenuItemInDevMode();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.devMode) showMenuItemInDevMode();
});

// Firefox only opens the sidebar straight from a user action, so nothing may be awaited first.
browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ITEM_ID) browser.sidebarAction.open();
});
