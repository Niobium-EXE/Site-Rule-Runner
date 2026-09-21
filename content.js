(() => {
  const STYLE_ID = "site-rule-runner-hidden-elements";
  let lastUrl = location.href;

  async function applyCssRules() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    try {
      const config = await SiteRuleUtils.loadConfig();
      const { cssRules } = SiteRuleUtils.matchingRules(config, location.href);
      const selectors = [...new Set(cssRules.map(r => r.selector).filter(Boolean))];
      style.textContent = selectors.map(selector => `${selector} { display: none !important; visibility: hidden !important; }`).join("\n");
    } catch (_) {
      style.textContent = "";
    }
  }

  applyCssRules();
  document.addEventListener("DOMContentLoaded", applyCssRules, { once: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.cssRules) applyCssRules();
  });

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      applyCssRules();
      chrome.runtime.sendMessage({ type: "srr-url-changed", url: lastUrl }).catch(() => {});
    }
  }, 500);
})();
