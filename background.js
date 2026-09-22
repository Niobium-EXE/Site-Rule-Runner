importScripts("shared.js");

const ACTIVE_ICONS = {
  16: "icons/active-16.png",
  32: "icons/active-32.png",
  48: "icons/active-48.png",
  128: "icons/active-128.png"
};
const INACTIVE_ICONS = {
  16: "icons/inactive-16.png",
  32: "icons/inactive-32.png",
  48: "icons/inactive-48.png",
  128: "icons/inactive-128.png"
};
const SCRIPT_PREFIX = "srr-js-";

async function updateIconForTab(tabId, url) {
  if (!tabId) return;
  try {
    const config = await SiteRuleUtils.loadConfig();
    const matches = SiteRuleUtils.matchingRules(config, url || "");
    const active = matches.cssRules.length > 0 || matches.jsRules.length > 0;
    await chrome.action.setIcon({ tabId, path: active ? ACTIVE_ICONS : INACTIVE_ICONS });
    await chrome.action.setTitle({
      tabId,
      title: active ? "Site Rule Runner — rules active on this site" : "Site Rule Runner — no active rules on this site"
    });
  } catch (_) {}
}

async function refreshAllTabIcons() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => updateIconForTab(tab.id, tab.url)));
}

async function syncUserScripts() {
  let status = { available: false, liveAvailable: false, ok: false, message: "User Scripts API is unavailable." };
  try {
    if (!chrome.userScripts?.getScripts) {
      await chrome.storage.local.set({ jsRuntimeStatus: status });
      return;
    }

    status.available = true;
    status.liveAvailable = typeof chrome.userScripts.execute === "function";
    const existing = await chrome.userScripts.getScripts();
    const ours = existing.filter(s => s.id?.startsWith(SCRIPT_PREFIX)).map(s => s.id);
    if (ours.length) await chrome.userScripts.unregister({ ids: ours });

    const config = await SiteRuleUtils.loadConfig();
    const registrations = [];
    const skipped = [];

    for (const rule of config.jsRules) {
      if (!rule.enabled) continue;
      const match = SiteRuleUtils.chromeMatchPattern(rule.pattern);
      if (!match) {
        skipped.push(rule.pattern);
        continue;
      }
      registrations.push({
        id: `${SCRIPT_PREFIX}${rule.id}`,
        matches: [match],
        js: [{ code: rule.code }],
        runAt: "document_idle",
        allFrames: false,
        world: "MAIN"
      });
    }

    if (registrations.length) await chrome.userScripts.register(registrations);
    const liveText = status.liveAvailable
      ? " Live Run now/apply-on-save is available."
      : " Live Run now requires Chromium 135+; saved rules will still run on future matching page loads.";
    status = {
      available: true,
      liveAvailable: status.liveAvailable,
      ok: true,
      message: (skipped.length
        ? `JavaScript rules registered. ${skipped.length} rule(s) had an invalid website pattern.`
        : "JavaScript rules are registered and ready.") + liveText
    };
  } catch (error) {
    status = {
      available: true,
      liveAvailable: typeof chrome.userScripts?.execute === "function",
      ok: false,
      message: error?.message || "JavaScript rules could not be registered. Enable Allow User Scripts for this extension in your browser's extension details."
    };
  }
  await chrome.storage.local.set({ jsRuntimeStatus: status });
}

async function executeJavaScriptNow(pattern, code) {
  if (!chrome.userScripts?.execute) {
    return {
      ok: false,
      supported: false,
      matched: 0,
      ran: 0,
      failed: 0,
      message: "Live JavaScript execution requires Chromium 135 or newer and Allow User Scripts enabled."
    };
  }

  if (!SiteRuleUtils.chromeMatchPattern(pattern) || !String(code || "").trim()) {
    return { ok: false, supported: true, matched: 0, ran: 0, failed: 0, message: "The website pattern or JavaScript is invalid." };
  }

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter(tab => tab.id && SiteRuleUtils.patternMatchesUrl(pattern, tab.url || ""));
  if (!matchingTabs.length) {
    return { ok: true, supported: true, matched: 0, ran: 0, failed: 0, message: "No currently open tabs match this rule." };
  }

  let ran = 0;
  const failures = [];
  for (const tab of matchingTabs) {
    try {
      const results = await chrome.userScripts.execute({
        target: { tabId: tab.id },
        js: [{ code }],
        world: "MAIN",
        injectImmediately: true
      });
      const executionError = results?.find(result => result?.error)?.error;
      if (executionError) throw new Error(executionError);
      ran += 1;
    } catch (error) {
      failures.push({ tabId: tab.id, title: tab.title || tab.url || `Tab ${tab.id}`, error: error?.message || String(error) });
    }
  }

  const failed = failures.length;
  return {
    ok: failed === 0,
    supported: true,
    matched: matchingTabs.length,
    ran,
    failed,
    failures,
    message: failed
      ? `Ran on ${ran} of ${matchingTabs.length} matching open tab(s); ${failed} failed.`
      : `Ran immediately on ${ran} matching open tab(s).`
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await SiteRuleUtils.loadConfig();
  await SiteRuleUtils.saveConfig(config);
  await syncUserScripts();
  await refreshAllTabIcons();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncUserScripts();
  await refreshAllTabIcons();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.cssRules || changes.jsRules) {
    syncUserScripts();
    refreshAllTabIcons();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateIconForTab(tabId, tab.url);
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateIconForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "srr-url-changed" && sender.tab?.id) {
    updateIconForTab(sender.tab.id, message.url);
    return;
  }

  if (message?.type === "srr-sync-js") {
    syncUserScripts()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error?.message }));
    return true;
  }

  if (message?.type === "srr-run-js-now") {
    executeJavaScriptNow(message.pattern, message.code)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, supported: true, matched: 0, ran: 0, failed: 0, message: error?.message || String(error) }));
    return true;
  }
});
