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
    } catch {
      $("currentSite").textContent = currentUrl;
    }
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
  const title = $("cssTitle").value.trim();
  const pattern = $("cssWebsite").value.trim();
  const selector = SiteRuleUtils.normalizeSelector($("cssSelector").value);
  if (!pattern || !selector) return;
  config.cssRules.push({ id: SiteRuleUtils.makeId("css"), title, pattern, selector, enabled: true });
  config = await SiteRuleUtils.saveConfig(config);
  $("cssTitle").value = "";
  $("cssSelector").value = "";
}

async function addJs() {
  const title = $("jsTitle").value.trim();
  const pattern = $("jsWebsite").value.trim();
  const code = $("jsCode").value;
  if (!pattern || !code.trim()) return;
  const rule = { id: SiteRuleUtils.makeId("js"), title, pattern, code, enabled: true };
  config.jsRules.push(rule);
  config = await SiteRuleUtils.saveConfig(config);
  $("jsTitle").value = "";
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
    const head = document.createElement("div");
    head.className = "rule-head";
    const titleWrap = document.createElement("div");
    titleWrap.style.minWidth = "0";
    const title = document.createElement("div");
    title.className = "rule-title";
    title.textContent = rule.title || (type === "css" ? rule.selector : "Untitled JavaScript rule");
    const sub = document.createElement("div");
    sub.className = "rule-sub";
    sub.textContent = type === "css" ? `${rule.selector} — ${rule.pattern}` : rule.pattern;
    titleWrap.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "actions";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = rule.enabled;
    cb.addEventListener("change", async () => {
      rule.enabled = cb.checked;
      config = await SiteRuleUtils.saveConfig(config);
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);
    actions.append(toggle);

    if (type === "js") {
      const run = document.createElement("button");
      run.className = "btn small";
      run.textContent = "Run";
      run.title = "Run this JavaScript immediately on matching open tabs";
      run.addEventListener("click", async () => {
        run.disabled = true;
        const original = run.textContent;
        run.textContent = "…";
        const result = await runJsNow(rule.pattern, rule.code);
        $("jsStatus").textContent = result.message || "";
        $("jsStatus").className = `status ${result.ok ? "good" : "bad"}`;
        run.textContent = original;
        run.disabled = false;
      });
      actions.append(run);
    }

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      const list = type === "css" ? config.cssRules : config.jsRules;
      const i = list.findIndex(r => r.id === rule.id);
      if (i >= 0) list.splice(i, 1);
      config = await SiteRuleUtils.saveConfig(config);
    });
    actions.append(del);
    head.append(titleWrap, actions);
    card.append(head);
    root.append(card);
  }
}

async function runJsNow(pattern, code) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "srr-run-js-now", pattern, code });
    return response || { ok: false, message: "The extension did not return a result." };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

async function renderJsStatus() {
  const { jsRuntimeStatus } = await chrome.storage.local.get("jsRuntimeStatus");
  const el = $("jsStatus");
  if (!jsRuntimeStatus) {
    el.textContent = "";
    el.className = "status";
    return;
  }
  el.textContent = jsRuntimeStatus.message || "";
  el.className = `status ${jsRuntimeStatus.ok ? "good" : "bad"}`;
}

function exportConfig() {
  const data = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...config }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "site-rule-runner-config.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    config = await SiteRuleUtils.saveConfig(SiteRuleUtils.normalizeConfig(raw));
  } catch {
    alert("That file is not a valid Site Rule Runner config.");
  }
  event.target.value = "";
}

init();
