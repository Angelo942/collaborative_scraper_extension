// While picking, clicks select elements instead of following links or
// reaching the site's own handlers, except when picking an action: then the
// click is what gets recorded.
const SWALLOWED_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick", "dblclick"];

class Picker {
  constructor({ isOwnElement, onPick, onStop, onRedrawNeeded }) {
    this.isOwnElement = isOwnElement;
    this.onPick = onPick;
    this.onStop = onStop;
    this.onRedrawNeeded = onRedrawNeeded;
    this.mode = "idle";   // "idle" | "list" | "field" | "action"
    this.hovered = null;
    this.handlers = [
      ["mousemove", (e) => this.hover(e)],
      ["click", (e) => this.pick(e)],
      ["keydown", (e) => this.stopOnEscape(e)],
      ...SWALLOWED_EVENTS.map(type => [type, (e) => this.swallow(e)]),
    ];
    this.viewportHandler = () => this.onRedrawNeeded();
  }

  get picking() {
    return this.mode !== "idle";
  }

  attach() {
    for (const [type, handler] of this.handlers) window.addEventListener(type, handler, true);
    for (const type of ["scroll", "resize"]) window.addEventListener(type, this.viewportHandler, { capture: true, passive: true });
  }

  detach() {
    for (const [type, handler] of this.handlers) window.removeEventListener(type, handler, true);
    for (const type of ["scroll", "resize"]) window.removeEventListener(type, this.viewportHandler, true);
    this.setMode("idle");
  }

  setMode(mode) {
    this.mode = mode;
    this.hovered = null;
    this.onRedrawNeeded();
  }

  isPageTarget(event) {
    return this.picking && event.target instanceof Element && !this.isOwnElement(event.target);
  }

  swallow(event) {
    if (!this.isPageTarget(event) || this.mode === "action") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  hover(event) {
    const target = this.isPageTarget(event) ? event.target : null;
    if (target === this.hovered) return;
    this.hovered = target;
    this.onRedrawNeeded();
  }

  pick(event) {
    if (!this.isPageTarget(event)) return;
    this.swallow(event);
    this.onPick(event.target, this.mode);
  }

  stopOnEscape(event) {
    if (event.key !== "Escape" || !this.picking) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.setMode("idle");
    this.onStop();
  }
}
