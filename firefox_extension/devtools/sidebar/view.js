const PREVIEW_ROWS = 5;

const HINTS = {
  idle: "Pick lists, then the values inside them. Values outside every list are read once per page.",
  list: "Click one item of a list to scrape: a result, a row, a card. Each pick adds a list. Esc to stop.",
  field: "Click the values to extract. Inside a list's item they are read in each item, elsewhere once per page. Esc to stop.",
  action: "Click what loads an item's details, e.g. a card that opens a panel. The click reaches the page; what it changes is recorded in a field read as “click”. Esc to stop.",
};

const SHAPES = {
  page: "The parser gives one element per page.",
  items: "The parser gives one element per item of the list; the page fields go in its metadata.",
  properties: "The parser gives one element per page; each list is one of its properties, a list of objects.",
};

const $ = (id) => document.getElementById(id);

function shapeOf(session) {
  if (!session.lists.length) return "page";
  return session.elementList ? "items" : "properties";
}

// `actions` are the sidebar's handlers (see main.js); the view only calls them.
export function render({ site, session, mode, status }, actions) {
  $("main").hidden = !site;
  $("unavailable").hidden = Boolean(site);
  $("site").textContent = site || "";

  $("pick-list").classList.toggle("on", mode === "list");
  $("pick-fields").classList.toggle("on", mode === "field");
  $("pick-action").classList.toggle("on", mode === "action");
  $("hint").textContent = HINTS[mode];

  $("shape").textContent = SHAPES[shapeOf(session)];
  $("one-list-as").hidden = session.lists.length !== 1;
  document.querySelector("#one-list-as select").value = session.oneListGivesElements ? "items" : "properties";
  $("selection").replaceChildren(...selectionTree(session, actions));
  $("preview").replaceChildren(...previewTables(session));

  for (const id of ["export-python", "copy-python", "export-csv"]) $(id).disabled = !session.fields.length;

  $("status").classList.toggle("message", Boolean(status));
  $("status").textContent = status || summary(session);
}

function selectionTree(session, actions) {
  const shape = shapeOf(session);
  if (shape === "page") return [pageGroup(session, actions, { title: "Element", note: "one per page" })];
  if (shape === "items") return [
    listGroup(session, session.elementList, actions, { asProperty: false }),
    pageGroup(session, actions, { title: "Metadata", note: "read once per page" }),
  ];
  return [pageGroup(session, actions, {
    title: "Element",
    note: "one per page",
    children: session.lists.map(list => listGroup(session, list, actions, { asProperty: true })),
  })];
}

function pageGroup(session, actions, { title, note, children = [] }) {
  return element("div", { className: "group" },
    element("div", { className: "row" },
      element("span", { className: "group-title" }, title),
      element("span", { className: "note" }, note)),
    groupFields(session, session.pageFields, actions, "No page fields."),
    children.length ? element("div", { className: "group-children" }, children) : []);
}

// As the only list it gives the elements; next to others it is a property of the page's element, by its name.
function listGroup(session, list, actions, { asProperty }) {
  return element("div", { className: "group list" },
    element("div", { className: "row" },
      asProperty ? [] : element("span", { className: "group-title" }, "Elements:"),
      element("input", {
        className: "list-name",
        value: list.name,
        title: asProperty ? "Name of the property holding this list" : "Name of the list",
        onchange: (e) => actions.renameList(list, e.target.value),
      }),
      button("×", () => actions.removeList(list), { className: "icon", title: "Remove the list (its fields are read once per page)" })),
    element("div", { className: "row" },
      itemCountBadge(session, list),
      button("Bigger", () => actions.growList(list), { disabled: !list.canGrow, title: "Use the next repeated ancestor" }),
      button("Smaller", () => actions.shrinkList(list), { disabled: !list.canShrink, title: "Use the previous repeated element" }),
      button("Refresh", actions.refresh, { title: "Evaluate again, for content loaded since" })),
    element("input", {
      className: "xpath",
      value: list.xpath,
      title: "XPath of the list items (editable)",
      onchange: (e) => actions.setListXPath(list, e.target.value.trim()),
    }),
    groupFields(session, session.fieldsOf(list), actions, "No fields in this list yet: pick values inside one of its items."));
}

function itemCountBadge(session, list) {
  const count = session.itemCountOf(list);
  const [text, title] = !session.isListValid(list) ? ["invalid XPath", "The list XPath is not valid."]
    : count ? [`${count} items`, ""]
    : ["0 items", "The list isn't on this page: its fields read nothing here."];
  return element("span", { className: count ? "badge" : "badge warn", title }, text);
}

