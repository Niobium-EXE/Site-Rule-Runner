const $ = id => document.getElementById(id);
let config = { cssRules: [], jsRules: [] };
let cssQuery = "";
let jsQuery = "";

async function init() {
  config = await SiteRuleUtils.loadConfig();
  bind();
  render();
  renderRuntimeStatus();
}

function bind() {
  document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  $("newCss").addEventListener("click", () => openEditor("css"));
  $("newJs").addEventListener("click", () => openEditor("js"));
  $("cssSearch").addEventListener("input", e => { cssQuery = e.target.value.toLowerCase(); renderCss(); });
  $("jsSearch").addEventListener("input", e => { jsQuery = e.target.value.toLowerCase(); renderJs(); });
  $("ruleForm").addEventListener("submit", onRuleSubmit);
  $("closeDialog").addEventListener("click", () => $("ruleDialog").close());
  $("cancelDialog").addEventListener("click", () => $("ruleDialog").close());
  $("optionsExport").addEventListener("click", exportConfig);
  $("optionsImport").addEventListener("click", () => $("optionsFile").click());
  $("optionsFile").addEventListener("change", importConfig);
  $("deleteAll").addEventListener("click", deleteAll);
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.cssRules || changes.jsRules) {
      config = await SiteRuleUtils.loadConfig();
      render();
    }
    if (changes.jsRuntimeStatus) renderRuntimeStatus();
  });
}

function showSection(name) {
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".section").forEach(s => s.classList.add("hidden"));
  $(`section-${name}`).classList.remove("hidden");
}

function render() {
  $("cssCount").textContent = config.cssRules.length;
  $("jsCount").textContent = config.jsRules.length;
  renderCss();
  renderJs();
}

function renderCss() {
  const rules = config.cssRules.filter(r => !cssQuery || `${r.pattern} ${r.selector}`.toLowerCase().includes(cssQuery));
  renderEditorList($("allCssRules"), rules, "css");
}
function renderJs() {
  const rules = config.jsRules.filter(r => !jsQuery || `${r.pattern} ${r.code}`.toLowerCase().includes(jsQuery));
  renderEditorList($("allJsRules"), rules, "js");
}

function renderEditorList(root, rules, type) {
  root.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement("div"); empty.className = "empty";
    empty.textContent = type === "css" ? "No CSS hide rules found." : "No JavaScript rules found.";
    root.append(empty); return;
  }
  for (const rule of rules) {
    const card = document.createElement("article"); card.className = `editor-card${rule.enabled ? "" : " off"}`;
    const top = document.createElement("div"); top.className = "editor-top";
    const info = document.createElement("div");
    const site = document.createElement("div"); site.className = "editor-site"; site.textContent = rule.pattern;
    const val = document.createElement("div"); val.className = "editor-value"; val.textContent = type === "css" ? rule.selector : rule.code;
    info.append(site, val);
    const actions = document.createElement("div"); actions.className = "card-actions";
    const toggle = document.createElement("label"); toggle.className = "toggle";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = rule.enabled;
    cb.addEventListener("change", async () => { rule.enabled = cb.checked; await SiteRuleUtils.saveConfig(config); });
    const slider = document.createElement("span"); slider.className = "slider"; toggle.append(cb, slider);
    const edit = document.createElement("button"); edit.className = "btn small"; edit.textContent = "Edit"; edit.addEventListener("click", () => openEditor(type, rule));
    const del = document.createElement("button"); del.className = "btn small danger"; del.textContent = "Delete"; del.addEventListener("click", () => deleteRule(type, rule.id));
    actions.append(toggle, edit, del); top.append(info, actions); card.append(top); root.append(card);
  }
}

function openEditor(type, rule = null) {
  $("editType").value = type;
  $("editId").value = rule?.id || "";
  $("editPattern").value = rule?.pattern || "";
  $("editSelector").value = type === "css" ? (rule?.selector || "") : "";
  $("editCode").value = type === "js" ? (rule?.code || "") : "";
  $("editEnabled").checked = rule?.enabled !== false;
  $("selectorField").classList.toggle("hidden", type !== "css");
  $("codeField").classList.toggle("hidden", type !== "js");
  $("dialogTitle").textContent = `${rule ? "Edit" : "New"} ${type === "css" ? "CSS hide" : "JavaScript"} rule`;
  $("dialogHelp").textContent = type === "css" ? "Hide matching page elements on the selected website." : "Run JavaScript when a matching page loads.";
  $("ruleDialog").showModal();
}

async function onRuleSubmit(event) {
  event.preventDefault();
  const type = $("editType").value;
  const id = $("editId").value;
  const pattern = $("editPattern").value.trim();
  if (!pattern || !SiteRuleUtils.chromeMatchPattern(pattern)) {
    $("editPattern").setCustomValidity("Enter a valid website or match pattern.");
    $("editPattern").reportValidity();
    $("editPattern").setCustomValidity("");
    return;
  }

  if (type === "css") {
    const selector = SiteRuleUtils.normalizeSelector($("editSelector").value);
    if (!selector) return;
    const existing = config.cssRules.find(r => r.id === id);
    if (existing) Object.assign(existing, { pattern, selector, enabled: $("editEnabled").checked });
    else config.cssRules.push({ id: SiteRuleUtils.makeId("css"), pattern, selector, enabled: $("editEnabled").checked });
  } else {
    const code = $("editCode").value;
    if (!code.trim()) return;
    const existing = config.jsRules.find(r => r.id === id);
    if (existing) Object.assign(existing, { pattern, code, enabled: $("editEnabled").checked });
    else config.jsRules.push({ id: SiteRuleUtils.makeId("js"), pattern, code, enabled: $("editEnabled").checked });
  }
  await SiteRuleUtils.saveConfig(config);
  $("ruleDialog").close();
}

async function deleteRule(type, id) {
  const list = type === "css" ? config.cssRules : config.jsRules;
  const rule = list.find(r => r.id === id);
  if (!rule || !confirm(`Delete this ${type === "css" ? "CSS" : "JavaScript"} rule for ${rule.pattern}?`)) return;
  const i = list.findIndex(r => r.id === id); if (i >= 0) list.splice(i, 1);
  await SiteRuleUtils.saveConfig(config);
}

async function renderRuntimeStatus() {
  const { jsRuntimeStatus } = await chrome.storage.local.get("jsRuntimeStatus");
  const el = $("jsRuntimeStatus");
  if (!jsRuntimeStatus) { el.className = "runtime-card"; el.textContent = "JavaScript runtime status has not been checked yet."; return; }
  el.className = `runtime-card ${jsRuntimeStatus.ok ? "good" : "bad"}`;
  el.textContent = jsRuntimeStatus.message;
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
    const imported = SiteRuleUtils.normalizeConfig(raw);
    if (!confirm(`Replace the current rules with ${imported.cssRules.length} CSS rule(s) and ${imported.jsRules.length} JavaScript rule(s)?`)) return;
    config = imported;
    await SiteRuleUtils.saveConfig(config);
  } catch { alert("That file is not a valid Site Rule Runner config."); }
  finally { event.target.value = ""; }
}

async function deleteAll() {
  if (!confirm("Delete every CSS and JavaScript rule? This cannot be undone unless you exported a backup.")) return;
  config = { cssRules: [], jsRules: [] };
  await SiteRuleUtils.saveConfig(config);
}

init();
