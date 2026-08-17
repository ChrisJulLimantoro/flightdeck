const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const STATE_LABEL = {
  yours: "CHANGES REQUESTED",
  recheck: "PUSHED SINCE REVIEW",
  "needs-review": "AWAITING REVIEW",
  theirs: "AWAITING RE-REVIEW",
  "in-review": "IN REVIEW",
  "waiting-author": "AWAITING AUTHOR",
  approved: "APPROVED",
  settled: "SETTLED",
  draft: "DRAFT",
};

const CI_GLYPH = { SUCCESS: "PASS", FAILURE: "FAIL", ERROR: "ERR", PENDING: "RUN", NONE: "—" };

const ui = {
  engine: "claude",
  tab: "mine",
  prs: null,
  skills: [],
  health: null,
  accounts: null,
  thread: null,
  stream: null,
  timer: null,
};

/* ---------- helpers ---------- */

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${path} → ${res.status}`);
  return body;
}

const post = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

function banner(message) {
  const node = $("banner");
  node.hidden = !message;
  node.textContent = message ?? "";
}

const ago = (ms) => {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

const sandboxWarning = () => {
  const codex = ui.health?.codexSandbox;
  if (ui.engine !== "codex" || !codex || codex.ok) return null;
  return `CODEX SANDBOX UNAVAILABLE — ${codex.reason}. FIX: ${codex.fix} — or tick UNSANDBOXED in the “…” dialog.`;
};

/* ---------- board ---------- */

function headRow() {
  const row = el("div", "row head");
  for (const label of ["", "REPO", "TITLE", "STATE", "OPEN", "CI", "AGE", ""]) row.append(el("div", "", label));
  return row;
}

function blockReason(pr) {
  if (!pr.cloned) return `${pr.repo} is not cloned locally`;
  if (ui.engine === "codex" && !pr.codexTrusted) return `${pr.repo} is not a trusted Codex project`;
  return null;
}

function actions(pr) {
  const wrap = el("div", "acts");
  const blocked = blockReason(pr);
  for (const [label, skill] of [["FEEDBACK", "pr-feedback"], ["REVIEW", "pr-review"], ["…", null]]) {
    const button = el("button", "act", label);
    button.disabled = Boolean(blocked);
    button.title = blocked ?? `${ui.engine} · /${skill ?? "choose a skill"}`;
    button.onclick = (event) => {
      event.stopPropagation();
      skill ? launch(pr, { skill }) : openModal(pr);
    };
    wrap.append(button);
  }
  return wrap;
}

function prRow(pr, index) {
  const row = el("div", "row");
  row.dataset.status = pr.status;
  row.style.animationDelay = `${index * 18}ms`;

  const slug = el("div", "slug");
  slug.append(el("b", "", `#${pr.number}`), ` ${pr.repo.split("/")[1]}`);

  const title = el("div", "title");
  const pip = el("span", pr.isNew ? "pip" : "pip hide");
  const link = el("a", "", pr.title);
  link.href = pr.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  title.append(pip, link);

  const open = el("div", pr.unresolvedThreads > 0 ? "num hot" : "num", String(pr.unresolvedThreads));
  const ci = el("div", "ci", CI_GLYPH[pr.ciState] ?? pr.ciState);
  ci.dataset.ci = pr.ciState;

  row.append(
    el("div", "bar"),
    slug,
    title,
    el("div", "state", STATE_LABEL[pr.status] ?? pr.status),
    open,
    ci,
    el("div", "age", ago(pr.lastActivityAt)),
    actions(pr),
  );
  row.onclick = () => markSeen(pr, pip);
  return row;
}

async function markSeen(pr, pip) {
  if (!pr.isNew) return;
  pr.isNew = false;
  pip.classList.add("hide");
  await post("/api/seen", { id: pr.id }).catch(() => {});
}

