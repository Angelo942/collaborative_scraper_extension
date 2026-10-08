// What a click on the page does, seen from the DOM: the element that changed
// around all the changes. The server replays the click with a CLICK instruction
// and waits for that element to change before sending the page.

const FIRST_CHANGE_TIMEOUT_MS = 5000;
const SETTLED_AFTER_MS = 700;

const CLICKABLE = 'a, button, input, select, summary, label, [role="button"], [role="tab"], [role="link"], [onclick], [tabindex]';

// The text of a card inside a <button> was clicked, but the button is what the site listens to.
function clickTargetOf(element, item) {
  const clickable = element.closest(CLICKABLE);
  if (!clickable || (item && !item.contains(clickable))) return element;
  return clickable;
}

// Attribute changes are left out: sites toggle classes on <body> (scroll lock,
// focus) which would make the whole page the changed element.
function changedElementsIn(records, isOwnElement) {
  return records
    .filter(record => record.type !== "attributes")
    .map(record => elementOf(record.target))
    .filter(element => element && element.isConnected && !isOwnElement(element));
}

function commonAncestor(elements) {
  if (!elements.length) return null;
  let ancestor = elements[0];
  while (ancestor && !elements.every(element => ancestor.contains(element))) ancestor = ancestor.parentElement;
  return ancestor;
}

// Resolves once the page has been quiet for a moment after its first change,
// to the element containing every change, or null when nothing changed.
function changedRegionAfterClick(isOwnElement) {
  return new Promise((resolve) => {
    const changed = new Set();
    let timer = setTimeout(finish, FIRST_CHANGE_TIMEOUT_MS);

    const observer = new MutationObserver((records) => {
      const elements = changedElementsIn(records, isOwnElement);
      if (!elements.length) return;
      elements.forEach(element => changed.add(element));
      clearTimeout(timer);
      timer = setTimeout(finish, SETTLED_AFTER_MS);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    function finish() {
      observer.disconnect();
      resolve(commonAncestor([...changed].filter(element => element.isConnected)));
    }
  });
}

function isWholePage(element) {
  return !element || element === document.body || element === document.documentElement;
}