function groupFields(session, fields, actions, emptyText) {
  return element("div", { className: "group-fields" },
    fields.length ? fields.map(field => fieldCard(session, field, actions)) : element("p", { className: "hint" }, emptyText));
}

function fieldCard(session, field, actions) {
  const card = $("field-template").content.firstElementChild.cloneNode(true);
  const part = (name) => card.querySelector(`.${name}`);
  const inList = Boolean(session.listById(field.list));
  const values = session.valuesOf(field);
  const rowCount = session.rowCountOf(field);
  const found = values.filter(value => value !== "").length;
  const sample = values.find(value => value !== "") || "(no value)";

  part("name").value = field.name;
  part("name").addEventListener("change", (e) => actions.renameField(field, e.target.value));

  part("reading").append(...readingOptions(field, session.evaluation));
  part("reading").value = readingOf(field);
  part("reading").addEventListener("change", (e) => actions.setFieldReading(field, e.target.value));

  part("scope").hidden = !session.lists.length;
  part("scope").textContent = inList ? "→ page" : "→ list";
  part("scope").classList.toggle("page", !inList);
  part("scope").title = inList
    ? "Read once per page instead"
    : "Read in each item of the list around it instead";
  part("scope").addEventListener("click", () => actions.moveField(field, inList ? "page" : "list"));
  part("coverage").textContent = `${found}/${rowCount}`;
  part("coverage").classList.toggle("warn", found !== rowCount || !rowCount);
  part("remove").addEventListener("click", () => actions.removeField(field));

  part("xpath").value = field.xpath;
  part("xpath").title = inList
    ? "XPath from the list item (editable; an absolute XPath is made relative to its item)"
    : "XPath from the page (editable)";
  part("xpath").addEventListener("change", (e) => actions.setFieldXPath(field, e.target.value.trim()));

  const waitFor = card.querySelector(".wait-for input");
  part("wait-for").hidden = !field.click;
  waitFor.value = field.waitFor || "";
  waitFor.addEventListener("change", (e) => actions.setFieldWaitFor(field, e.target.value.trim()));

  part("sample").textContent = sample;
  part("sample").title = sample;
  return card;
}

function readingOf(field) {
  if (field.click) return "click";
  if (field.attribute) return "@" + field.attribute;
  return field.number ? "number" : "text";
}

// "number" only when the text holds one.
function readingOptions(field, { attributes, numeric }) {
  const available = attributes[field.id] || [];
  const names = field.attribute && !available.includes(field.attribute) ? [field.attribute, ...available] : available;
  return [
    element("option", { value: "text" }, "text"),
    (numeric[field.id] || field.number) && element("option", { value: "number" }, "number"),
    element("option", { value: "click", title: "The request that clicks it: a CLICK instruction" }, "click"),
    ...names.map(name => element("option", { value: "@" + name }, `@${name}`)),
  ].filter(Boolean);
}

// One table per group, so the page fields show even where a list is missing.
function previewTables(session) {
  const shape = shapeOf(session);
  const nestedLists = shape === "properties" ? session.lists : [];
  const tables = [];
  if (session.pageFields.length || nestedLists.length) {
    const columns = [
      ...session.pageFields.map(field => [field.name, session.valuesOf(field)[0] ?? ""]),
      ...nestedLists.map(list => [list.name, `[${session.itemCountOf(list)} items]`]),
    ];
    tables.push(table(shape === "items" ? "Metadata" : "Element", columns.map(([name]) => name), [columns.map(([, value]) => value)]));
  }
  for (const list of session.lists) {
    const fields = session.fieldsOf(list);
    if (!fields.length) continue;
    const title = `${shape === "items" ? "Elements: " : ""}${list.name} (${session.itemCountOf(list)} items)`;
    const rows = Array.from({ length: Math.min(session.itemCountOf(list), PREVIEW_ROWS) },
      (_, row) => fields.map(field => session.valuesOf(field)[row] ?? ""));
    tables.push(table(title, fields.map(field => field.name), rows));
  }
  return tables;
}

function table(title, header, rows) {
  return element("div", { className: "preview-table" },
    element("div", { className: "preview-title" }, title),
    element("table", {},
      element("tr", {}, header.map(name => element("th", {}, name))),
      rows.map(row => element("tr", {}, row.map(value => element("td", { title: value }, value))))));
}

function summary(session) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(session.lists.length, "list")} · ${plural(session.fields.length, "field")} · saved for this site`;
}

function button(label, onclick, props = {}) {
  return element("button", { type: "button", onclick, ...props }, label);
}

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "className" || key === "value") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat());
  return node;
}
