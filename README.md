# Site Rule Runner 1.3.0

A Chromium Manifest V3 extension for applying site-specific CSS hide rules and user-provided JavaScript.

## Features

- Add CSS hide rules for a domain, URL pattern, or `<all_urls>`.
- Add JavaScript rules for matching sites.
- Give every CSS or JavaScript rule an optional title.
- Enable, disable, edit, search, and delete rules from the Options page.
- Import/export the complete configuration, including titles.
- Toolbar icon changes per tab depending on whether an enabled rule matches the current page.
- JavaScript rules use Chromium's `userScripts` API rather than `eval`.
- On Chromium 135+, **Run now** can execute the code currently being edited immediately on matching open tabs, without reloading them.
- The JS editor can also apply the newly saved code immediately to matching open tabs.

## JavaScript permissions

JavaScript rules require the browser's User Scripts feature. On recent Chrome/Chromium versions, open the extension's Details page and enable **Allow User Scripts**. Some older versions use the global Developer mode toggle instead.

Live **Run now** requires Chromium 135 or newer. On Chromium 120–134, rules can still be saved and registered normally, but edited code will take effect on the next matching page load.

## Live-editing limitation

Running an edited script immediately executes the new code, but the extension cannot generically undo effects left by an earlier version. For example, old event listeners, timers, variables, or DOM changes can remain unless the script itself cleans them up. For scripts that will be live-edited often, make them idempotent or include cleanup logic.

## Install

1. Extract the ZIP.
2. Open your Chromium browser's extensions page.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.
5. Enable **Allow User Scripts** in the extension's Details page if your browser shows that option.
