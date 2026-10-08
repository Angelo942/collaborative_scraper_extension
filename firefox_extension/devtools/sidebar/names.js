const PYTHON_RESERVED = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with",
  "yield", "load", "FIELDS",
]);

export function pythonIdentifier(text) {
  let name = String(text).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  if (/^\d/.test(name)) name = "f_" + name;
  if (PYTHON_RESERVED.has(name)) name += "_";
  return name;
}

export function uniqueName(text, takenNames) {
  const base = pythonIdentifier(text);
  let name = base;
  for (let i = 2; takenNames.includes(name); i++) name = `${base}_${i}`;
  return name;
}

export function siteIdentifier(url) {
  return pythonIdentifier(new URL(url).hostname.replace(/^www\./, ""));
}

export function pythonClassName(url) {
  const words = siteIdentifier(url).split("_");
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("") + "Item";
}
