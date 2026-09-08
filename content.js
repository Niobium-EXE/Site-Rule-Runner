const STORAGE_KEY = "siteRuleRunnerConfig";
const STYLE_ID = "site-rule-runner-hidden-elements";

function normalizeSiteToMatchPattern(site) {
  let raw = String(site || "").trim();
  if (!raw) return null;
  if (raw === "<all_urls>") return "<all_urls>";

  if (/^(\*|http|https|file|ftp):\/\//i.test(raw)) {
    if (!raw.includes("/", raw.indexOf("://") + 3)) raw += "/*";
    return raw;
  }

  raw = raw.replace(/^\/+/, "");
  const slash = raw.indexOf("/");
  const host = slash === -1 ? raw : raw.slice(0, slash);
  let path = slash === -1 ? "/*" : raw.slice(slash);
  if (!path.includes("*")) path += "*";
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

function normalizeSelector(input) {
  const selector = String(input || "").trim();
  if (!selector) return null;

  // A simple bare token is treated as a class name for convenience.
  if (/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(selector)) return `.${selector}`;
  return selector;
}

function notifyCurrentUrl() {
  chrome.runtime.sendMessage({ type: "SRR_PAGE_URL", url: location.href }).catch(() => {});
}

async function applyCssRules() {
  notifyCurrentUrl();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY] || {};
  const rules = Array.isArray(config.cssRules) ? config.cssRules : [];

  const selectors = [];
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    const pattern = normalizeSiteToMatchPattern(rule.site);
    if (!matchesPattern(location.href, pattern)) continue;
    const selector = normalizeSelector(rule.selector);
    if (selector) selectors.push(selector);
  }

  let style = document.getElementById(STYLE_ID);
  if (!selectors.length) {
    style?.remove();
    return;
  }

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.documentElement || document.head || document).appendChild(style);
  }

  // One bad selector should not prevent valid selectors from working.
  const validRules = [];
  for (const selector of [...new Set(selectors)]) {
    try {
      document.querySelector(selector);
      validRules.push(`${selector} { display: none !important; }`);
    } catch {
      console.warn("[Site Rule Runner] Invalid CSS selector:", selector);
    }
  }
  style.textContent = validRules.join("\n");
}

applyCssRules().catch(console.error);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    applyCssRules().catch(console.error);
  }
});

// SPA navigation can change the URL without reloading the content script.
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    applyCssRules().catch(console.error);
  }
});
observer.observe(document, { subtree: true, childList: true });
window.addEventListener("popstate", () => applyCssRules().catch(console.error));
window.addEventListener("hashchange", () => applyCssRules().catch(console.error));
