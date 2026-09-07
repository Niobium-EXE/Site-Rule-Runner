const STORAGE_KEY = "siteRuleRunnerConfig";
const DEFAULT_CONFIG = { version: 1, cssRules: [], jsRules: [] };

let config = structuredClone(DEFAULT_CONFIG);
let toastTimer;

const $ = selector => document.querySelector(selector);
const cssRulesEl = $("#css-rules");
const jsRulesEl = $("#js-rules");

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanConfig(input) {
  if (!input || typeof input !== "object") throw new Error("Config must be a JSON object.");
  const cssRules = Array.isArray(input.cssRules) ? input.cssRules : [];
  const jsRules = Array.isArray(input.jsRules) ? input.jsRules : [];

  return {
    version: 1,
    cssRules: cssRules.map(rule => ({
      id: String(rule.id || uid()),
      site: String(rule.site || "").trim(),
      selector: String(rule.selector || "").trim(),
      enabled: rule.enabled !== false
    })).filter(rule => rule.site && rule.selector),
    jsRules: jsRules.map(rule => ({
      id: String(rule.id || uid()),
      site: String(rule.site || "").trim(),
      code: String(rule.code || ""),
      enabled: rule.enabled !== false
    })).filter(rule => rule.site && rule.code.trim())
  };
}

async function load() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  config = cleanConfig(stored[STORAGE_KEY] || DEFAULT_CONFIG);
  render();
  checkJsStatus();
}

async function save(message = "Saved") {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  render();
  showToast(message);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}

function makeRuleCard(rule, type) {
  const card = document.createElement("div");
  card.className = "rule-card" + (rule.enabled === false ? " disabled" : "");

  const top = document.createElement("div");
  top.className = "rule-top";

  const main = document.createElement("div");
  main.className = "rule-main";

  const site = document.createElement("div");
  site.className = "rule-site";
  site.textContent = rule.site;

  const value = document.createElement("div");
  value.className = "rule-value" + (type === "js" ? " code" : "");
  value.textContent = type === "css" ? rule.selector : rule.code;

  main.append(site, value);

  const actions = document.createElement("div");
  actions.className = "rule-actions";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "toggle";
  toggle.checked = rule.enabled !== false;
  toggle.title = toggle.checked ? "Disable rule" : "Enable rule";
  toggle.addEventListener("change", async () => {
    rule.enabled = toggle.checked;
    await save(rule.enabled ? "Rule enabled" : "Rule disabled");
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    const collection = type === "css" ? config.cssRules : config.jsRules;
    const index = collection.findIndex(item => item.id === rule.id);
    if (index !== -1) collection.splice(index, 1);
    await save("Rule deleted");
  });

  actions.append(toggle, remove);
  top.append(main, actions);
  card.append(top);
  return card;
}

function render() {
  cssRulesEl.replaceChildren(...config.cssRules.map(rule => makeRuleCard(rule, "css")));
  jsRulesEl.replaceChildren(...config.jsRules.map(rule => makeRuleCard(rule, "js")));
  $("#css-count").textContent = config.cssRules.length;
  $("#js-count").textContent = config.jsRules.length;
  $("#css-empty").classList.toggle("hidden", config.cssRules.length > 0);
  $("#js-empty").classList.toggle("hidden", config.jsRules.length > 0);
}

async function checkJsStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "SRR_GET_JS_STATUS" });
    $("#js-warning").classList.toggle("hidden", Boolean(response?.available));
  } catch {
    $("#js-warning").classList.remove("hidden");
  }
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
    $("#css-panel").classList.toggle("active", tab.dataset.tab === "css");
    $("#js-panel").classList.toggle("active", tab.dataset.tab === "js");
    if (tab.dataset.tab === "js") checkJsStatus();
  });
});

$("#css-form").addEventListener("submit", async event => {
  event.preventDefault();
  const site = $("#css-site").value.trim();
  const selector = $("#css-selector").value.trim();
  if (!site || !selector) return;

  config.cssRules.push({ id: uid(), site, selector, enabled: true });
  $("#css-selector").value = "";
  await save("Hide rule added");
});

$("#js-form").addEventListener("submit", async event => {
  event.preventDefault();
  const site = $("#js-site").value.trim();
  const code = $("#js-code").value;
  if (!site || !code.trim()) return;

  config.jsRules.push({ id: uid(), site, code, enabled: true });
  $("#js-code").value = "";
  await save("JavaScript rule added");
  setTimeout(checkJsStatus, 100);
});

$("#export-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `site-rule-runner-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Config exported");
});

$("#import-button").addEventListener("click", () => $("#import-file").click());

$("#import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    config = cleanConfig(parsed);
    await save("Config imported");
    await chrome.runtime.sendMessage({ type: "SRR_SYNC_JS" }).catch(() => {});
    checkJsStatus();
  } catch (error) {
    showToast(`Import failed: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});

load().catch(error => showToast(`Could not load: ${error.message}`));
