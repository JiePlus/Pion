let dispose = [];
async function activate(context) {
  let count = (await context.storage.get("count")) || 0;
  let status = "Waiting for Pi events";
  const view = () => ({
    type: "stack",
    children: [
      { type: "text", text: "Hello from a local plugin", tone: "heading" },
      { type: "text", text: `${count} saved inspections · ${status}` },
      { type: "button", label: "Inspect Pi", command: "hello-plugin.refresh" },
    ],
  });
  dispose.push(
    context.commands.register("hello-plugin.refresh", async () => {
      const state = await context.pi.getState();
      count++;
      await context.storage.set("count", count);
      status = state.isStreaming ? "Pi is working" : "Pi is idle";
      context.ui.updatePanel("hello-plugin.panel", view());
    }),
  );
  dispose.push(context.ui.registerPanel("hello-plugin.panel", view()));
  dispose.push(
    context.pi.onEvent((event) => {
      status = event.type;
      context.ui.updatePanel("hello-plugin.panel", view());
    }),
  );
}
function deactivate() {
  dispose.forEach((fn) => fn());
  dispose = [];
}
