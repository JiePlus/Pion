/* global context */
// First-party Git/Diff plugin (API v1). Read-only: it only calls the
// permission-gated workspace.gitStatus / workspace.gitDiff methods, never the
// filesystem, network, DOM or Tauri, and renders through declarative Views.
let api;
let status = null;
let selected = null;
let diff = null;
let error = "";
let busy = false;
let disposables = [];

const translations = {
  "Git status & diff": "Git 状态与差异",
  "Read Git status": "读取 Git 状态",
  "Reading Git status…": "正在读取 Git 状态…",
  "Open a workspace to view Git status.": "打开一个工作区后查看 Git 状态。",
  "This workspace is not a Git repository.": "当前工作区不是 Git 仓库。",
  "Working tree clean": "工作区没有改动",
  "{count} changed files": "{count} 个文件有改动",
  "M modified · A added · D deleted · ?? untracked": "M 修改 · A 新增 · D 删除 · ?? 未跟踪",
  "Detached HEAD": "分离的 HEAD",
  "Staged Changes": "已暂存的更改",
  Changes: "更改",
  Staged: "已暂存",
  Unstaged: "未暂存",
  Untracked: "未跟踪",
  "No changes to review.": "没有需要审阅的改动。",
  "Working tree": "工作区",
  "Could not read Git status: {error}": "无法读取 Git 状态：{error}",
  "Could not read diff: {error}": "无法读取差异：{error}",
  "Loading diff…": "正在读取差异…",
  "No text changes on this side.": "这一侧没有文本改动。",
  "Binary file — no text diff to show.": "二进制文件，无法显示文本差异。",
  "Diff truncated for display.": "差异过长，已截断显示。",
  "…and {count} more files": "……另有 {count} 个文件",
  Refresh: "刷新",
  "Close diff": "关闭差异",
};

