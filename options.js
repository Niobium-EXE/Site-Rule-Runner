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
  $("runNow").addEventListener("click", runEditorNow);
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
  const rules = config.cssRules.filter(r => !cssQuery || `${r.title} ${r.pattern} ${r.selector}`.toLowerCase().includes(cssQuery));
  renderEditorList($("allCssRules"), rules, "css");
}

function renderJs() {
  const rules = config.jsRules.filter(r => !jsQuery || `${r.title} ${r.pattern} ${r.code}`.toLowerCase().includes(jsQuery));
  renderEditorList($("allJsRules"), rules, "js");
}

function renderEditorList(root, rules, type) {
  root.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = type === "css" ? "No CSS hide rules found." : "No JavaScript rules found.";
    root.append(empty);
    return;
  }

  for (const rule of rules) {
    const card = document.createElement("article");
    card.className = `editor-card${rule.enabled ? "" : " off"}`;

    const top = document.createElement("div");
    top.className = "editor-top";

    const info = document.createElement("div");
    info.className = "editor-info";
    const title = document.createElement("div");
    title.className = "editor-title";
    title.textContent = rule.title || (type === "css" ? rule.selector : "Untitled JavaScript rule");
    const site = document.createElement("div");
    site.className = "editor-site";
    site.textContent = rule.pattern;
    const val = document.createElement("div");
    val.className = "editor-value";
    val.textContent = type === "css" ? rule.selector : rule.code;
    info.append(title, site, val);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    toggle.title = rule.enabled ? "Disable rule" : "Enable rule";
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

    if (type === "js") {
      const run = document.createElement("button");
      run.className = "btn small";
      run.textContent = "Run now";
      run.title = "Execute this saved rule immediately on matching open tabs";
      run.addEventListener("click", async () => {
        run.disabled = true;
        const original = run.textContent;
        run.textContent = "Running…";
        const result = await runJsNow(rule.pattern, rule.code);
        run.textContent = result.ok ? (result.ran ? `Ran on ${result.ran}` : "No open match") : "Run failed";
        setTimeout(() => { run.textContent = original; run.disabled = false; }, 1600);
      });
      actions.append(run);
    }

    const edit = document.createElement("button");
    edit.className = "btn small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(type, rule));

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteRule(type, rule.id));

    actions.prepend(toggle);
    actions.append(edit, del);
    top.append(info, actions);
    card.append(top);
    root.append(card);
  }
}

function openEditor(type, rule = null) {
  $("editType").value = type;
  $("editId").value = rule?.id || "";
  $("editTitle").value = rule?.title || "";
  $("editPattern").value = rule?.pattern || "";
  $("editSelector").value = type === "css" ? (rule?.selector || "") : "";
  $("editCode").value = type === "js" ? (rule?.code || "") : "";
  $("editEnabled").checked = rule?.enabled !== false;
  $("editApplyNow").checked = true;
  $("selectorField").classList.toggle("hidden", type !== "css");
  $("codeField").classList.toggle("hidden", type !== "js");
  $("liveField").classList.toggle("hidden", type !== "js");
  $("dialogTitle").textContent = `${rule ? "Edit" : "New"} ${type === "css" ? "CSS hide" : "JavaScript"} rule`;
  $("dialogHelp").textContent = type === "css"
    ? "Hide matching page elements on the selected website."
    : "Edit, test, and save JavaScript for matching pages.";
  setLiveStatus("");
  $("ruleDialog").showModal();
}

function validatePattern() {
  const pattern = $("editPattern").value.trim();
  if (!pattern || !SiteRuleUtils.chromeMatchPattern(pattern)) {
    $("editPattern").setCustomValidity("Enter a valid website or match pattern.");
    $("editPattern").reportValidity();
    $("editPattern").setCustomValidity("");
    return null;
  }
  return pattern;
}

