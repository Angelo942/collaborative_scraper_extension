// XPaths must work both here (document.evaluate on the live page) and on the
// server (lxml on the page's outerHTML), so they stick to plain XPath 1.0.

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function evaluateXPath(xpath, context = document) {
  try {
    const snapshot = document.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({ length: snapshot.snapshotLength }, (_, i) => snapshot.snapshotItem(i));
  } catch {
    return null;
  }
}

// "/" inside predicates and strings ([@href="/a/b"]) doesn't separate steps.
// "//" leaves an empty step, so joining the steps back with "/" gives the XPath again.
function xpathSteps(xpath) {
  const steps = [""];
  let depth = 0;
  let quote = "";
  for (const char of xpath) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === "/" && depth === 0) {
      steps.push("");
      continue;
    }
    steps[steps.length - 1] += char;
  }
  return steps;
}

function firstMatch(xpath, context) {
  const nodes = evaluateXPath(xpath, context);
  return nodes && nodes.length ? nodes[0] : null;
}

// Build tools generate names like css-1x2y3z or Title__a8Fk2 that change between deploys.
function looksGenerated(name) {
  return name.length > 40 ||
    /["'\\]/.test(name) ||
    /\d{3,}/.test(name) ||
    /^(css|sc|jsx|emotion|svelte)-/.test(name) ||
    /__[\w-]{5}$/.test(name);
}

function stableClasses(element) {
  return Array.from(element.classList || []).filter(name => !looksGenerated(name));
}

function uniqueIdStep(element) {
  const id = element.id;
  if (!id || id.length > 60 || /["'\\:]/.test(id) || /\d{4,}/.test(id)) return null;
  const step = `//*[@id="${id}"]`;
  return evaluateXPath(step)?.length === 1 ? step : null;
}

function isSameKind(a, b) {
  return a.localName === b.localName && a.namespaceURI === b.namespaceURI;
}

// lxml puts SVG and MathML in no namespace, the browser in their own: local-name() matches both.
function nodeTest(element) {
  return element.namespaceURI === XHTML_NAMESPACE ? element.localName : `*[local-name()="${element.localName}"]`;
}

function hasClass(name) {
  return `contains(concat(" ", normalize-space(@class), " "), " ${name} ")`;
}

function sameKindSiblings(element) {
  const parent = element.parentElement;
  return parent ? Array.from(parent.children).filter(sibling => isSameKind(sibling, element)) : [element];
}

function stepAmongSiblings(element) {
  const test = nodeTest(element);
  const twins = sameKindSiblings(element);
  if (twins.length === 1) return test;
  const ownClass = stableClasses(element).find(name => twins.filter(t => t.classList.contains(name)).length === 1);
  return ownClass ? `${test}[${hasClass(ownClass)}]` : `${test}[${twins.indexOf(element) + 1}]`;
}

function absoluteXPath(element) {
  const steps = [];
  for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
    const anchor = uniqueIdStep(node);
    if (anchor) return [anchor, ...steps].join("/");
    steps.unshift(stepAmongSiblings(node));
  }
  return ["/html", ...steps].join("/");
}

function stepsBetween(ancestor, element) {
  const steps = [];
  for (let node = element; node && node !== ancestor; node = node.parentElement) steps.unshift(stepAmongSiblings(node));
  return steps;
}

// Of the paths that find `element` in its own item, the one found in the most items.
function relativeXPath(element, item, allItems) {
  if (element === item) return ".";
  const test = nodeTest(element);
  const candidates = [
    ...stableClasses(element).map(name => `.//${test}[${hasClass(name)}]`),
    "./" + stepsBetween(item, element).join("/"),
    `.//${test}`,
  ].filter(xpath => firstMatch(xpath, item) === element);
  const coverage = candidates.map(xpath => allItems.filter(other => firstMatch(xpath, other)).length);
  return candidates[coverage.indexOf(Math.max(...coverage))];
}

function lookalikeSiblings(element) {
  const classes = stableClasses(element);
  return sameKindSiblings(element).filter(sibling =>
    classes.length === 0 || classes.some(name => sibling.classList.contains(name)));
}

function listXPathFor(item) {
  const lookalikes = lookalikeSiblings(item);
  const sharedClass = stableClasses(item).find(name => lookalikes.every(other => other.classList.contains(name)));
  const filter = sharedClass ? `[${hasClass(sharedClass)}]` : "";
  return `${absoluteXPath(item.parentElement)}/${nodeTest(item)}${filter}`;
}

// Closest first: the clicked element itself, then each repeated ancestor.
function listXPathsAround(element) {
  const xpaths = [];
  for (let node = element; node.parentElement && node !== document.body; node = node.parentElement) {
    if (lookalikeSiblings(node).length >= 2) xpaths.push(listXPathFor(node));
  }
  return xpaths;
}
