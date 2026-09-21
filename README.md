# Site Rule Runner 1.2.0

A Chromium Manifest V3 extension for hiding elements with CSS selectors and running site-specific JavaScript.

## Features

- Add CSS hide rules by website and CSS class/selector.
- Add JavaScript rules by website.
- Enable, disable, edit, and delete all rules from the full Options page.
- Popup for quickly adding rules to the current site.
- Import and export the complete configuration as JSON.
- Active toolbar icon when an enabled rule matches the current tab; inactive icon otherwise.
- Supports domains, URLs, wildcards, and `<all_urls>`.

### Website examples

- `example.com`
- `example.com/account/*`
- `https://example.com/*`
- `*://*.example.com/*`
- `<all_urls>`

## Install

1. Extract the ZIP.
2. Open your Chromium browser's extensions page.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.

For JavaScript rules, Chromium may require **Allow User Scripts** to be enabled in the extension's Details page.
