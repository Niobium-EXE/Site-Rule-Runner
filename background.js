const STORAGE_KEY = "siteRuleRunnerConfig";
const SCRIPT_PREFIX = "srr_js_";

const DEFAULT_CONFIG = {
  version: 1,
  cssRules: [],
  jsRules: []
};

const ACTION_ICONS = {
  active: {
    16: "icons/active-16.png",
    32: "icons/active-32.png",
    48: "icons/active-48.png",
    128: "icons/active-128.png"
  },
  inactive: {
    16: "icons/inactive-16.png",
    32: "icons/inactive-32.png",
    48: "icons/inactive-48.png",
    128: "icons/inactive-128.png"
  }
};

function normalizeConfig(config) {
  const value = config && typeof config === "object" ? config : {};
  return {
    version: 1,
    cssRules: Array.isArray(value.cssRules) ? value.cssRules : [],
    jsRules: Array.isArray(value.jsRules) ? value.jsRules : []
  };
}

function normalizeSiteToMatchPattern(site) {
  let raw = String(site || "").trim();
  if (!raw) throw new Error("Website is required.");

  if (raw === "<all_urls>") return "<all_urls>";

  // Already looks like a Chromium match pattern.
  if (/^(\*|http|https|file|ftp):\/\//i.test(raw)) {
    let candidate = raw;
    if (!candidate.includes("/", candidate.indexOf("://") + 3)) {
      candidate += "/*";
    }
    return candidate;
  }

  // Plain domain/path, e.g. example.com or example.com/path/*
  raw = raw.replace(/^\/+/, "");
  const slash = raw.indexOf("/");
  const host = slash === -1 ? raw : raw.slice(0, slash);
  let path = slash === -1 ? "/*" : raw.slice(slash);

  if (!host || /\s/.test(host)) throw new Error("Invalid website.");
  if (!path.startsWith("/")) path = "/" + path;
  if (!path.includes("*")) {
    path = path.endsWith("/") ? path + "*" : path + "*";
  }

  // *.example.com also includes the bare host in Chromium match patterns.
  const wildcardHost = host.startsWith("*.") ? host : `*.${host}`;
  return `*://${wildcardHost}${path}`;
}

function wildcardToRegex(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
}

function matchesPattern(urlString, pattern) {
  try {
    if (!pattern) return false;
    if (pattern === "<all_urls>") return /^(https?|file|ftp):/i.test(urlString);

    const match = pattern.match(/^(\*|http|https|file|ftp):\/\/([^/]+)(\/.*)$/i);
    if (!match) return false;

    const [, schemePattern, hostPattern, pathPattern] = match;
    const url = new URL(urlString);

    if (schemePattern === "*") {
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    } else if (`${schemePattern.toLowerCase()}:` !== url.protocol.toLowerCase()) {
      return false;
    }

    const host = url.hostname;
    let hostMatches = false;
    if (hostPattern === "*") {
      hostMatches = true;
    } else if (hostPattern.startsWith("*.")) {
      const base = hostPattern.slice(2).toLowerCase();
      const actual = host.toLowerCase();
      hostMatches = actual === base || actual.endsWith(`.${base}`);
    } else {
      hostMatches = host.toLowerCase() === hostPattern.toLowerCase();
    }
    if (!hostMatches) return false;

    const pathAndQuery = url.pathname + url.search + url.hash;
    return new RegExp(`^${wildcardToRegex(pathPattern)}$`).test(pathAndQuery);
  } catch {
    return false;
  }
}

function ruleMatchesUrl(rule, url) {
  if (!rule || rule.enabled === false || !rule.site) return false;
  try {
    return matchesPattern(url, normalizeSiteToMatchPattern(rule.site));
  } catch {
    return false;
  }
}

function configHasRuleForUrl(config, url) {
  if (!url) return false;
  return [...config.cssRules, ...config.jsRules].some(rule => ruleMatchesUrl(rule, url));
}

async function getConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY] || DEFAULT_CONFIG);
}

async function setIconForTab(tabId, url, config = null) {
  if (!Number.isInteger(tabId)) return;
  const currentConfig = config || await getConfig();
  const active = configHasRuleForUrl(currentConfig, url || "");

  try {
    await chrome.action.setIcon({
      tabId,
      path: active ? ACTION_ICONS.active : ACTION_ICONS.inactive
    });
    await chrome.action.setTitle({
      tabId,
      title: active
        ? "Site Rule Runner — rules active on this site"
        : "Site Rule Runner — no active rules on this site"
    });
  } catch {
    // Some internal browser pages do not allow per-tab action updates.
  }
}

async function updateAllTabIcons(config = null) {
  const currentConfig = config || await getConfig();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map(tab => setIconForTab(tab.id, tab.url || tab.pendingUrl || "", currentConfig))
  );
}

function makeRegisteredScript(rule) {
  const code = String(rule.code || "");
  const wrappedCode = `(() => {\n  try {\n${code}\n  } catch (error) {\n    console.error('[Site Rule Runner]', error);\n  }\n})();`;

  return {
    id: `${SCRIPT_PREFIX}${String(rule.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    matches: [normalizeSiteToMatchPattern(rule.site)],
    js: [{ code: wrappedCode }],
    runAt: "document_idle",
    world: "MAIN"
  };
}

async function userScriptsAvailable() {
  try {
    if (!chrome.userScripts) return false;
    await chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

async function syncUserScripts() {
  if (!(await userScriptsAvailable())) return;

  const config = await getConfig();
  const existing = await chrome.userScripts.getScripts();
  const ours = existing.filter(script => script.id.startsWith(SCRIPT_PREFIX));
  if (ours.length) {
    await chrome.userScripts.unregister({ ids: ours.map(script => script.id) });
  }

  const scripts = [];
  for (const rule of config.jsRules) {
    if (rule && rule.enabled !== false && rule.id && rule.site && typeof rule.code === "string" && rule.code.trim()) {
      try {
        scripts.push(makeRegisteredScript(rule));
      } catch (error) {
        console.warn("Skipping invalid Site Rule Runner JS rule:", rule, error);
      }
    }
  }

  if (scripts.length) {
    await chrome.userScripts.register(scripts);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(STORAGE_KEY);
  if (!current[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_CONFIG });
  }
  await syncUserScripts();
  await updateAllTabIcons();
});

chrome.runtime.onStartup.addListener(() => {
  syncUserScripts().catch(console.error);
  updateAllTabIcons().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    const config = normalizeConfig(changes[STORAGE_KEY].newValue || DEFAULT_CONFIG);
    syncUserScripts().catch(console.error);
    updateAllTabIcons(config).catch(console.error);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setIconForTab(tabId, tab.url || tab.pendingUrl || "");
  } catch {
    // Tab may have closed before it could be read.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    setIconForTab(tabId, changeInfo.url || tab.url || tab.pendingUrl || "").catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SRR_GET_JS_STATUS") {
    userScriptsAvailable()
      .then(available => sendResponse({ available }))
      .catch(error => sendResponse({ available: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SRR_SYNC_JS") {
    syncUserScripts()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "SRR_PAGE_URL" && sender.tab?.id != null) {
    setIconForTab(sender.tab.id, String(message.url || sender.tab.url || ""))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});
