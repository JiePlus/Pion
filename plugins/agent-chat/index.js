/* global context */
// A normal v1 plugin: no React, shell imports, DOM, filesystem, or provider SDK.
let api;
let messages = [];
let activity = [];
let blocks = new Map();
let streaming = false;
let error = "";
let status = "Connect Pi in Workspace settings to begin.";
let paintTimer;
let disposables = [];
let current = null;

// This plugin owns its translations; the host only supplies locale and change notifications.
const translations = {
  You: "你",
  WORKING: "处理中",
  READY: "就绪",
  "What would you like to work on?": "想从哪里开始？",
  "Connect Pi in Workspace settings to begin.": "请在工作区设置中连接 Pi。",
  "Pi · streaming": "Pi · 正在回复",
  "Ask Pi to explore, build, or fix something…": "让 Pi 帮你探索、开发或修复…",
  "Send to Pi": "发送给 Pi",
  "Stop agent": "停止任务",
  "Restore conversation": "恢复对话",
  "Tool activity": "工具活动",
  "Actions run by your Pi runtime appear here.": "Pi 执行的工具操作将显示在这里。",
  "Running…": "运行中…",
  "Working…": "处理中…",
  Failed: "失败",
  Completed: "已完成",
  "Pi is retrying: {error}": "Pi 正在重试：{error}",
  "provider error": "模型服务出错",
  "A Pi extension requested unsupported UI; interactive requests were cancelled.":
    "Pi 扩展请求了暂不支持的界面交互，已取消该请求。",
  "Pi extension failed": "Pi 扩展出错",
  "Pi is working; restore after it settles.": "Pi 正在执行任务，请在结束后恢复对话。",
  "Connected to Pi · your runtime, tools, and configuration.":
    "已连接 Pi · 使用你的运行时、工具和配置。",
  Connecting: "正在连接",
  "Pi RPC connected": "Pi RPC 已连接",
  "Stopped by user": "已断开连接",
  "Pi process exited": "Pi 进程已退出",
  "Pi transport stopped; reconnect required": "Pi 通信已停止，请重新连接",
};
let retryError = "";
function tx(key, values = {}) {
  const text =
    api?.i18n?.locale === "zh-CN" && Object.hasOwn(translations, key) ? translations[key] : key;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function contentText(message) {
  if (typeof message.content === "string") return message.content;
  return (message.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
function boundedMessages() {
  // ponytail: 20 recent text messages; virtualized history belongs in a later UI protocol.
  return messages.slice(-20).map((message) => ({
    label: message.role === "user" ? tx("You") : "Pi",
    text: contentText(message).slice(-6000),
  }));
}
function conversation() {
  return {
    type: "stack",
    children: [
      {
        type: "stack",
        children: [
          ...(!messages.length && current === null
            ? [{ type: "text", text: tx("What would you like to work on?"), tone: "heading" }]
            : []),
          { type: "list", items: boundedMessages() },
          ...(current === null
            ? []
            : [
                {
                  type: "list",
                  items: [
                    {
                      label: tx("Pi · streaming"),
                      text: [...blocks.entries()]
                        .sort((a, b) => a[0] - b[0])
                        .map(([, value]) => value)
                        .join("")
                        .slice(-6000),
                    },
                  ],
                },
              ]),
          ...(activity.length
            ? [
                {
                  type: "list",
                  items: activity
                    .slice(-30)
                    .map((item) => ({ label: item.label, text: tx(item.text) })),
                },
              ]
            : []),
          { type: "badge", text: tx(streaming ? "WORKING" : "READY") },
          ...(retryError
            ? [{ type: "text", text: tx(status, { error: retryError }), tone: "muted" }]
            : []),
          ...(error ? [{ type: "text", text: tx(error), tone: "error" }] : []),
        ],
      },
      {
        type: "form",
        command: "agent-chat.send",
        placeholder: tx("Ask Pi to explore, build, or fix something…"),
        submit: tx("Send to Pi"),
        disabled: streaming,
      },
      ...(streaming
        ? [
            {
              type: "button",
              command: "agent-chat.abort",
              label: tx("Stop agent"),
            },
          ]
        : []),
    ],
  };
}
function paint() {
  clearTimeout(paintTimer);
  paintTimer = undefined;
  api.ui.updatePanel("agent-chat.conversation", conversation());
}
function schedulePaint() {
  if (!paintTimer) paintTimer = setTimeout(paint, 40);
}
function receive(event) {
  if (event.type === "agent_start") {
    streaming = true;
    error = "";
  }
  if (event.type === "agent_settled") {
    streaming = false;
    current = null;
    blocks.clear();
  }
  if (event.type === "message_start" && event.message?.role === "assistant") {
    current = event.message;
    blocks.clear();
  }
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta")
      blocks.set(delta.contentIndex, (blocks.get(delta.contentIndex) || "") + delta.delta);
  }
  if (event.type === "message_end") {
    if (event.message?.role === "user" || event.message?.role === "assistant") {
      messages.push(event.message);
      messages = messages.slice(-20);
    }
    if (event.message?.role === "assistant") {
      current = null;
      blocks.clear();
      if (event.message.errorMessage) error = event.message.errorMessage;
    }
  }
  if (event.type === "tool_execution_start") {
    activity.push({ id: event.toolCallId, label: event.toolName, text: "Running…" });
    activity = activity.slice(-30);
  }
  if (event.type === "tool_execution_end" || event.type === "tool_execution_update") {
    const tool = activity.find((item) => item.id === event.toolCallId);
    if (tool)
      tool.text =
        event.type === "tool_execution_update"
          ? "Working…"
          : event.isError
            ? "Failed"
            : "Completed";
  }
  if (event.type === "auto_retry_start") {
    status = "Pi is retrying: {error}";
    retryError = event.errorMessage || "";
  }
  if (event.type === "desktop_extension_ui_unsupported")
    error = "A Pi extension requested unsupported UI; interactive requests were cancelled.";
  if (event.type === "extension_error") error = event.error || "Pi extension failed";
  schedulePaint();
}
async function activate(context) {
  api = context;
  disposables.push(
    context.commands.register("agent-chat.send", async (args) => {
      const message = args?.text?.trim();
      if (!message || streaming) return;
      streaming = true;
      error = "";
      paint();
      try {
        await context.pi.prompt(message);
      } catch (failure) {
        streaming = false;
        error = String(failure);
        paint();
        throw failure;
      }
    }),
  );
  disposables.push(
    context.commands.register("agent-chat.abort", async () => {
      await context.pi.abort();
      paint();
    }),
  );
  disposables.push(
    context.commands.register("agent-chat.refresh", async () => {
      try {
        const state = await context.pi.getState();
        if (state.isStreaming) {
          streaming = true;
          status = "Pi is working; restore after it settles.";
          paint();
          return;
        }
        const history = await context.pi.getMessages();
        messages = history.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-20);
        streaming = false;
        current = null;
        activity = [];
        retryError = "";
        blocks.clear();
        error = "";
        status = "Connected to Pi · your runtime, tools, and configuration.";
        paint();
      } catch (failure) {
        error = String(failure);
        paint();
        throw failure;
      }
    }),
  );
  disposables.push(context.ui.registerPanel("agent-chat.conversation", conversation()));
  disposables.push(context.pi.onEvent(receive));
  disposables.push(
    context.events.on("pi:status", (event) => {
      status = event.detail;
      if (event.state === "disconnected") {
        streaming = false;
        current = null;
        messages = [];
        activity = [];
        retryError = "";
        blocks.clear();
        error = "";
      }
      paint();
    }),
  );
  if (context.i18n) disposables.push(context.i18n.onDidChange(() => paint()));
  // Loading during a connected session restores Pi's authoritative history.
  try {
    const state = await context.pi.getState();
    streaming = state.isStreaming;
    const history = await context.pi.getMessages();
    messages = history.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-20);
    status = "Connected to Pi · your runtime, tools, and configuration.";
    paint();
  } catch {
    /* Disconnected is a normal shell startup state. */
  }
}
function deactivate() {
  clearTimeout(paintTimer);
  disposables.forEach((dispose) => dispose());
  disposables = [];
}
