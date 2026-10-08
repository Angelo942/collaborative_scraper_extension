// Must give the same values as _text, _attr and _number in devtools/sidebar/parser.py.template.
// A click shows the "xpath" of the instruction _click builds.

const URL_ATTRIBUTES = ["href", "src"];
const PAGE_BASE_URL = location.origin + location.pathname;
// The minus is not a hyphen inside a word, as in "ABC-123".
const NUMBER_PATTERN = /(?:(?<![A-Za-z0-9_-])-)?[0-9]+(?:[.,][0-9]+)*/;

function elementOf(node) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node;
  return node.ownerElement || node.parentElement || null;
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function textOf(node) {
  return normalizeWhitespace(node.nodeType === Node.ELEMENT_NODE ? node.textContent : node.nodeValue || "");
}

function attributeOf(node, attribute) {
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const value = node.getAttribute(attribute);
  if (value === null) return "";
  if (!URL_ATTRIBUTES.includes(attribute)) return value;
  try {
    return new URL(value, PAGE_BASE_URL).href;
  } catch {
    return value;
  }
}

// The first number in the text, written as Python prints an int or a float:
// "1,299.00 €" -> "1299.0", "4,5 / 5" -> "4.5", "12 results" -> "12".
function numberIn(text) {
  const number = text.match(NUMBER_PATTERN)?.[0];
  if (!number) return "";
  const separator = decimalSeparatorOf(number);
  if (!separator) return BigInt(withoutSeparators(number)).toString();
  const at = number.lastIndexOf(separator);
  const value = Number(withoutSeparators(number.slice(0, at)) + "." + number.slice(at + 1));
  return Number.isInteger(value) && Math.abs(value) < 1e16 ? value.toFixed(1) : String(value);
}

// The last separator when both are used ("1.234,5", "1,234.5"). A repeated
// separator ("1.234.567") and a lone comma before three digits ("1,234") group thousands.
function decimalSeparatorOf(number) {
  const separators = number.replace(/[^.,]/g, "");
  if (!separators) return "";
  const last = separators.at(-1);
  if (separators.includes(last === "." ? "," : ".")) return last;
  if (separators.length > 1) return "";
  return last === "," && /,[0-9]{3}$/.test(number) ? "" : last;
}

function withoutSeparators(digits) {
  return digits.replace(/[.,]/g, "");
}

function hasNumber(node) {
  return Boolean(node) && NUMBER_PATTERN.test(textOf(node));
}

// The same path as lxml's getpath(): an index only among same-tag siblings.
function treePath(element) {
  const steps = [];
  for (let node = element; node; node = node.parentElement) {
    const twins = node.parentElement ? sameKindSiblings(node) : [node];
    steps.unshift(twins.length > 1 ? `${node.localName}[${twins.indexOf(node) + 1}]` : node.localName);
  }
  return "/" + steps.join("/");
}

function readValue(node, { attribute, number, click }) {
  if (!node) return "";
  if (click) return treePath(elementOf(node));
  if (attribute) return attributeOf(node, attribute);
  return number ? numberIn(textOf(node)) : textOf(node);
}
