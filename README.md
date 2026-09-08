# Site Rule Runner 1.1.0

A Chromium Manifest V3 extension that can:

- Hide elements on selected websites using a CSS class or full CSS selector.
- Run user-entered JavaScript on selected websites.
- Enable/disable individual rules.
- Import/export the complete configuration as JSON.
- React to CSS-rule changes immediately on already-open pages.
- Handle common single-page-app URL changes.

## Install

1. Extract the ZIP.
2. Open `chrome://extensions` (or your Chromium browser's extensions page).
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `site-rule-runner` folder.
5. Pin **Site Rule Runner** if you want quick access to the popup.

## JavaScript tab requirement

The JavaScript tab uses Chromium's `chrome.userScripts` API because Manifest V3 does not allow arbitrary user-entered JavaScript through normal extension `eval` mechanisms.

- Chrome 138 and newer: open the extension's **Details** page and enable **Allow User Scripts**.
- Older supported Chrome builds: enabling **Developer mode** is normally required for `userScripts`.

The extension requires Chromium/Chrome 120 or newer for the User Scripts API.

## Website field examples

- `example.com` — applies to the domain and its subdomains.
- `example.com/account/*` — applies under that path.
- `https://example.com/*` — explicit scheme/domain pattern.
- `*://*.example.com/*` — Chromium-style match pattern.
- `<all_urls>` — all normal web URLs.

## CSS examples

- `sponsored` becomes `.sponsored` automatically.
- `.sponsored-card`
- `div[data-ad="true"]`
- `.sidebar .promo`

## Config shape

```json
{
  "version": 1,
  "cssRules": [
    {
      "id": "example-css",
      "site": "example.com",
      "selector": ".ad",
      "enabled": true
    }
  ],
  "jsRules": [
    {
      "id": "example-js",
      "site": "example.com",
      "code": "console.log('Site Rule Runner');",
      "enabled": true
    }
  ]
}
```

## Version 1.1.0 icon states

The toolbar icon now changes per tab:

- **Active icon (check/sparkle):** the current page matches at least one enabled CSS or JavaScript rule.
- **Inactive icon (pause):** the current page has no enabled matching rules.

The state updates when you switch tabs, navigate, use many single-page-app URL changes, or edit/import rules.
