// Minimal Desktop Plugin scaffold. Everything here stays inside the sandboxed
// worker: use `context` for host capabilities and declarative views for UI.
let dispose = [];
let count = 0;

function view() {
  return {
    type: "stack",
    children: [
      { type: "text", text: "__NAME__", tone: "heading" },
      { type: "text", text: `Greeted ${count} time(s)` },
      { type: "button", label: "Greet", command: "__ID__.greet" },
    ],
  };
}

async function activate(context) {
  dispose.push(
    context.commands.register("__ID__.greet", async () => {
      count += 1;
      await context.storage.set("count", count);
      context.ui.updatePanel("__ID__.panel", view());
    }),
  );
  dispose.push(context.ui.registerPanel("__ID__.panel", view()));
}

function deactivate() {
  dispose.forEach((fn) => fn());
  dispose = [];
}
