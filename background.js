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
  let status = { available: false, ok: false, message: "User Scripts API is unavailable." };
  try {
    if (!chrome.userScripts?.getScripts) {
      await chrome.storage.local.set({ jsRuntimeStatus: status });
      return;
    }

    status.available = true;
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
    status = {
      available: true,
      ok: true,
      message: skipped.length
        ? `JavaScript rules registered. ${skipped.length} rule(s) had an invalid website pattern.`
        : "JavaScript rules are registered and ready."
    };
  } catch (error) {
    status = {
      available: true,
      ok: false,
      message: error?.message || "JavaScript rules could not be registered. Enable Allow User Scripts for this extension in your browser's extension details."
    };
  }
  await chrome.storage.local.set({ jsRuntimeStatus: status });
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
  }
  if (message?.type === "srr-sync-js") {
    syncUserScripts().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error?.message }));
    return true;
  }
});
