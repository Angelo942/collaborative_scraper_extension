// The sidebar's selection as found on this page: the items of each list, and
// for each field the nodes it reads (one per item of its list, or one for the page).
class PageSelection {
  constructor() {
    this.lists = [];                   // { id, xpath, valid, items }
    this.changedListIds = new Set();
    this.fields = [];
    this.matches = new Map();          // field id -> nodes it reads
    this.pickedElements = new Map();   // field id -> the element it was picked from
  }

  get items() {
    return this.lists.flatMap(list => list.items);
  }

  listById(id) {
    return this.lists.find(list => list.id === id);
  }

  // The innermost item around `element`, when lists are nested: { list, item }.
  itemAround(element) {
    const owners = this.lists.flatMap(list =>
      list.items.filter(item => item.contains(element)).map(item => ({ list, item })));
    return owners.find(owner => owners.every(other => other.item.contains(owner.item))) || null;
  }

  // The longest list is the default: clicking a table cell means the rows, not that row's cells.
  listsAround(element) {
    const candidates = listXPathsAround(element);
    if (!candidates.length) return null;
    const sizes = candidates.map(xpath => (evaluateXPath(xpath) || []).length);
    const index = sizes.indexOf(Math.max(...sizes));
    return { candidates, index, name: listNameFor(evaluateXPath(candidates[index])[0]) };
  }

  fieldFor(element) {
    const owner = this.itemAround(element);
    const field = {
      id: Math.random().toString(36).slice(2),
      list: owner ? owner.list.id : "",
      xpath: this.xpathWhereItIs(element, owner),
    };
    field.attribute = this.defaultAttribute(element, field);
    field.name = { href: "link", src: "image" }[field.attribute] || nameAround(element, owner?.item);
    this.pickedElements.set(field.id, element);
    return field;
  }

  // A field read as "click": what clicking `target` asks for, and the element
  // that changes once it is answered (empty: anything may). That element is
  // relative to the clicked item only when it is inside it.
  clickFieldFor(target, region) {
    const owner = this.itemAround(target);
    const regionOwner = owner && region && owner.item.contains(region) ? owner : null;
    return {
      ...this.fieldFor(target),
      name: "action",
      attribute: "",
      number: false,
      click: true,
      waitFor: isWholePage(region) ? "" : this.xpathWhereItIs(region, regionOwner),
    };
  }

  xpathWhereItIs(element, owner) {
    return owner ? relativeXPath(element, owner.item, owner.list.items) : absoluteXPath(element);
  }

  defaultAttribute(element, field) {
    const hasText = element.textContent.trim() !== "";
    if (element.hasAttribute("src") && !hasText) return "src";
    const textAlreadyPicked = this.fields.some(other =>
      other.xpath === field.xpath && other.list === field.list && other.attribute === "");
    if (element.hasAttribute("href") && (!hasText || textAlreadyPicked)) return "href";
    return "";
  }

  // With `rebase` the lists changed: a field whose element is now in another
  // list (the innermost around it), or in none, is rebuilt from it. A
  // field's `movedTo` ("page" or "list") is where the sidebar asked to read it.
  // A list field given an absolute XPath is made relative to the item it goes through.
  apply({ lists, fields, rebase }) {
    const elementsBefore = fields.map(field => this.elementFor(field));
    this.setLists(lists);
    this.fields = fields.map((field, i) => this.placed(field, elementsBefore[i], rebase));
    this.matches = new Map(this.fields.map(field => [field.id, this.matchesOf(field)]));
  }

  setLists(lists) {
    const before = new Map(this.lists.map(list => [list.id, list.xpath]));
    this.changedListIds = new Set(lists.filter(list => before.get(list.id) !== list.xpath).map(list => list.id));
    this.lists = lists.map(({ id, xpath }) => {
      const found = evaluateXPath(xpath);
      const items = (found || []).filter(node => node.nodeType === Node.ELEMENT_NODE);
      return { id, xpath, valid: found !== null, items };
    });
  }