function renderBoard() {
  const board = $("board");
  board.replaceChildren();
  const list = ui.prs?.[ui.tab] ?? [];
  if (!list.length) return board.append(el("div", "empty-note", "NOTHING HERE. GO WRITE SOME CODE."));
  board.append(headRow(), ...list.map(prRow));
}

async function loadPrs(fresh) {
  try {
    ui.prs = await api(fresh === true ? "/api/prs?fresh" : "/api/prs");
    $("count-mine").textContent = ui.prs.mine.length;
    $("count-reviewed").textContent = ui.prs.reviewed.length;
    $("fetched").textContent = `SYNCED ${new Date(ui.prs.fetchedAt).toLocaleTimeString()}`;
    banner(sandboxWarning());
    renderBoard();
  } catch (error) {
    banner(`PR FETCH FAILED — ${error.message}`);
  }
}

/* ---------- accounts ---------- */

function renderAccounts() {
  const list = $("accounts-list");
  list.replaceChildren();
  for (const account of ui.accounts.accounts) {
    const row = el("div", "account");
    const pick = el("button", "account-pick", account.login);
    pick.classList.toggle("is-active", account.login === ui.accounts.active);
    pick.onclick = () => switchAccount(account.login);
    row.append(pick);
    row.append(el("span", "account-meta", account.source === "gh" ? "gh keyring" : `token ••••${account.tail}`));
    if (account.scopes.length) row.append(el("span", "account-meta", account.scopes.join(" ")));
    if (account.source !== "gh") {
      const remove = el("button", "ghost", "REMOVE");
      remove.onclick = () => applyAccounts(api(`/api/accounts/${account.login}`, { method: "DELETE" }));
      row.append(remove);
    }
    list.append(row);
  }
}

async function applyAccounts(promise) {
  try {
    ui.accounts = await promise;
    $("viewer").textContent = `@${ui.accounts.active}`;
    renderAccounts();
    await loadPrs(true);
  } catch (error) {
    $("accounts-note").textContent = error.message.toUpperCase();
  }
}

const switchAccount = (login) => applyAccounts(post("/api/accounts/active", { login }));

/* ---------- agent strip ---------- */

function chip(session) {
  const node = el("button", "chip");
  node.dataset.status = session.status;
  node.append(el("span", "dot"), el("b", "", session.name));
  if (session.cwd) node.append(session.cwd.split("/").pop());
  if (session.external) node.append(el("span", "ext", "EXT"));
  node.title = session.status === "busy"
    ? "busy in another terminal — opens read-only"
    : `open ${session.id}`;
  node.onclick = () => openSession(session);
  return node;
}

async function loadAgents() {
  try {
    const sessions = (await api("/api/agents"))[ui.engine] ?? [];
    const chips = $("chips");
    chips.replaceChildren();
    if (!sessions.length) return chips.append(el("div", "chip empty", `no live ${ui.engine} sessions`));
    chips.append(...sessions.map(chip));
  } catch {
    /* the strip is decoration; never break the board over it */
  }
}

// A session that is busy in a terminal already has a driver — forking gives it
// its own branch instead of interleaving two of them.
async function openSession(session) {
  try {
    const fork = session.status === "busy" || session.external;
    const thread = await post(`/api/sessions/${ui.engine}/${session.id}/open`, { fork });
    openDrawer(thread, session.name);
    if (fork) banner(`${session.name} is live elsewhere — replies will FORK it into a new branch.`);
  } catch (error) {
    banner(`CANNOT OPEN SESSION — ${error.message}`);
  }
}

/* ---------- threads ---------- */

async function launch(pr, { skill, prompt, mode = "read", approvals = false }) {
  const blocked = blockReason(pr);
  if (blocked) return banner(blocked);
  if (skill === "pr-review" && !confirm(`/pr-review posts review comments to ${pr.repo}#${pr.number}. Continue?`)) return;
  if (mode === "unsandboxed" && !confirm("Unsandboxed means the agent runs shell commands with no isolation. Continue?")) return;
  try {
    const thread = await post("/api/threads", {
      engine: ui.engine,
      skill,
      prompt,
      target: pr.url,
      repo: pr.repo,
      mode,
      approvals,
    });
    openDrawer(thread, `#${pr.number} ${pr.repo}`);
  } catch (error) {
    banner(`LAUNCH FAILED — ${error.message}`);
  }
}

