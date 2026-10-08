import { pythonClassName, siteIdentifier } from "./names.js";

const URL_ATTRIBUTES = ["href", "src"];
const ELEMENT_BASE_URL = "self._base_url";

export function saveFile(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The rows the parser's standalone run writes: one per element, with the metadata
// repeated on each, and a list property as JSON.
export function csvFrom(session) {
  const table = elementTable(session);
  return [table.header, ...table.rows].map(cells => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function elementTable(session) {
  const pageValues = session.pageFields.map(field => session.valuesOf(field)[0] ?? "");
  const pageNames = session.pageFields.map(field => field.name);
  const list = session.elementList;
  if (list) {
    const fields = session.fieldsOf(list);
    const itemNames = fields.map(field => field.name);
    return {
      header: [...itemNames, ...pageNames.map(name => itemNames.includes(name) ? "page_" + name : name)],
      rows: itemRows(session, list).map(row => [...row, ...pageValues]),
    };
  }
  return {
    header: [...pageNames, ...session.lists.map(l => l.name)],
    rows: [[...pageValues, ...session.lists.map(l => JSON.stringify(listObjects(session, l)))]],
  };
}

function itemRows(session, list) {
  const fields = session.fieldsOf(list);
  return Array.from({ length: session.itemCountOf(list) }, (_, row) => fields.map(field => session.valuesOf(field)[row] ?? ""));
}

function listObjects(session, list) {
  const names = session.fieldsOf(list).map(field => field.name);
  return itemRows(session, list).map(row => Object.fromEntries(row.map((value, i) => [names[i], value])));
}

function csvCell(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

let template = null;

// standalone: also runnable without the server, on a saved page (see the template).
export async function pythonParserFrom(session, pageUrl, { standalone }) {
  template ??= await (await fetch("parser.py.template")).text();
  const values = templateValues(session, new URL(pageUrl));
  const sections = { STANDALONE: standalone, PLUGIN: !standalone };
  return template
    .replace(/\{\{#(\w+)\}\}\n([\s\S]*?)\{\{\/\1\}\}\n/g, (_, name, body) => sections[name] ? body : "")
    .replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);
}

// The element's properties and metadata, as the lists decide (see Session).
function templateValues(session, url) {
  const list = session.elementList;
  const properties = list
    ? session.fieldsOf(list).map(fieldProperty)
    : [...session.pageFields.map(fieldProperty), ...session.lists.map(l => listProperty(session, l))];
  const metadata = list ? session.pageFields : [];
  const module = `${siteIdentifier(url.href)}_parser`;
  return {
    HOST: docstringText(url.host),   // with the port, as the server matches it
    URL: docstringText(url.href),
    DATE: new Date().toISOString().slice(0, 10),
    MODULE: module,
    ORIGIN: pythonString(url.origin),
    PAGE_PATH: pythonString(url.pathname),
    ITEMS_XPATH: list
      ? `${pythonString(list.xpath)}  # one node per item of ${list.name}`
      : `"/html"  # the whole page is one item`,
    CLASS: pythonClassName(url.href),
    FIELDS: pythonTuple(properties.map(p => pythonString(p.name))),
    INIT: lines(properties, p => `        self.${p.name}: ${p.type} | None = None`),
    REPR: properties.slice(0, 3).map(p => `${p.name}={self.${p.name}!r}`).join(", "),
    LOAD: lines(properties, p => `        self.${p.name} = ${p.read}`) || "        pass",
    METADATA: lines(metadata, f => `        ${pythonString(f.name)}: ${readCall(f, "page", "base_url")},`) ||
      "        # no page-level fields",
  };
}

function fieldProperty(field) {
  return { name: field.name, type: pythonType(field), read: readCall(field, "node", ELEMENT_BASE_URL) };
}

// A list of dicts, one per item, read from the whole page.
function listProperty(session, list) {
  const entries = lines(session.fieldsOf(list), f => `                ${pythonString(f.name)}: ${readCall(f, "item", ELEMENT_BASE_URL)},`);
  const read = [
    "[",
    "            {",
    ...(entries ? [entries] : []),
    "            }",
    `            for item in node.xpath(${pythonString(list.xpath)})`,
    "        ]",
  ].join("\n");
  return { name: list.name, type: "list[dict]", read };
}

function readsNumber(field) {
  return !field.click && !field.attribute && Boolean(field.number);
}

// A click reads as the CLICK instruction a scraper sends to make the request.
function pythonType(field) {
  if (field.click) return "dict";
  return readsNumber(field) ? "int | float" : "str";
}

// node and baseUrl: the Python names in scope where the call is written.
function readCall(field, node, baseUrl) {
  const xpath = pythonString(field.xpath);
  if (field.click) return `_click(${node}, ${xpath}, ${optionalPythonString(field.waitFor)})`;
  if (readsNumber(field)) return `_number(_text(${node}, ${xpath}))`;
  if (!field.attribute) return `_text(${node}, ${xpath})`;
  const baseUrlArgument = URL_ATTRIBUTES.includes(field.attribute) ? `, ${baseUrl}` : "";
  return `_attr(${node}, ${xpath}, ${pythonString(field.attribute)}${baseUrlArgument})`;
}

function lines(fields, line) {
  return fields.map(line).join("\n");
}

function pythonTuple(items) {
  return items.length === 1 ? `(${items[0]},)` : `(${items.join(", ")})`;
}

// Prefers whichever quote the text doesn't contain.
function pythonString(text) {
  if (!text.includes('"') || text.includes("'")) return JSON.stringify(text);
  return "'" + text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n") + "'";
}

function optionalPythonString(text) {
  return text ? pythonString(text) : "None";
}

function docstringText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}
