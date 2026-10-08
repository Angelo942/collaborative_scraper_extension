import { followActiveTab } from "./active_tab.js";
import { csvFrom, pythonParserFrom, saveFile } from "./exports.js";
import { siteIdentifier } from "./names.js";
import { PageLink } from "./page_link.js";
import { Session } from "./session.js";
import { render } from "./view.js";

const page = new PageLink((message) => pageMessages[message.type]?.(message));

const ui = {
  tab: null,
  session: new Session(),
  mode: "list",     // "idle" | "list" | "field"
  status: "",
};

function siteOf(tab) {
  return tab && /^https?:\/\//.test(tab.url || "") ? new URL(tab.url).host : null;
}

function refresh() {
  render({ ...ui, site: siteOf(ui.tab) }, actions);
}

function setStatus(text) {
  ui.status = text;
  refresh();
}

function sendSelection({ rebase }) {
  page.send("showSelection", { ...ui.session.selectionForPage(), rebase });
}

// Another page of the same site keeps the selection, to show straight away whether it still matches.
async function follow(tab) {
  const previousSite = siteOf(ui.tab);
  ui.tab = tab;
  page.disconnect();
  const site = siteOf(tab);
  if (site && site !== previousSite) await switchToSessionOf(site);
  if (ui.tab !== tab) return;
  refresh();
  if (site && await page.connect(tab.id)) {
    page.send("setMode", { mode: ui.mode });
    sendSelection({ rebase: false });
  }
}

async function switchToSessionOf(site) {
  const saved = await Session.load(site);
  ui.session = saved || new Session();
  ui.mode = saved ? "idle" : "list";
  ui.status = saved ? "Restored the selection saved for this site." : "";
}

const pageMessages = {
  evaluated(evaluation) {
    ui.session.applyEvaluation(evaluation);
    ui.session.save(siteOf(ui.tab));
    refresh();
  },
  listPicked({ candidates, index, name }) {
    if (ui.session.hasList(candidates[index])) {
      setStatus("This list is already picked.");
      return;
    }
    ui.session.addList(candidates, index, name);
    ui.status = "";
    setMode("field");
    sendSelection({ rebase: true });
  },
  fieldPicked({ field }) {
    ui.session.addPickedField(field);
    ui.status = "";
    sendSelection({ rebase: false });
  },
  modeChanged({ mode }) {
    ui.mode = mode;
    refresh();
  },
  notice({ text }) {
    setStatus(text);
  },
  pageHtml({ html }) {
    exportFile("page.html", html, "text/html");
  },
};

function setMode(mode) {
  ui.mode = mode;
  page.send("setMode", { mode });
  refresh();
}

function toggleMode(mode) {
  setMode(ui.mode === mode ? "idle" : mode);
}

function changeList(change) {
  change(ui.session);
  ui.status = "";
  sendSelection({ rebase: true });
}

function changeFields(change) {
  change(ui.session);
  sendSelection({ rebase: false });
}

// What the page doesn't read: saved and shown without evaluating again.
function changeUnevaluated(change) {
  change(ui.session);
  ui.session.save(siteOf(ui.tab));
  refresh();
}

function exportFile(suffix, content, mimeType) {
  const filename = `${siteIdentifier(ui.tab.url)}_${suffix}`;
  saveFile(filename, content, mimeType);
  setStatus(`Saved ${filename}`);
}

const actions = {
  growList: (list) => changeList(session => session.growList(list)),
  shrinkList: (list) => changeList(session => session.shrinkList(list)),
  removeList: (list) => changeList(session => session.removeList(list)),
  setListXPath: (list, xpath) => changeList(session => session.setListXPath(list, xpath)),
  setOneListGivesElements: (givesElements) => changeUnevaluated(session => session.setOneListGivesElements(givesElements)),
  renameList: (list, name) => changeUnevaluated(session => session.renameList(list, name)),
  refresh: () => sendSelection({ rebase: false }),
  removeField: (field) => changeFields(session => session.removeField(field)),
  setFieldXPath: (field, xpath) => changeFields(session => session.setFieldXPath(field, xpath)),
  setFieldReading: (field, reading) => changeFields(session => session.setFieldReading(field, reading)),
  setFieldWaitFor: (field, xpath) => changeUnevaluated(session => session.setFieldWaitFor(field, xpath)),
  moveField: (field, to) => changeFields(session => session.moveField(field, to)),
  renameField: (field, name) => changeUnevaluated(session => session.renameField(field, name)),
};

const buttons = {
  "pick-list": () => toggleMode("list"),
  "pick-fields": () => toggleMode("field"),
  "pick-action": () => toggleMode("action"),
  "export-python": async () => exportFile("parser.py", await pythonParserFrom(ui.session, ui.tab.url, { standalone: true }), "text/x-python"),
  "export-csv": () => exportFile("items.csv", csvFrom(ui.session), "text/csv"),
  "export-html": () => page.send("requestPageHtml"),
  "copy-python": async () => {
    try {
      await navigator.clipboard.writeText(await pythonParserFrom(ui.session, ui.tab.url, { standalone: false }));
      setStatus("Python script copied to the clipboard");
    } catch (error) {
      setStatus(`Copy failed: ${error}`);
    }
  },
};

document.querySelector("#one-list-as select").addEventListener("change", (e) => actions.setOneListGivesElements(e.target.value === "items"));
for (const [id, handler] of Object.entries(buttons)) document.getElementById(id).addEventListener("click", handler);
refresh();
followActiveTab(follow);
