const STORAGE_KEY = "siteRuleRunnerConfig";
const SCRIPT_PREFIX = "srr_js_";

const DEFAULT_CONFIG = {
  version: 1,
  cssRules: [],
  jsRules: []
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

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = normalizeConfig(stored[STORAGE_KEY] || DEFAULT_CONFIG);

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
});

chrome.runtime.onStartup.addListener(() => {
  syncUserScripts().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    syncUserScripts().catch(console.error);
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
});