async function onRuleSubmit(event) {
  event.preventDefault();
  const type = $("editType").value;
  const id = $("editId").value;
  const title = $("editTitle").value.trim();
  const pattern = validatePattern();
  if (!pattern) return;

  if (type === "css") {
    const selector = SiteRuleUtils.normalizeSelector($("editSelector").value);
    if (!selector) {
      $("editSelector").focus();
      return;
    }
    const existing = config.cssRules.find(r => r.id === id);
    if (existing) Object.assign(existing, { title, pattern, selector, enabled: $("editEnabled").checked });
    else config.cssRules.push({ id: SiteRuleUtils.makeId("css"), title, pattern, selector, enabled: $("editEnabled").checked });
    config = await SiteRuleUtils.saveConfig(config);
    $("ruleDialog").close();
    return;
  }

  const code = $("editCode").value;
  if (!code.trim()) {
    $("editCode").focus();
    return;
  }
  const enabled = $("editEnabled").checked;
  const existing = config.jsRules.find(r => r.id === id);
  if (existing) Object.assign(existing, { title, pattern, code, enabled });
  else config.jsRules.push({ id: SiteRuleUtils.makeId("js"), title, pattern, code, enabled });
  config = await SiteRuleUtils.saveConfig(config);

  if (enabled && $("editApplyNow").checked) {
    setLiveStatus("Applying saved code to matching open tabs…");
    const result = await runJsNow(pattern, code);
    setLiveStatus(result.message, result.ok ? "good" : "bad");
    if (!result.ok) return;
  }

  $("ruleDialog").close();
}

async function runEditorNow() {
  const pattern = validatePattern();
  const code = $("editCode").value;
  if (!pattern || !code.trim()) {
    if (!code.trim()) $("editCode").focus();
    return;
  }
  const button = $("runNow");
  button.disabled = true;
  setLiveStatus("Running current editor code on matching open tabs…");
  const result = await runJsNow(pattern, code);
  setLiveStatus(result.message, result.ok ? "good" : "bad");
  button.disabled = false;
}

async function runJsNow(pattern, code) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "srr-run-js-now", pattern, code });
    return response || { ok: false, ran: 0, message: "The extension did not return a result." };
  } catch (error) {
    return { ok: false, ran: 0, message: error?.message || String(error) };
  }
}

function setLiveStatus(message, state = "") {
  const el = $("liveStatus");
  el.textContent = message;
  el.className = `live-status${state ? ` ${state}` : ""}`;
}

async function deleteRule(type, id) {
  const list = type === "css" ? config.cssRules : config.jsRules;
  const rule = list.find(r => r.id === id);
  const label = rule?.title ? `“${rule.title}”` : rule?.pattern;
  if (!rule || !confirm(`Delete ${label || "this rule"}?`)) return;
  const i = list.findIndex(r => r.id === id);
  if (i >= 0) list.splice(i, 1);
  config = await SiteRuleUtils.saveConfig(config);
}

async function renderRuntimeStatus() {
  const { jsRuntimeStatus } = await chrome.storage.local.get("jsRuntimeStatus");
  const el = $("jsRuntimeStatus");
  if (!jsRuntimeStatus) {
    el.className = "runtime-card";
    el.textContent = "JavaScript runtime status has not been checked yet.";
    return;
  }
  el.className = `runtime-card ${jsRuntimeStatus.ok ? "good" : "bad"}`;
  el.textContent = jsRuntimeStatus.message;
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
    const imported = SiteRuleUtils.normalizeConfig(raw);
    if (!confirm(`Replace the current rules with ${imported.cssRules.length} CSS rule(s) and ${imported.jsRules.length} JavaScript rule(s)?`)) return;
    config = await SiteRuleUtils.saveConfig(imported);
  } catch {
    alert("That file is not a valid Site Rule Runner config.");
  } finally {
    event.target.value = "";
  }
}

async function deleteAll() {
  if (!confirm("Delete every CSS and JavaScript rule? This cannot be undone unless you exported a backup.")) return;
  config = await SiteRuleUtils.saveConfig({ cssRules: [], jsRules: [] });
}

init();
