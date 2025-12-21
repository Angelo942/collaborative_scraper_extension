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

- Clicking the **extension icon** submits the currently open page to the server.

---

### Interactive Mode

The options menu allows enabling an **interactive mode**.

When interactive mode is active:

1. A page is sent to the server
2. The server responds with instructions on which page to visit next
3. If the target website has been allowed by the user, the current browser tab is redirected to requested page and the process repeats

The process continues as long as the tab remains open.

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