async function sendTurn(event) {
  event.preventDefault();
  const box = $("reply-text");
  const prompt = box.value.trim();
  if (!prompt || !ui.thread) return;
  box.value = "";
  try {
    setThreadStatus("running");
    await post(`/api/threads/${ui.thread.id}/turn`, { prompt });
  } catch (error) {
    banner(`SEND FAILED — ${error.message}`);
    setThreadStatus("idle");
  }
}

/* ---------- log rendering ---------- */

function askBlock(event) {
  const block = el("div", "ask");
  block.dataset.askId = event.askId;
  block.append(el("div", "ask-tool", `${event.tool} wants to run`));
  block.append(el("pre", "ask-input", event.body));
  const menu = el("div", "ask-menu");
  for (const decision of ["allow", "deny"]) {
    const button = el("button", "act", decision.toUpperCase());
    button.onclick = () => post(`/api/threads/${ui.thread.id}/permission`, { askId: event.askId, decision })
      .catch((error) => banner(error.message));
    menu.append(button);
  }
  block.append(menu);
  return block;
}

function resolveAsk(event) {
  const block = $("log").querySelector(`.ask[data-ask-id="${event.askId}"]`);
  if (!block) return;
  block.classList.add("is-resolved");
  block.dataset.verdict = event.body;
  block.querySelector(".ask-menu").replaceChildren(el("span", "ask-verdict", event.body.toUpperCase()));
}

const LABELS = { user: "YOU", turn: "—", status: "" };

function logLine(event) {
  if (event.t === "status") return setThreadStatus(event.body);
  if (event.t === "ask") return append(askBlock(event));
  if (event.t === "verdict") return resolveAsk(event);
  const line = el("div", "line");
  line.dataset.t = event.t;
  if (event.replayed) line.classList.add("replayed");
  line.append(
    el("span", "t", LABELS[event.t] ?? new Date(event.ts).toLocaleTimeString([], { hour12: false })),
    el("span", "b", event.t === "turn" ? `— ${event.body} —` : String(event.body ?? "")),
  );
  append(line);
}

function append(node) {
  const log = $("log");
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  log.append(node);
  if (pinned) log.scrollTop = log.scrollHeight;
}

/* ---------- drawer ---------- */

function setThreadStatus(status) {
  if (!ui.thread) return;
  ui.thread.status = status;
  const running = status === "running";
  $("drawer-state").textContent = status.toUpperCase();
  $("drawer-state").dataset.status = status;
  $("reply-text").disabled = running;
  $("reply-send").disabled = running;
  $("reply-text").placeholder = running
    ? "running — wait for the turn to finish…"
    : "Reply to this session…  (Enter to send, Shift+Enter for newline)";
  running ? startTimer() : stopTimer();
}

function startTimer() {
  stopTimer();
  const from = Date.now();
  ui.timer = setInterval(() => ($("drawer-timer").textContent = `${Math.round((Date.now() - from) / 1000)}s`), 1000);
}

function stopTimer() {
  clearInterval(ui.timer);
  ui.timer = null;
  $("drawer-timer").textContent = "";
}

function openDrawer(thread, title) {
  closeStream();
  ui.thread = thread;
  localStorage.setItem("lastThread", thread.id);
  $("drawer").hidden = false;
  $("drawer-engine").textContent = thread.engine.toUpperCase();
  $("drawer-title").textContent = `/${thread.skill} · ${title ?? thread.label}`;
  $("log").replaceChildren();
  setThreadStatus(thread.status);
  ui.stream = new EventSource(`/api/stream/${thread.id}`);
  ui.stream.onmessage = (message) => logLine(JSON.parse(message.data));
  ui.stream.onerror = () => stopTimer();
}

