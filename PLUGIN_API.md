# Pion Desktop Plugin API v1

Pion is a plugin-first Pi desktop shell. A Desktop Plugin is a self-contained
JavaScript module plus a JSON manifest. Plugins run in an isolated worker with no
DOM, no Tauri internals and no direct network or filesystem access. Every host
capability is gated by a permission declared in the manifest and, for the risky
ones, an explicit allowlist.

```text
Pi = agent runtime      Pion = application shell      Plugins = features
```

- Public TypeScript types: [`src/core/api.ts`](src/core/api.ts)
- Type SDK for plugin authors: [`sdk/index.d.ts`](sdk/index.d.ts)
- Working examples: [`examples/hello-plugin`](examples/hello-plugin), [`examples/plugin-api-demo`](examples/plugin-api-demo)
- Scaffold: [`scripts/create-plugin.mjs`](scripts/create-plugin.mjs) with [`templates/plugin`](templates/plugin)

## Manifest

A plugin is a folder (or ZIP with `plugin.json` and the entry file at its root).

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "nameI18n": { "zh-CN": "我的插件" },
  "version": "0.1.0",
  "apiVersion": "1",
  "minDesktopVersion": "0.1.0",
  "main": "index.js",
  "permissions": ["storage", "workspace.read", "workspace.write", "network.fetch"],
  "access": {
    "workspaceWrite": ["drafts/**", "reports/*.md"],
    "network": ["api.example.com", "*.trusted.dev"]
  },
  "contributes": {
    "commands": [{ "id": "my-plugin.refresh", "title": "Refresh" }],
    "panels": [{ "id": "my-plugin.panel", "title": "My Plugin", "location": "sidebar" }]
  }
}
```

- `id` matches `^[a-z][a-z0-9-]*$` and may not be `core`.
- `version` and `minDesktopVersion` are numeric `major.minor.patch`.
- `main` is a relative `.js` path inside the plugin (`..`, absolute paths and `.` segments are rejected).
- Contributions `id`s must start with `<plugin-id>.` and be unique.
- `access` is optional and only valid together with the matching permission.

## Permissions

| Permission        | Grants                                                           | Notes                                                        |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `workspace.read`  | `workspace.get`, `workspace.readFile`, `workspace:opened` events | Reads relative paths inside the open workspace, ≤ 1 MB.      |
| `workspace.write` | `workspace.writeFile`                                            | Requires `access.workspaceWrite`; ≤ 1 MB per write.          |
| `workspace.git`   | `workspace.gitStatus`, `workspace.gitDiff`                       | Read-only Git status / unified diff of the open workspace.   |
| `pi.read`         | `pi.getState/getMessages/getModels/getCommands`, `pi:event`      | Read-only view of the current Pi task.                       |
| `pi.sendMessage`  | `pi.prompt`, `pi.abort`, `pi.setModel`                           | High risk: drives Pi, whose tools run with your permissions. |
| `storage`         | `storage.get`, `storage.set`                                     | Per-plugin JSON storage, ≤ 1 MB total.                       |
| `notifications`   | `notifications.show`                                             | In-app notification.                                         |
| `network.fetch`   | `network.fetch`                                                  | Requires `access.network`; host-proxied, no redirects.       |

Requesting `workspace.write` or `network.fetch` without the matching allowlist is
a manifest error. An undeclared or empty allowlist denies all access; there is no
broad fallback.

### `access.workspaceWrite`

A list of up to 32 relative path globs. `*` matches within one path segment and a
`**` segment matches zero or more segments.

```text
"drafts/**"      → drafts/, drafts/a.md, drafts/a/b.md
"reports/*.md"   → reports/q1.md (not reports/2026/q1.md)
"output.txt"     → exactly output.txt at the workspace root
```

Writes are resolved against the workspace root, the parent directory must already
exist, and the resolved path must stay inside the workspace (symlinks are
resolved and rejected on escape). Writes are atomic (temp file + rename).

### `access.network`

A list of up to 32 hostnames. `*.example.com` matches subdomains (not the apex).
Requests are performed by the trusted host process, not the worker, so the
worker CSP stays `connect-src 'none'`. Redirects are not followed, so a response
cannot escape the allowlist. Only `http`/`https`, methods `GET/POST/PUT/PATCH/DELETE/HEAD`,
a 1 MB request/response body limit and a 10 second timeout are allowed.

## Plugin context

`activate(context)` receives a frozen context object. Everything is async and
correlated by the host; messages are bounded and the worker is killed on crash or
timeout.

```ts
interface PiDesktopPluginContext {
  i18n: { locale; onDidChange(listener) };
  commands: { register(id, handler); execute(id, args) };
  events: { on(name, listener); emit(name, payload) };
  ui: { registerPanel(id, view); updatePanel(id, view) };
  workspace: {
    get();
    readFile(path);
    writeFile(path, content);
    gitStatus();
    gitDiff(path, staged?);
  };
  network: { fetch(url, options?) };
  pi: { prompt; abort; getState; getMessages; getModels; setModel; getCommands; onEvent };
  storage: { get(key); set(key, value) };
  notifications: { show(message) };
}
```

The module exports `activate(context)` and optionally `deactivate()`. A command
handler receives `args` and may return JSON serializable data.

```js
let dispose = [];
async function activate(context) {
  dispose.push(
    context.commands.register("my-plugin.write", async (args) => {
      await context.workspace.writeFile("drafts/note.md", String(args?.text ?? ""));
      context.ui.updatePanel("my-plugin.panel", { type: "text", text: "Saved." });
    }),
  );
  dispose.push(
    context.commands.register("my-plugin.ping", async () => {
      const response = await context.network.fetch("https://api.example.com/health");
      return { status: response.status };
    }),
  );
  dispose.push(context.ui.registerPanel("my-plugin.panel", { type: "text", text: "Ready." }));
}
function deactivate() {
  dispose.forEach((fn) => fn());
  dispose = [];
}
```

## Declarative views

Views are plain JSON data. The host validates and renders them; plugins cannot
inject DOM, HTML, scripts or styles. A view tree is limited to 256 nodes, depth
12, and 256 KB.

| `type`   | Fields                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `stack`  | `children: View[]`                                                                                           |
| `row`    | `children: View[]`, `align?: "start" \| "center" \| "between"`, `gap?: "sm" \| "md"`                         |
| `text`   | `text`, `tone?: "muted" \| "error" \| "heading"`                                                             |
| `badge`  | `text`                                                                                                       |
| `list`   | `items: { label, text }[]`                                                                                   |
| `table`  | `columns: { key, label }[]`, `rows: Record<string,string>[]`, `caption?`                                     |
| `code`   | `text`, `language?` (rendered as `<pre><code>`, not executed)                                                |
| `diff`   | `text` (unified diff; `+`/`-`/`@@` lines are tinted)                                                         |
| `image`  | `src` (must be a `data:image/…;base64,` URL), `alt?`                                                         |
| `input`  | `command`, `placeholder`, `submit`, `label?`, `disabled?` (single-line form)                                 |
| `button` | `command`, `label`, `args?`, `disabled?`, `variant?: "inline" \| "row"`, `detail?`, `badge?: { text, tone }` |
| `form`   | `command`, `placeholder`, `submit`, `disabled?` (multi-line text)                                            |

Any `command` referenced by a view must be a declared, owned command. Table cells
must use declared column keys.

## Security model

- Each plugin runs in an opaque-origin iframe + Blob Worker with CSP
  `default-src 'none'` and `connect-src 'none'`.
- The worker cannot touch the DOM, Tauri internals, other plugins, or the network
  directly; it can only post messages to the host.
- Host capabilities require both the manifest permission and, for writes/network,
  an allowlist enforced by the Rust host process.
- Install is snapshot-based: Pion stores the manifest and entry source reviewed
  at install time. Editing source requires a new review. `Reload` only reloads
  the approved snapshot. The exception is a folder linked for development (see
  below), whose code reloads but whose permissions stay fixed.
- Payload, message-rate, activation (8 s), heartbeat and command (30 s) limits
  apply per plugin.

This sandbox suits a controlled MVP; it is not an OS container. Distributing
untrusted third-party plugins needs an independent security review.

## Install and review flow

1. Open **Settings → Plugins**.
2. Enter an absolute local folder path or ZIP path and choose **Review installation**.
3. Review the requested permissions. `workspace.write` and `network.fetch` show
   their allowlists; both are highlighted as sensitive, alongside `pi.sendMessage`.
4. **Approve & enable** grants that exact source snapshot. Use **Disable**,
   **Reload** or **Uninstall** afterwards. Uninstall keeps plugin storage.

The same flow works in the desktop app and the browser preview (the preview uses
local storage and has no native file or network access).

## Development mode

While writing a plugin, link its folder instead of installing a snapshot:

1. In **Settings → Plugins**, enter the plugin folder and choose
   **Link for development**. ZIP files cannot be linked.
2. Review and approve the permissions as usual.
3. Edit `plugin.json` or the entry file. About once a second Pion re-reads the
   folder and, if anything changed, reloads the plugin, including after a crash.

A linked plugin shows a **Development** badge and its folder path. Pion refuses
a reload that changes the plugin `id`, `permissions` or `access` and keeps the
running version; choose **Unlink**, then link the folder again to review the new
permissions. Unlink removes the link only, not the folder or plugin storage.
Checks pause while the Pion window is hidden.

## Create a plugin from scratch

```bash
node scripts/create-plugin.mjs ~/src/hello-plugin hello-plugin "Hello Plugin"
```

Then link the folder for development (see above) and edit `plugin.json` and
`index.js`; Pion reloads the plugin as you save. To package as a ZIP, keep `plugin.json` and the entry file
at the archive root:

```bash
cd ~/src/hello-plugin && zip /tmp/hello-plugin.zip plugin.json index.js
```

For editor types, add the SDK to your plugin project:

```bash
npm install --save-dev /path/to/Pion/sdk
```

and reference it with `/** @type {import("@pion/plugin-sdk").PiDesktopPluginContext} */`.

## Limits reference

| Limit              | Value                       |
| ------------------ | --------------------------- |
| Plugin source      | 1 byte – 1 MB               |
| Manifest           | 64 KB                       |
| Write / read file  | 1 MB                        |
| Plugin storage     | 1 MB total                  |
| Network body       | 1 MB request and response   |
| View tree          | 256 nodes, depth 12, 256 KB |
| Message rate       | 1500 messages / 3 s         |
| Command timeout    | 30 s                        |
| Activation timeout | 8 s                         |
