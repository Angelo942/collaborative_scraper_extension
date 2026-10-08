import { uniqueName } from "./names.js";

const SESSIONS_KEY = "devSessions";

const EMPTY_EVALUATION = { lists: {}, values: {}, attributes: {}, numeric: {} };

function newId() {
  return Math.random().toString(36).slice(2);
}

// One list of the page: the XPath of its items, and the repeated ancestors
// around the picked element it can grow or shrink to.
class List {
  constructor({ id = newId(), name, xpath, candidates = [xpath], candidateIndex = 0 }) {
    this.id = id;
    this.name = name;
    this.candidates = candidates;
    this.candidateIndex = candidateIndex;
    this.xpath = candidates[candidateIndex];
  }

  get canGrow() {
    return this.candidateIndex < this.candidates.length - 1;
  }

  get canShrink() {
    return this.candidateIndex > 0;
  }

  choose(index) {
    this.candidateIndex = index;
    this.xpath = this.candidates[index];
  }

  setXPath(xpath) {
    this.candidates = [xpath];
    this.choose(0);
  }

  toJSON() {
    return { id: this.id, name: this.name, xpath: this.xpath };
  }
}

// Sessions saved before lists had ids had one list, and fields in "item" or "page" scope.
function migrated({ listXPath, lists = [], fields = [] }) {
  if (listXPath === undefined) return { lists, fields };
  const list = { id: newId(), name: "items", xpath: listXPath };
  return {
    lists: listXPath ? [list] : [],
    fields: fields.map(({ scope, ...field }) => ({ ...field, list: listXPath && scope === "item" ? list.id : "" })),
  };
}

// The selection for one site (its lists and their fields), saved per host like
// the server's parsers, plus what the page last answered for it.
//
// What the parser gives depends on the lists: without one, one element per
// page; with one, by default an element per item and the page fields as
// metadata; otherwise one element per page, each list one of its properties.
export class Session {
  constructor(saved = {}) {
    const { lists, fields } = migrated(saved);
    this.lists = lists.map(list => new List(list));
    this.fields = fields;
    this.oneListGivesElements = saved.oneListGivesElements ?? true;
    this.evaluation = EMPTY_EVALUATION;
  }

  static async load(site) {
    const { [SESSIONS_KEY]: sessions } = await browser.storage.local.get({ [SESSIONS_KEY]: {} });
    return sessions[site] ? new Session(sessions[site]) : null;
  }

  async save(site) {
    const { [SESSIONS_KEY]: sessions } = await browser.storage.local.get({ [SESSIONS_KEY]: {} });
    sessions[site] = JSON.parse(JSON.stringify({
      lists: this.lists,
      fields: this.fields,
      oneListGivesElements: this.oneListGivesElements,
    }));
    await browser.storage.local.set({ [SESSIONS_KEY]: sessions });
  }

  // The list whose items are the parser's elements: the only one, unless it was made a property.
  get elementList() {
    return this.lists.length === 1 && this.oneListGivesElements ? this.lists[0] : null;
  }

  setOneListGivesElements(givesElements) {
    this.oneListGivesElements = givesElements;
  }

  listById(id) {
    return this.lists.find(list => list.id === id);
  }

  fieldsOf(list) {
    return this.fields.filter(field => field.list === list.id);
  }

  // Fields of a removed list stay here until the page has placed them again.
  get pageFields() {
    return this.fields.filter(field => !this.listById(field.list));
  }

  itemCountOf(list) {
    return this.evaluation.lists[list.id]?.itemCount ?? 0;
  }

  isListValid(list) {
    return this.evaluation.lists[list.id]?.valid ?? true;
  }

  // How many values the field reads on this page.
  rowCountOf(field) {
    const list = this.listById(field.list);
    return list ? this.itemCountOf(list) : 1;
  }

  valuesOf(field) {
    return this.evaluation.values[field.id] || [];
  }

  hasList(xpath) {
    return this.lists.some(list => list.xpath === xpath);
  }

  addList(candidates, index, name) {
    this.lists.push(new List({ name: this.uniqueListName(name), candidates, candidateIndex: index }));
  }

  growList(list) {
    list.choose(list.candidateIndex + 1);
  }

  shrinkList(list) {
    list.choose(list.candidateIndex - 1);
  }

  setListXPath(list, xpath) {
    if (xpath) list.setXPath(xpath);
    else this.removeList(list);
  }

  // Its fields are moved to the page, or to the list around them, by the page.
  removeList(list) {
    this.lists.splice(this.lists.indexOf(list), 1);
  }

  renameList(list, name) {
    list.name = this.uniqueListName(name, list);
  }

  addPickedField(field) {
    const base = field.name === "field" ? `field_${this.fields.length + 1}` : field.name;
    this.fields.push({ ...field, name: this.uniqueFieldName(base, field) });
  }

  renameField(field, name) {
    field.name = this.uniqueFieldName(name, field);
  }

  // A new id makes the page find the field's element again from the new XPath.
  setFieldXPath(field, xpath) {
    field.xpath = xpath;
    field.id = newId();
  }

  // "text", "number", "click" or "@attribute". A click field also has the XPath
  // of the element that changes once the click is answered (empty: anything may).
  setFieldReading(field, reading) {
    field.attribute = reading.startsWith("@") ? reading.slice(1) : "";
    field.number = reading === "number";
    field.click = reading === "click";
    if (field.click) field.waitFor ??= "";
  }

  setFieldWaitFor(field, xpath) {
    field.waitFor = xpath;
  }

  // "page" or "list": the page rebuilds the XPath from the field's element, then reports where it went.
  moveField(field, to) {
    field.movedTo = to;
  }

  removeField(field) {
    this.fields.splice(this.fields.indexOf(field), 1);
  }

  // Names are attributes of the same object: the fields of one list, or the
  // page fields and the lists (properties of the page's element).
  namesNextTo(field) {
    const list = this.listById(field.list);
    const neighbours = (list ? this.fieldsOf(list) : this.pageFields).filter(f => f !== field).map(f => f.name);
    return list ? neighbours : [...neighbours, ...this.lists.map(l => l.name)];
  }

  uniqueFieldName(name, field) {
    return uniqueName(name, this.namesNextTo(field));
  }

  uniqueListName(name, except) {
    const taken = [...this.pageFields.map(f => f.name), ...this.lists.filter(l => l !== except).map(l => l.name)];
    return uniqueName(name, taken);
  }

  applyEvaluation({ fields, lists, ...evaluation }) {
    const evaluated = new Map(fields.map(field => [field.id, field]));
    for (const field of this.fields) {
      const { xpath, list } = evaluated.get(field.id) || field;
      const moved = list !== field.list;
      Object.assign(field, { xpath, list });
      if (moved) this.renameField(field, field.name);
      delete field.movedTo;
    }
    this.evaluation = { ...evaluation, lists: Object.fromEntries(lists.map(list => [list.id, list])) };
  }

  selectionForPage() {
    return {
      lists: this.lists.map(({ id, xpath }) => ({ id, xpath })),
      fields: this.fields.map(({ id, xpath, list, attribute, number, click, movedTo }) =>
        ({ id, xpath, list, attribute, number, click, movedTo })),
    };
  }
}
