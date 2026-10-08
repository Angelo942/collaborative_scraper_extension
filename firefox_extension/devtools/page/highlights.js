const MAX_OUTLINES = 1000;

const OUTLINE_STYLE = `
  .outline { position: fixed; pointer-events: none; z-index: 2147483647; border-radius: 2px; }
  .item    { outline: 2px dashed #4f46e5; background: rgba(79, 70, 229, 0.06); }
  .field   { outline: 2px solid #ea580c; background: rgba(234, 88, 12, 0.10); }
  .hovered { outline: 2px solid #16a34a; background: rgba(22, 163, 74, 0.15); }
  .label   { position: absolute; left: -2px; top: -20px; padding: 1px 5px; border-radius: 3px;
             background: #16a34a; color: #fff; font: 11px/16px ui-monospace, monospace; white-space: nowrap; }
`;

// Drawn in a closed shadow root so the page's CSS can't reach them.
class Highlights {
  constructor() {
    this.host = document.createElement("div");
    this.host.id = "collab-scraper-devtools";
    this.host.style.cssText = "all: initial !important;";
    const root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = OUTLINE_STYLE;
    this.layer = document.createElement("div");
    root.append(style, this.layer);
  }

  // Appended after <body>, so the outlines never shift the positions generated XPaths count.
  show() {
    document.documentElement.append(this.host);
  }

  hide() {
    this.host.remove();
  }

  isOwnElement(element) {
    return element === this.host;
  }

  draw({ items, matches, hovered }) {
    const outlines = [
      ...items.map(item => outline(item, "item")),
      ...matches.flatMap(column => [...new Set(column)].map(node => outline(elementOf(node), "field"))),
      hovered && outline(hovered, "hovered", describe(hovered)),
    ].filter(Boolean);
    this.layer.replaceChildren(...outlines.slice(0, MAX_OUTLINES));
  }

  // The page as the extension sends it to the server.
  pageHtmlWithoutHighlights() {
    const wasShown = this.host.isConnected;
    this.hide();
    const html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    if (wasShown) this.show();
    return html;
  }
}

function outline(element, kind, labelText) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const box = document.createElement("div");
  box.className = `outline ${kind}`;
  box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  if (labelText) {
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = labelText;
    box.append(label);
  }
  return box;
}

function describe(element) {
  const classes = Array.from(element.classList).slice(0, 3).map(name => "." + name).join("");
  return element.localName + (element.id ? "#" + element.id : "") + classes;
}
