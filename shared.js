(() => {
  const DEFAULT_CONFIG = Object.freeze({ cssRules: [], jsRules: [] });

  function makeId(prefix = "rule") {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cleanPattern(value) {
    let pattern = String(value || "").trim();
    if (!pattern) return "";
    if (pattern === "<all_urls>") return pattern;
    if (/^[a-z*]+:\/\//i.test(pattern)) {
      const schemeEnd = pattern.indexOf("://") + 3;
      const afterScheme = pattern.slice(schemeEnd);
      if (!afterScheme.includes("/")) pattern += "/*";
      return pattern;
    }
    pattern = pattern.replace(/^\/+/, "");
    const slash = pattern.indexOf("/");
    const host = slash === -1 ? pattern : pattern.slice(0, slash);
    const path = slash === -1 ? "/*" : `/${pattern.slice(slash + 1) || "*"}`;
    return `*://${host}${path}`;
  }

  function chromeMatchPattern(value) {
    const pattern = cleanPattern(value);
    if (!pattern) return null;
    if (pattern === "<all_urls>") return pattern;
    const m = pattern.match(/^([a-z*]+):\/\/([^/]+)(\/.*)$/i);
    if (!m) return null;
    let [, scheme, host, path] = m;
    scheme = scheme.toLowerCase();
    if (!/^(\*|http|https|file|ftp)$/.test(scheme)) return null;
    if (scheme === "file") return `file://${path}`;
    if (!host) return null;
    if (!path.startsWith("/")) path = `/${path}`;
    return `${scheme}://${host}${path}`;
  }

  function wildcardToRegex(text) {
    return String(text)
      .split("*")
      .map(part => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
      .join(".*");
  }

  function patternMatchesUrl(rawPattern, rawUrl) {
    const pattern = chromeMatchPattern(rawPattern);
    if (!pattern || !rawUrl) return false;
    if (pattern === "<all_urls>") return /^(https?|file):/i.test(rawUrl);
    let url;
    try { url = new URL(rawUrl); } catch { return false; }

    const m = pattern.match(/^([a-z*]+):\/\/([^/]*)(\/.*)$/i);
    if (!m) return false;
    const [, schemePattern, hostPattern, pathPattern] = m;

    if (schemePattern !== "*" && url.protocol.slice(0, -1) !== schemePattern) return false;
    if (schemePattern === "*" && !["http:", "https:"].includes(url.protocol)) return false;

    if (url.protocol !== "file:") {
      const hostname = url.hostname.toLowerCase();
      const host = hostPattern.toLowerCase();
      if (host === "*") {
        // any host
      } else if (host.startsWith("*.")) {
        const base = host.slice(2);
        if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
      } else if (host.includes("*")) {
        const re = new RegExp(`^${wildcardToRegex(host)}$`, "i");
        if (!re.test(hostname)) return false;
      } else if (hostname !== host) {
        return false;
      }
    }

    const targetPath = `${url.pathname}${url.search}${url.hash}`;
    return new RegExp(`^${wildcardToRegex(pathPattern)}$`, "i").test(targetPath) ||
      new RegExp(`^${wildcardToRegex(pathPattern)}$`, "i").test(url.pathname);
  }

  function normalizeSelector(input) {
    const selector = String(input || "").trim();
    if (!selector) return "";
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(selector)) return `.${selector}`;
    return selector;
  }

  function normalizeTitle(rule = {}) {
    return String(rule.title ?? rule.name ?? rule.label ?? "").trim();
  }

  function normalizeCssRule(rule = {}) {
    return {
      id: String(rule.id || makeId("css")),
      title: normalizeTitle(rule),
      pattern: String(rule.pattern ?? rule.website ?? rule.site ?? rule.url ?? "").trim(),
      selector: normalizeSelector(rule.selector ?? rule.cssClass ?? rule.className ?? rule.css ?? ""),
      enabled: rule.enabled !== false
    };
  }

  function normalizeJsRule(rule = {}) {
    return {
      id: String(rule.id || makeId("js")),
      title: normalizeTitle(rule),
      pattern: String(rule.pattern ?? rule.website ?? rule.site ?? rule.url ?? "").trim(),
      code: String(rule.code ?? rule.javascript ?? rule.js ?? ""),
      enabled: rule.enabled !== false
    };
  }

  function normalizeConfig(raw = {}) {
    let cssRules = raw.cssRules ?? raw.hideRules ?? raw.css ?? [];
    let jsRules = raw.jsRules ?? raw.javascriptRules ?? raw.javascript ?? raw.js ?? [];

    if (Array.isArray(raw.rules)) {
      cssRules = cssRules.length ? cssRules : raw.rules.filter(r => (r.type || "").toLowerCase() === "css");
      jsRules = jsRules.length ? jsRules : raw.rules.filter(r => ["js", "javascript"].includes((r.type || "").toLowerCase()));
    }

    if (!Array.isArray(cssRules)) cssRules = [];
    if (!Array.isArray(jsRules)) jsRules = [];

    return {
      cssRules: cssRules.map(normalizeCssRule).filter(r => r.pattern && r.selector),
      jsRules: jsRules.map(normalizeJsRule).filter(r => r.pattern && r.code.trim())
    };
  }

  async function loadConfig() {
    const stored = await chrome.storage.local.get(["cssRules", "jsRules"]);
    return normalizeConfig({
      cssRules: stored.cssRules || [],
      jsRules: stored.jsRules || []
    });
  }

  async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    await chrome.storage.local.set(normalized);
    return normalized;
  }

  function matchingRules(config, url) {
    return {
      cssRules: config.cssRules.filter(r => r.enabled && patternMatchesUrl(r.pattern, url)),
      jsRules: config.jsRules.filter(r => r.enabled && patternMatchesUrl(r.pattern, url))
    };
  }

  globalThis.SiteRuleUtils = {
    DEFAULT_CONFIG,
    makeId,
    cleanPattern,
    chromeMatchPattern,
    patternMatchesUrl,
    normalizeSelector,
    normalizeCssRule,
    normalizeJsRule,
    normalizeConfig,
    loadConfig,
    saveConfig,
    matchingRules
  };
})();