  elementFor(field) {
    const picked = this.pickedElements.get(field.id);
    if (picked?.isConnected) return picked;
    const list = this.listById(field.list);
    for (const root of list ? list.items : [document]) {
      const found = elementOf(firstMatch(field.xpath, root));
      if (found?.isConnected) {
        this.pickedElements.set(field.id, found);
        return found;
      }
    }
    return null;
  }

  placed({ movedTo, ...field }, element, rebase) {
    if (movedTo === "page") return this.inPage(field, element);
    if (movedTo === "list") return this.inListAround(field, element);
    if (rebase && element) return this.rebased(field, element);
    const list = this.listById(field.list);
    if (field.list && !list) return this.inPage(field, element);
    if (list && field.xpath.startsWith("/") && list.items.length) return this.inList(field, element, list);
    return field;
  }

  // An XPath kept as it is may have been made to work across pages.
  rebased(field, element) {
    const owner = this.itemAround(element);
    if (!owner) return field.list ? this.inPage(field, element) : field;
    if (owner.list.id === field.list && !this.changedListIds.has(field.list)) return field;
    return this.inList(field, element, owner.list);
  }

  inPage(field, element) {
    const xpath = element ? absoluteXPath(element) : field.xpath.replace(/^\.(?=\/\/)/, "");
    return { ...field, list: "", xpath };
  }

  inListAround(field, element) {
    const list = element ? this.itemAround(element)?.list : this.listOnPath(field.xpath);
    return list ? this.inList(field, element, list) : field;
  }

  inList(field, element, list) {
    const item = element && list.items.find(item => item.contains(element));
    const xpath = item ? relativeXPath(element, item, list.items) : this.retargetedXPath(field.xpath, list);
    return { ...field, list: list.id, xpath };
  }

  // Without an element inside an item to build from (a hidden part that isn't
  // on the page now, a typo), the XPath is turned around as written:
  // "/html/…/li[3]/div/span" -> "./div/span" when "/html/…/li[3]" is an item,
  // "//td[…]" -> ".//td[…]" otherwise.
  retargetedXPath(xpath, list) {
    return this.pathBelowItem(xpath, list) ?? (xpath.startsWith("//") ? "." + xpath : xpath);
  }

  // The list whose item the XPath goes through, or else the only list.
  listOnPath(xpath) {
    const below = this.lists.find(list => this.pathBelowItem(xpath, list) !== null);
    if (below) return below;
    return this.lists.length === 1 ? this.lists[0] : null;
  }

  pathBelowItem(xpath, list) {
    const steps = xpathSteps(xpath);
    for (let end = steps.length; end > 0; end--) {
      const node = firstMatch(steps.slice(0, end).join("/"), document);
      if (list.items.includes(node)) return [".", ...steps.slice(end)].join("/");
    }
    return null;
  }

  matchesOf(field) {
    if (!field.list) return [firstMatch(field.xpath, document)];
    return (this.listById(field.list)?.items || []).map(item => firstMatch(field.xpath, item));
  }

  evaluation() {
    const perField = (read) => Object.fromEntries(this.fields.map(field => [field.id, read(field, this.matches.get(field.id))]));
    return {
      fields: this.fields,
      lists: this.lists.map(({ id, valid, items }) => ({ id, valid, itemCount: items.length })),
      values: perField((field, nodes) => nodes.map(node => readValue(node, field))),
      attributes: perField((_, nodes) => {
        const element = nodes.find(node => node?.nodeType === Node.ELEMENT_NODE);
        return element ? Array.from(element.attributes, attribute => attribute.name) : [];
      }),
      numeric: perField((_, nodes) => nodes.some(hasNumber)),
    };
  }
}

// A link in <h3 class="title"> is the "title": the closest class or heading, within the item.
function nameAround(element, item) {
  for (let node = element, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
    const className = stableClasses(node)[0];
    if (className) return className;
    if (/^h[1-6]$/.test(node.localName)) return "title";
    if (node === item) break;
  }
  return "field";
}

// <li class="review"> makes a list of "reviews".
function listNameFor(item) {
  const className = item && stableClasses(item)[0];
  if (!className) return "items";
  return className.endsWith("s") ? className : className + "s";
}
