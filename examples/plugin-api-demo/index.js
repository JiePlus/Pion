// Demonstrates the extended Desktop Plugin API: the richer declarative views,
// allowlisted workspace writes, and a host-proxied network request. The plugin
// never touches the DOM, Tauri internals, or other plugins.
let dispose = [];
let log = "Ready";
let echo = "";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAUklEQVR42u3QQQ0AAAgEoItgZWPZzhbOBxsJSE1zIApEi0a0aNEWRItGtGjRFkSLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0Yj+ZwG6fizpaKnOxgAAAABJRU5ErkJggg==";

function view() {
  return {
    type: "stack",
    children: [
      { type: "text", text: "Extended Desktop Plugin API", tone: "heading" },
      { type: "badge", text: log },
      {
        type: "table",
        caption: "Declarative table from plugin data",
        columns: [
          { key: "capability", label: "Capability" },
          { key: "gate", label: "Gate" },
        ],
        rows: [
          { capability: "workspace.write", gate: "path allowlist + 1 MB limit" },
          { capability: "network.fetch", gate: "host allowlist + host proxy" },
          { capability: "views", gate: "validated, no DOM or script" },
        ],
      },
      {
        type: "code",
        language: "ts",
        text: 'await context.workspace.writeFile("pion-plugin-demo.md", "hello");',
      },
      {
        type: "diff",
        text: "@@ demo @@\n-old status\n+new status\n context line",
      },
      { type: "image", src: image, alt: "Demo image from a data URL" },
      {
        type: "input",
        label: "Echo through an owned command",
        placeholder: "Type something",
        submit: "Echo",
        command: "plugin-api-demo.echo",
      },
      {
        type: "text",
        text: echo ? `Last echo: ${echo}` : "No echo yet",
        tone: "muted",
      },
      { type: "button", label: "Write demo file", command: "plugin-api-demo.write" },
      { type: "button", label: "Fetch example.com", command: "plugin-api-demo.fetch" },
    ],
  };
}

function refresh() {
  context.ui.updatePanel("plugin-api-demo.panel", view());
}

async function activate(ctx) {
  dispose.push(
    ctx.commands.register("plugin-api-demo.write", async () => {
      try {
        await ctx.workspace.writeFile(
          "pion-plugin-demo.md",
          `# Plugin API demo\n\nWritten at ${new Date().toISOString()}\n`,
        );
        log = "Wrote pion-plugin-demo.md";
      } catch (error) {
        log = `Write failed: ${error}`;
      }
      refresh();
    }),
  );
  dispose.push(
    ctx.commands.register("plugin-api-demo.fetch", async () => {
      try {
        const response = await ctx.network.fetch("https://example.com");
        log = `example.com → HTTP ${response.status} (${response.body.length} bytes)`;
      } catch (error) {
        log = `Fetch failed: ${error}`;
      }
      refresh();
    }),
  );
  dispose.push(
    ctx.commands.register("plugin-api-demo.echo", async (args) => {
      echo = String((args && args.text) || "");
      refresh();
    }),
  );
  dispose.push(ctx.ui.registerPanel("plugin-api-demo.panel", view()));
}

function deactivate() {
  dispose.forEach((fn) => fn());
  dispose = [];
}
