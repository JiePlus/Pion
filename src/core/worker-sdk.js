// Injected only into the isolated Worker, before the plugin's self-contained source.
const send = self.postMessage.bind(self);
const pending = new Map();
const handlers = new Map();
const listeners = new Map();
let sequence = 0;
let calls = Promise.resolve();
let commands = Promise.resolve();
let disposed = false;
let executing = false;
function execute(id, args) {
  if (executing)
    return Promise.reject(new Error("Nested command execution is not supported in API v1"));
  const result = commands.then(async () => {
    const handler = handlers.get(id);
    if (!handler) throw new Error("Command unavailable or not owned by this plugin");
    executing = true;
    try {
      return await handler(args);
    } finally {
      executing = false;
    }
  });
  commands = result.catch(() => {});
  return result;
}

function call(method, args = {}) {
  const task = () =>
    new Promise((resolve, reject) => {
      if (disposed) return reject(new Error("Plugin disposed"));
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`API timeout: ${method}`));
      }, 25000);
      pending.set(id, { resolve, reject, timer });
      send({ kind: "call", id, method, args });
    });
  const result = calls.then(task);
  calls = result.catch(() => {});
  return result;
}
function on(name, listener) {
  const set = listeners.get(name) || new Set();
  set.add(listener);
  listeners.set(name, set);
  send({ kind: "subscribe", name });
  return () => {
    set.delete(listener);
    if (!set.size) {
      listeners.delete(name);
      send({ kind: "unsubscribe", name });
    }
  };
}
const context = Object.freeze({
  i18n: {
    get locale() {
      return desktopLocale;
    },
    onDidChange: (listener) => on("app:localeChanged", (event) => listener(event.locale)),
  },
  commands: {
    register(id, handler) {
      if (handlers.has(id)) throw new Error(`Duplicate command: ${id}`);
      handlers.set(id, handler);
      send({ kind: "command.register", id });
      return () => {
        handlers.delete(id);
        send({ kind: "command.remove", id });
      };
    },
    execute,
  },
  events: { on, emit: (name, payload) => send({ kind: "emit", name, payload }) },
  ui: {
    registerPanel(id, view) {
      send({ kind: "panel.register", id, view });
      return () => send({ kind: "panel.remove", id });
    },
    updatePanel: (id, view) => send({ kind: "panel.update", id, view }),
  },
  workspace: {
    get: () => call("workspace.get"),
    readFile: (path) => call("workspace.readFile", { path }),
    writeFile: (path, content) => call("workspace.writeFile", { path, content }),
  },
  network: {
    fetch: (url, options = {}) => call("network.fetch", { url, options }),
  },
  pi: {
    prompt: (message) => call("pi.prompt", { message }),
    abort: () => call("pi.abort"),
    getState: () => call("pi.getState"),
    getMessages: () => call("pi.getMessages"),
    getModels: () => call("pi.getModels"),
    setModel: (provider, modelId) => call("pi.setModel", { provider, modelId }),
    getCommands: () => call("pi.getCommands"),
    onEvent: (listener) => on("pi:event", listener),
  },
  storage: {
    get: (key) => call("storage.get", { key }),
    set: (key, value) => call("storage.set", { key, value }),
  },
  notifications: { show: (message) => call("notifications.show", { message }) },
});
self.onmessage = (event) => {
  const message = event.data;
  if (message.kind === "ping") return send({ kind: "pong" });
  if (message.kind === "result") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.value);
  } else if (message.kind === "event") {
    if (message.name === "app:localeChanged") desktopLocale = message.payload.locale;
    for (const listener of listeners.get(message.name) || []) {
      try {
        const result = listener(message.payload);
        if (result && typeof result.then === "function")
          throw new Error("Event listeners must be synchronous");
      } catch (error) {
        send({ kind: "crash", error: String(error) });
      }
    }
  } else if (message.kind === "command") {
    execute(message.command, message.args).then(
      (value) => send({ kind: "command.result", id: message.id, value: value ?? null }),
      (error) => send({ kind: "command.result", id: message.id, error: String(error) }),
    );
  } else if (message.kind === "deactivate") {
    disposed = true;
    commands = commands.then(async () => {
      try {
        if (typeof plugin.deactivate === "function") await plugin.deactivate();
      } finally {
        send({ kind: "deactivated" });
      }
    });
  }
};
self.addEventListener("unhandledrejection", (event) =>
  send({ kind: "crash", error: String(event.reason) }),
);
