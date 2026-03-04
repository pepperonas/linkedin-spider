# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Chrome Extension (Manifest V3) that auto-sends LinkedIn connection requests. It clicks "Vernetzen" (Connect) buttons on search result pages and confirms with "Ohne Notiz senden" (Send without a note) in the popup dialog. Rate-limited to 1 action per second.

## Loading / Testing

No build step. Load directly in Chrome:
1. `chrome://extensions` → Developer Mode → "Load unpacked" → select this directory
2. After code changes: click the refresh icon on the extension card, then reload the LinkedIn tab

Debug via DevTools Console on the LinkedIn tab — all logs prefixed with `[LC]`.

## Architecture

- **`content.js`** — Injected on all `*.linkedin.com` pages. Runs an IIFE with a 1-second `setInterval` loop. Each tick: first tries to find+click the confirm dialog button ("Ohne Notiz senden"), then falls back to finding the next unprocessed "Vernetzen" button. Uses `realClick()` (dispatches mousedown/mouseup/click events) because LinkedIn's Ember framework ignores plain `.click()`. Processed buttons are marked with `data-lc-processed` to prevent re-clicks.
- **`popup.html` / `popup.js`** — Extension popup UI. Communicates with content script via `chrome.tabs.sendMessage`. Polls content script status every 1s while open. State (`lcEnabled`, `lcCount`) persisted in `chrome.storage.local`.
- **`styles.css`** — Popup styling only (not injected into LinkedIn pages).

## LinkedIn DOM Selectors

LinkedIn's DOM changes frequently. Key selectors that work as of early 2026:
- Connect buttons: `button`/`a` elements with text "Vernetzen", excluding those inside `[role="dialog"]` or `.artdeco-modal`
- Confirm dialog: `.send-invite` modal with `button[aria-label="Ohne Notiz senden"]` or fallback to `.artdeco-button--primary` inside the modal
- The dialog class is `artdeco-modal` with a `send-invite` class

If selectors break, inspect the LinkedIn page and update `findConnectButton()` / `findConfirmButton()` in `content.js`.

## Message Protocol (popup ↔ content script)

| Action         | Direction        | Payload                  | Response           |
|---------------|------------------|--------------------------|--------------------|
| `toggle`      | popup → content  | `{ enabled: bool }`      | `{ ok: true }`    |
| `getStatus`   | popup → content  | —                        | `{ active, count }`|
| `resetCount`  | popup → content  | —                        | `{ ok: true }`    |
