const $ = id => document.getElementById(id);
let config = { cssRules: [], jsRules: [] };
let currentUrl = "";

async function init() {
  config = await SiteRuleUtils.loadConfig();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab?.url || "";
  if (currentUrl) {
    try {
      const u = new URL(currentUrl);
      $("currentSite").textContent = u.hostname || currentUrl;
      $("cssWebsite").value = u.hostname;
      $("jsWebsite").value = u.hostname;
    } catch { $("currentSite").textContent = currentUrl; }
  }
  bind();
  render();
  renderJsStatus();
}

function bind() {
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    $("cssTab").classList.toggle("hidden", btn.dataset.tab !== "css");
    $("jsTab").classList.toggle("hidden", btn.dataset.tab !== "js");
  }));
  $("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("addCss").addEventListener("click", addCss);
  $("addJs").addEventListener("click", addJs);
  $("exportConfig").addEventListener("click", exportConfig);
  $("importConfig").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", importConfig);
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && (changes.cssRules || changes.jsRules)) {
      config = await SiteRuleUtils.loadConfig();
      render();
    }
    if (area === "local" && changes.jsRuntimeStatus) renderJsStatus();
  });
}

async function addCss() {
  const pattern = $("cssWebsite").value.trim();
  const selector = SiteRuleUtils.normalizeSelector($("cssSelector").value);
  if (!pattern || !selector) return;
  config.cssRules.push({ id: SiteRuleUtils.makeId("css"), pattern, selector, enabled: true });
  await SiteRuleUtils.saveConfig(config);
  $("cssSelector").value = "";
}

async function addJs() {
  const pattern = $("jsWebsite").value.trim();
  const code = $("jsCode").value;
  if (!pattern || !code.trim()) return;
  config.jsRules.push({ id: SiteRuleUtils.makeId("js"), pattern, code, enabled: true });
  await SiteRuleUtils.saveConfig(config);
  $("jsCode").value = "";
}

function rulesForCurrent(list) {
  return list.filter(r => SiteRuleUtils.patternMatchesUrl(r.pattern, currentUrl));
}

function render() {
  renderRules("cssRules", rulesForCurrent(config.cssRules), "css");
  renderRules("jsRules", rulesForCurrent(config.jsRules), "js");
}

function renderRules(containerId, rules, type) {
  const root = $(containerId);
  root.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No rules for the current site.";
    root.append(empty);
    return;
  }
  for (const rule of rules) {
    const card = document.createElement("div");
    card.className = `rule-card${rule.enabled ? "" : " off"}`;
    const head = document.createElement("div"); head.className = "rule-head";
    const titleWrap = document.createElement("div"); titleWrap.style.minWidth = "0";
    const title = document.createElement("div"); title.className = "rule-title"; title.textContent = type === "css" ? rule.selector : "JavaScript rule";
    const sub = document.createElement("div"); sub.className = "rule-sub"; sub.textContent = rule.pattern;
    titleWrap.append(title, sub);
    const actions = document.createElement("div"); actions.className = "actions";
    const toggle = document.createElement("label"); toggle.className = "toggle";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = rule.enabled;
    cb.addEventListener("change", async () => { rule.enabled = cb.checked; await SiteRuleUtils.saveConfig(config); });
    const slider = document.createElement("span"); slider.className = "slider"; toggle.append(cb, slider);
    const del = document.createElement("button"); del.className = "btn small danger"; del.textContent = "Delete";
    del.addEventListener("click", async () => {
      const list = type === "css" ? config.cssRules : config.jsRules;
      const i = list.findIndex(r => r.id === rule.id); if (i >= 0) list.splice(i, 1);
      await SiteRuleUtils.saveConfig(config);
    });
    actions.append(toggle, del); head.append(titleWrap, actions); card.append(head); root.append(card);
  }
}

async function renderJsStatus() {
  const { jsRuntimeStatus } = await chrome.storage.local.get("jsRuntimeStatus");
  const el = $("jsStatus");
  if (!jsRuntimeStatus) { el.textContent = ""; el.className = "status"; return; }
  el.textContent = jsRuntimeStatus.message || "";
  el.className = `status ${jsRuntimeStatus.ok ? "good" : "bad"}`;
}

function exportConfig() {
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...config }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "site-rule-runner-config.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importConfig(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    config = SiteRuleUtils.normalizeConfig(raw);
    await SiteRuleUtils.saveConfig(config);
  } catch { alert("That file is not a valid Site Rule Runner config."); }
  event.target.value = "";
}

init();
