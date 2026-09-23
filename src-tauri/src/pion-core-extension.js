const COMMAND = "pion-core-tools";
const ENTRY = "pion-core-tool-preset";
const STATUS = "pion-core-tool-preset";
const PRESETS = new Set(["full", "read-only", "chat"]);
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

function sorted(values) {
  return [...values].sort();
}

function sameTools(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

export function toolsForPreset(preset, allTools) {
  if (preset === "chat") return [];
  if (preset === "read-only")
    return allTools
      .filter((tool) => tool.sourceInfo?.source === "builtin" && READ_ONLY_TOOLS.has(tool.name))
      .map((tool) => tool.name);
  return allTools.map((tool) => tool.name);
}

export function classifyTools(activeTools, allTools) {
  if (!activeTools.length) return "chat";
  if (sameTools(activeTools, toolsForPreset("full", allTools))) return "full";
  if (sameTools(activeTools, toolsForPreset("read-only", allTools))) return "read-only";
  return "custom";
}

export default function pionCoreExtension(pi) {
  function apply(preset) {
    pi.setActiveTools(toolsForPreset(preset, pi.getAllTools()));
  }

  function report(ctx, preset) {
    ctx.ui.setStatus(STATUS, preset ?? classifyTools(pi.getActiveTools(), pi.getAllTools()));
  }

  function restore(ctx) {
    let saved;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY && PRESETS.has(entry.data?.preset))
        saved = entry.data.preset;
    }
    if (saved) apply(saved);
    report(ctx, saved);
  }

  pi.registerCommand(COMMAND, {
    description: "Set Pion's full, read-only, or chat-only tool preset",
    handler: async (args, ctx) => {
      const preset = args.trim();
      if (preset === "status") {
        report(ctx);
        return;
      }
      if (!PRESETS.has(preset)) {
        ctx.ui.notify("Unknown Pion tool preset", "error");
        report(ctx);
        return;
      }
      apply(preset);
      pi.appendEntry(ENTRY, { preset });
      report(ctx, preset);
    },
  });

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
}
