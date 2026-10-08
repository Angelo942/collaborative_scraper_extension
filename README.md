# Collaborative Scraper (browser extension)

This repository contains the browser extension of the [Collaborative Scraper](https://github.com/Angelo942/collaborative_scraper_server) project. The extension is responsible for collecting the visited pages and sending them to the parsing server.

---

## Overview

The Collaborative Scraper browser extension runs locally in the user’s browser and acts as a lightweight client:

- It observes pages visited by the user
- Submits approved pages to the backend server
- Optionally reacts to server instructions to guide further navigation

All parsing, storage, and scraping logic is handled by the server.

---

## Usage

![Options menu](./option_menu.png)

### Website Permissions

By default, the extension does **not** send any pages.

Each website must be **explicitly approved by the user** before the extension is allowed to run on it.  
Allowed websites are managed through the extension’s **options menu**.

This design ensures that page collection is always user-controlled.

---

### Server Configuration

Before using the extension, If you are not hosting the parsing server locally with default parameters, configure the correct address by setting:

- **Server IP**
- **Server Port**

---

### Sending Pages

- Clicking the **extension icon** on a tab does two things:
  1. It **activates** that tab for sharing, and
  2. It submits the currently open page to the server.
- Until you click the icon, **no pages are sent** — even on an allowed site. A freshly opened tab is not active yet, so simply browsing an allowed site will not send anything.
- Once a tab has been activated, it stays active for the life of the tab: pages you navigate to afterwards are submitted automatically. Activation is reset when the tab is closed (or the browser is restarted), so you need to click the icon again on a new tab.

---

### Interactive Mode

The options menu allows enabling an **interactive mode**.

When interactive mode is active:

1. A page is sent to the server
2. The server responds with instructions on which page to visit next
3. If the target website has been allowed by the user, the current browser tab is redirected to requested page and the process repeats

The process continues as long as the tab remains open.

---

### Developer Mode

Developer mode helps write a parser for a new site. Turn on **Developer Mode** in the options menu. **Pick elements to parse (dev mode)** then appears in the right-click menu of the extension icon and of any page. It opens the **Parser builder** in the Firefox sidebar (it can also be opened from *View → Sidebar*). Nothing is sent to the server, so it works on any site, allowed or not.

1. **Pick list**: click one item of a list you want to scrape (a search result, a table row, a card). The extension finds the similar items next to it and outlines them. If it picked the wrong level (e.g. the cells of a row instead of the rows), use **Bigger** / **Smaller**. Each pick adds a list; a list that isn't on every page is fine, its fields just read nothing where it is missing.
2. **Pick fields**: click the values to extract inside any item: a title, a year, a link, an image. Click the same link twice to get both its text and its `href`. A value inside a list's item is read in each item of that list (the innermost one, when lists are nested); clicks outside every list add *page* fields, read once per page (e.g. the search query in the heading).
3. Check the selection and the preview. The sidebar shows the fields nested under the list they belong to, and what the parser will give:
   - no list: one element per page, with the page fields;
   - one list: by default one element per item of the list, the page fields in the `Result` metadata. Set **The list is** to *a property of one element per page* to get one element with the page fields and the list as a property instead, as with several lists;
   - several lists: one element per page, with the page fields and each list as a property holding a list of dicts, named after the list. A list missing from a page is an empty list there.

   Each list has a name, editable, guessed from its items' class (`<li class="review">` gives `reviews`).

   Each field shows how many items it was found in (`6/8`). Fields can be renamed, read as text, as a number (the first number in the text, e.g. `1,299.00 €` gives `1299.0`) or as any attribute, and their XPath edited by hand. An absolute XPath typed in a list field (e.g. one copied from the inspector) is made relative to the item it goes through. The **→ page** / **→ list** badge moves a field between its list and the page: use it when a value was picked as a page field but belongs to each item (e.g. a hidden part revealed for one item only).
4. **Pick action** (optional): when an item's details only appear after a click (a card that opens a panel, a row that expands), click that element once. Unlike the other modes, the click reaches the page, and the extension records what it changed. It adds a field read as **click**, like *text* or *number*, with the XPath of the element that changes under **Changes** (empty: any change). Any field can be switched to *click*, so an item can have several actions. Then pick the details as fields while they are shown (usually *page* fields).
5. Export:
   - **Python parser**: a module with an `extract_elements(html_page, path, get_parameters, post_parameters)` that returns a `Result`, as the server expects. Copy it into your plugin's `parse_html` package and register it with `reg.parser("<host>", extract_elements)`. The downloaded file also runs on its own (see *Page HTML*).
   - **Copy Python script**: the same parser for the plugin only, without the standalone part, copied to the clipboard.
   - **CSV**: the values on the current page.
   - **Page HTML**: the page as the server receives it. Run the parser on it without the server: `python <site>_parser.py <site>_page.html > items.csv` (needs `lxml`).

The sidebar stays open while you browse, and the selection is kept per site: open another page of the same kind and it shows straight away whether the XPaths still match. Press `Esc` to stop picking and use the page normally; closing the sidebar removes the highlights from the page.

#### The `CLICK` instruction

`{ "type": "CLICK", "xpath": "...", "wait_for": "..." }` clicks the first element at `xpath`, waits until the element at `wait_for` has changed (or anything on the page, when it is empty), then sends the page to `/receive` as usual, with the token of the preceding `set_token`. The payload's `meta.click` is `{ xpath, ok, error }`: the page is sent even when the element is missing or nothing changed within 10 s, so the server can move on. In the exported parser, a *click* field holds this instruction for each item (its paths made absolute, as the browser evaluates them on the whole page), e.g. `item.action`. A scraper sends it back to make the next request.

## Installation

At the moment, the extension is only available for **Firefox** and must be installed manually.

### 1. Clone the repository

```bash
git clone https://github.com/Angelo942/collaborative_scraper_extension.git
```

### 2. Load the extension in Firefox

- Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
- Click Load Temporary Add-on…
- In the file selection dialog, navigate to `collaborative_scraper_extension/firefox_extension/`
- Select manifest.json

The extension will be loaded as a temporary add-on and will remain active until Firefox is restarted.