function closeStream() {
  ui.stream?.close();
  ui.stream = null;
  stopTimer();
}

const HANDOFF = {
  claude: (thread) => `cd ${thread.cwd} && claude --resume ${thread.sessionId}`,
  codex: (thread) => `cd ${thread.cwd} && codex resume ${thread.sessionId}`,
};

function handOff() {
  if (!ui.thread?.sessionId) return banner("no session id yet — wait for the first turn");
  const command = HANDOFF[ui.thread.engine](ui.thread);
  navigator.clipboard?.writeText(command).catch(() => {});
  banner(`COPIED — ${command}`);
}

/* ---------- run modal ---------- */

function chosenMode() {
  if ($("modal-unsandboxed").checked) return "unsandboxed";
  return $("modal-write").checked ? "write" : "read";
}

function openModal(pr) {
  const select = $("modal-skill");
  select.replaceChildren(new Option("— free-form —", ""));
  for (const skill of ui.skills) select.append(new Option(`/${skill.id}`, skill.id));
  $("modal-repo").textContent = `#${pr.number} ${pr.repo}`;
  $("modal-note").textContent = sandboxWarning() ?? "";
  $("modal-unsandboxed-row").hidden = !sandboxWarning();

  // Codex `exec` has no approval channel; its safety is the sandbox mode alone.
  const claude = ui.engine === "claude";
  $("modal-approvals").disabled = !claude;
  $("modal-approvals").checked = false;
  $("modal-approvals-note").textContent = claude ? "" : "— not available on Codex";

  $("modal-run").onclick = () =>
    launch(pr, {
      skill: select.value || undefined,
      prompt: $("modal-prompt").value,
      mode: chosenMode(),
      approvals: $("modal-approvals").checked,
    });
  $("prompt-modal").showModal();
}

/* ---------- wiring ---------- */

function selectEngine(engine) {
  ui.engine = engine;
  for (const button of document.querySelectorAll(".engine-btn")) {
    button.classList.toggle("is-active", button.dataset.engine === engine);
  }
  banner(sandboxWarning());
  loadAgents();
  renderBoard();
}

function selectTab(tab) {
  ui.tab = tab;
  for (const button of document.querySelectorAll(".tab")) {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  }
  renderBoard();
}

for (const button of document.querySelectorAll(".engine-btn")) button.onclick = () => selectEngine(button.dataset.engine);
for (const button of document.querySelectorAll(".tab")) button.onclick = () => selectTab(button.dataset.tab);

$("refresh").onclick = () => loadPrs(true);
$("viewer").onclick = () => $("accounts-modal").showModal();
$("accounts-close").onclick = () => $("accounts-modal").close();
$("account-add").onsubmit = async (event) => {
  event.preventDefault();
  await applyAccounts(post("/api/accounts", { token: $("account-token").value }));
  $("account-token").value = "";
};
$("reply").onsubmit = sendTurn;
$("reply-text").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey) sendTurn(event);
};
$("drawer-handoff").onclick = handOff;
$("drawer-stop").onclick = () => post(`/api/threads/${ui.thread.id}/stop`).catch(() => {});
$("drawer-close").onclick = () => {
  closeStream();
  ui.thread = null;
  localStorage.removeItem("lastThread");
  $("drawer").hidden = true;
};

// A reload re-attaches to the last thread: the server keeps its event buffer.
async function restoreLastThread() {
  const id = localStorage.getItem("lastThread");
  if (!id) return;
  const thread = (await api("/api/threads").catch(() => [])).find((entry) => entry.id === id);
  if (thread) openDrawer(thread);
}

api("/api/skills").then((skills) => (ui.skills = skills)).catch(() => {});
api("/api/health").then((health) => {
  ui.health = health;
  banner(sandboxWarning());
}).catch(() => {});
applyAccounts(api("/api/accounts"));
loadAgents();
restoreLastThread();
setInterval(loadAgents, 5000);
setInterval(() => loadPrs(), 120000);
