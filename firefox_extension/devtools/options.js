document.addEventListener("DOMContentLoaded", async () => {
  const toggle = document.getElementById("dev-mode");
  toggle.checked = (await browser.storage.local.get({ devMode: false })).devMode;
  toggle.addEventListener("change", () => browser.storage.local.set({ devMode: toggle.checked }));
});