function tx(key, values = {}) {
  const text =
    api?.i18n?.locale === "zh-CN" && Object.hasOwn(translations, key) ? translations[key] : key;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function displayText(value) {
  if (value.binary) return tx("Binary file — no text diff to show.");
  if (!value.diff.trim()) return tx("No text changes on this side.");
  const limit = 80000;
  if (value.diff.length > limit) return `${value.diff.slice(0, limit)}\n…`;
  return value.diff;
}

const STATUS_TONE = {
  M: "modify",
  A: "add",
  D: "delete",
  R: "rename",
  C: "add",
  U: "modify",
  T: "modify",
  "!": "neutral",
};

function splitPath(path) {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

function fileStatus(file, staged) {
  if (file.index === "?" && file.worktree === "?") return { code: "U", tone: "untracked" };
  const raw = staged ? file.index : file.worktree;
  const code = raw === " " ? "M" : raw;
  return { code, tone: STATUS_TONE[code] || "neutral" };
}

function fileRow(file, staged) {
  const status = fileStatus(file, staged);
  const { name, dir } = splitPath(file.path);
  const row = {
    type: "button",
    variant: "row",
    label: name,
    badge: { text: status.code, tone: status.tone },
    command: "git-diff.open",
    args: { path: file.path, staged },
  };
  if (dir) row.detail = dir;
  return row;
}

function section(title, files, staged) {
  return [
    { type: "text", text: `${title} (${files.length})`, tone: "muted" },
    ...files.slice(0, 60).map((file) => fileRow(file, staged)),
  ];
}

function messageRow(message) {
  return {
    type: "row",
    align: "between",
    children: [
      { type: "text", text: message, tone: "muted" },
      {
        type: "button",
        label: tx("Refresh"),
        command: "git-diff.refresh",
        disabled: busy,
        variant: "inline",
      },
    ],
  };
}

function view() {
  const children = [];
  if (error) children.push({ type: "text", text: error, tone: "error" });
  if (!status) {
    if (!error)
      children.push(
        messageRow(busy ? tx("Reading Git status…") : tx("Open a workspace to view Git status.")),
      );
  } else if (!status.repo) {
    children.push(messageRow(tx("This workspace is not a Git repository.")));
  } else {
    const branch = status.detached ? tx("Detached HEAD") : status.branch || "HEAD";
    const tracking =
      status.ahead || status.behind ? ` ↑${status.ahead || 0} ↓${status.behind || 0}` : "";
    const summary = status.clean
      ? tx("Working tree clean")
      : tx("{count} changed files", { count: status.files.length });
    children.push({
      type: "row",
      align: "between",
      children: [
        {
          type: "row",
          align: "start",
          gap: "sm",
          children: [
            { type: "badge", text: branch },
            {
              type: "text",
              text: [tracking.trim(), summary].filter(Boolean).join(" · "),
              tone: "muted",
            },
          ],
        },
        {
          type: "button",
          label: tx("Refresh"),
          command: "git-diff.refresh",
          disabled: busy,
          variant: "inline",
        },
      ],
    });

    const staged = status.files.filter((file) => file.index !== " " && file.index !== "?");
    const unstaged = status.files.filter((file) => file.worktree !== " " && file.worktree !== "?");
    const untracked = status.files.filter((file) => file.index === "?" && file.worktree === "?");
    const sections = [
      [tx("Staged Changes"), staged, true],
      [tx("Changes"), unstaged, false],
      [tx("Untracked"), untracked, false],
    ];
    for (const [title, files, isStaged] of sections) {
      if (files.length) children.push(...section(title, files, isStaged));
    }
    if (status.clean)
      children.push({ type: "text", text: tx("No changes to review."), tone: "muted" });
  }

  if (selected) {
    const current = splitPath(selected.path);
    const heading = [
      { type: "text", text: current.name, tone: "heading" },
      ...(current.dir ? [{ type: "text", text: current.dir, tone: "muted" }] : []),
      {
        type: "text",
        text: selected.staged ? tx("Staged") : tx("Unstaged"),
        tone: "muted",
      },
    ];
    children.push({
      type: "row",
      align: "between",
      children: [
        { type: "row", align: "start", gap: "sm", children: heading },
        { type: "button", label: tx("Close diff"), command: "git-diff.close", variant: "inline" },
      ],
    });
    if (diff) {
      children.push({ type: "code", text: displayText(diff), language: "diff", variant: "diff" });
      if (diff.truncated)
        children.push({ type: "text", text: tx("Diff truncated for display."), tone: "muted" });
    } else if (busy) {
      children.push({ type: "text", text: tx("Loading diff…"), tone: "muted" });
    }
  }

  return { type: "stack", children };
}

function paint() {
  if (api) api.ui.updatePanel("git-diff.panel", view());
}

async function loadDiff() {
  if (!selected) return;
  diff = await api.workspace.gitDiff(selected.path, selected.staged);
}

async function refresh() {
  busy = true;
  error = "";
  paint();
  try {
    status = await api.workspace.gitStatus();
    if (selected) {
      const stillThere = status.repo && status.files.some((file) => file.path === selected.path);
      if (stillThere) await loadDiff();
      else {
        selected = null;
        diff = null;
      }
    }
  } catch (failure) {
    status = null;
    diff = null;
    const message = String(failure);
    error = /No workspace/i.test(message)
      ? ""
      : tx("Could not read Git status: {error}", { error: message });
  } finally {
    busy = false;
    paint();
  }
}

async function openDiff(args) {
  const path = args && args.path;
  if (!path) return;
  selected = { path: String(path), staged: args.staged === true };
  diff = null;
  busy = true;
  error = "";
  paint();
  try {
    await loadDiff();
  } catch (failure) {
    error = tx("Could not read diff: {error}", { error: String(failure) });
  } finally {
    busy = false;
    paint();
  }
}

async function activate(context) {
  api = context;
  disposables.push(context.commands.register("git-diff.refresh", () => refresh()));
  disposables.push(context.commands.register("git-diff.open", (args) => openDiff(args)));
  disposables.push(
    context.commands.register("git-diff.close", () => {
      selected = null;
      diff = null;
      paint();
    }),
  );
  disposables.push(context.ui.registerPanel("git-diff.panel", view()));
  disposables.push(
    context.events.on("workspace:opened", () => {
      refresh();
    }),
  );
  if (context.i18n) disposables.push(context.i18n.onDidChange(() => paint()));
  await refresh();
}

function deactivate() {
  disposables.forEach((dispose) => dispose());
  disposables = [];
}
