# Pion

基于 **Tauri 2 + React + TypeScript** 的插件优先 Pi Desktop Shell。

```text
Pi = Agent Runtime
Pion = Application Shell
Plugins = Features
```

第一批只实现 Core、Plugin Runtime、Pi RPC Adapter 和 Pi 基础任务界面。Git、Terminal、Diff、Worktree 不在 Core 中。

## macOS 安装

Pion 在 macOS 上从源码运行，首次使用前先安装以下依赖：

1. **Xcode 命令行工具**：提供 Rust 与 Tauri 编译所需的系统工具链。

   ```bash
   xcode-select --install
   ```

2. **Node.js 22.19+**：例如使用 Homebrew 安装，也可使用 nvm 等版本管理器。

   ```bash
   brew install node
   ```

3. **Rust 工具链**：使用 rustup 安装，并在当前终端加载环境变量。

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```

macOS 自带 WebKit，无需像 Linux 那样额外安装 Tauri 系统依赖。依赖就绪后，按下方“启动”章节安装项目依赖并启动桌面应用。

## 启动

开发需要 Node.js 22.19+、Rust 和平台 Tauri 依赖。桌面应用启动时会检查 Pi 与模型认证；缺少 Pi 时可在初设页使用 npm 全局安装。当前通过 Pion 验证的 Pi 版本为 macOS **0.87.1**、Windows **0.87.0**；左侧 **Pi 模型** 可管理模型配置和 API Key，已有凭据不会返回给界面。

```bash
npm ci
npm run desktop
```

主流程是 **添加项目 → 输入需求并开始任务 → 在任务中持续对话**。左侧按项目列出历史任务，点击任务会自动连接 Pi 并恢复对应会话，不需要手动连接或点击“恢复对话”。Enter 发送，Shift + Enter 换行；任务输入草稿按任务保留。

Pi 对话是 Core 基础能力，不需要安装或授权插件。任务内直接提供模型、thinking level、Pi commands、完整/只读/仅聊天工具预设、图片输入、运行中 steer/follow-up 队列、停止、自动压缩/重试设置、压缩/重试状态和工具调用详情。Pi extensions 发出的 select、confirm、input、editor、notify、status、widget、title 和编辑器草稿请求由 Core 显示；它们不会进入 Desktop Plugin API。插件管理位于 **设置 → 插件**；选定项目会加载该项目的 Pi extensions，因此启动任务仍表示信任该项目及本机 Pi 配置。

聊天消息参考 pi-web：用户消息靠右，正文支持 Markdown、表格和代码块，消息及代码可复制；思考过程与工具输入/输出可展开，工具记录按消息顺序展示并随历史恢复。流式回复按 Pi 0.87.0 delta 组装并自动跟随到底部，向上翻阅时保持位置，可点击“回到最新消息”继续跟随。可选择、拖放或粘贴 PNG/JPEG/GIF/WebP，发送前预览并删除；当前模型不支持图片时会阻止发送并提示。发送失败保留文字和附件，成功后才清空。Pi 消息中的内嵌图片可显示，Markdown 外部图片保留为链接。

任务顶部可查看 Pi session tree、从历史用户消息 Fork 并编辑、Clone 当前分支、同步重命名 Pion Task 与 Pi sessionName，以及导出 HTML。Fork/Clone 创建独立 Pion Task，但消息和分支仍以 Pi Session 为权威；Pion 只保存导航映射。

通常使用已经配置好模型和认证的本机 `pi`。初设页仅在 Pi 或模型未就绪时自动出现，完成后返回工作区，不占用日常设置入口；也可在初设页输入现有 Pi 的绝对路径。macOS 从 Finder 启动时会查找常见 Node 安装位置，并将 Pi 所在目录加入子进程 PATH。**设置 → 通用** 可手动检查官方最新版本；一键更新仅针对 npm 全局安装，并固定到随 Pion 发布的已验证版本。运行中的任务结束后才允许更新；其他安装方式显示手动更新指南。

左侧 **Pi 模型** 按 Pi 官方接入方式提供入口：API Key 保存在 Pi 的 `auth.json`（Unix 文件权限设为 `0600`，界面不回显）；OAuth/订阅登录通过本机 npm 安装的 Pi SDK 在 Pion 内完成浏览器授权、设备码和所需输入；环境变量需在启动 Pion 前设置；兼容 API 的自定义接口写入 `models.json`；特殊认证或协议可通过左侧 **Pi 包** 安装 Provider 扩展。自定义接口可从服务商的 `/models` 列表获取模型，搜索、多选后批量写入 `models.json`；这是一次性导入，后续新增模型可再次获取。接口未提供模型列表时仍可手动添加。原有高级字段与认证配置保持不变，本地接口新建时写入 Pi 所需的占位密钥。已有任务需重新打开，才会刷新 Pi 的可用模型列表。

浏览器预览：

```bash
npm run dev
```

预览可运行真实插件 Worker 与声明式 UI、权限审核和布局；没有原生 Pi/文件访问，不生成假聊天回复。浏览器与原生应用存储互相独立。

## 界面语言

支持简体中文和英文。首次启动按系统语言选择，不支持的语言回退英文；在 **设置 → 界面语言 / Settings → Language** 手动切换，立即生效并保存在本机。Shell、核心 Pi 对话、权限审核和命令面板均支持切换。插件独立维护翻译，用户消息、模型回复和原始诊断信息保留原文。

旧开发版安装的 `agent-chat` 快照启动时会被忽略，避免与 Core 对话重复处理事件；其持久化文件不会自动删除。切换语言不会重启 Pi 或清空对话。

## 当前能力

- 项目与任务导航、原生文件夹选择、自动打开/恢复任务、核心 Pi 对话和底部输入框。
- 模型/Thinking 切换、Pi command、steer/abort、流式文本与工具详情。
- Pi Extension UI 对话、通知、状态、widget、标题和草稿同步；dialog 严格按 id 关联并串行展示。
- 原生图片输入与 Rust MIME/魔数/数量/大小校验；每图 10 MB、最多 5 图、总计 25 MB。
- Session tree、历史 Fork、Clone、sessionName 同步重命名和 HTML 导出。
- steering/follow-up 队列查看、恢复到输入框、清空及处理模式；默认或自定义说明压缩、压缩摘要与自动重试控制。运行中 Pi Extension 命令立即执行。
- 自动压缩与自动重试开关，以及只读的最后一条 assistant 文本 RPC。
- 最多 4 个 Task 同时保持独立 Pi 进程；侧栏标出后台运行任务，切换不会停止其 Agent。
- 从设置页批量扫描并导入有效的旧 `~/.pi/agent/sessions`；导入副本成为独立 Pion Task。
- 通过 Pi 0.87.0 公开 Extension API 实现完整、只读、仅聊天工具预设，并随当前 Pi session 分支恢复。
- Desktop Plugin API v1：命令、事件、声明式 UI（含 table / code / diff / input / image）、Pi、workspace 只读与白名单写入、独立 storage、受限网络请求。
- 插件权限扩展：`workspace.write`（路径白名单、大小限制）与 `network.fetch`（域名白名单，由宿主代理、不跟随重定向）；审核界面展示新增权限与白名单。
- 本地文件夹/ZIP 审核安装；内容快照授权、自动加载已启用插件、手动 Reload、Disable、Uninstall。
- 左侧 **Pi 技能** 使用 Pi 资源解析结果显示用户、项目和 Pi 包内的 Skill 及启用状态。可按用户或项目范围添加、移除本地 Skill 路径；用户范围可启用或禁用 Skill，项目范围可为每个 Skill 选择继承、加载或卸载，并可设置是否在命令菜单中显示 `/skill:name`。左侧 **Pi 包** 支持用户或项目范围的安装、更新和移除。
- 每插件隔离 Worker、禁止直接 DOM/Tauri/其他插件；写文件与联网仅经宿主且受白名单约束；激活 timeout、heartbeat、payload 限额、崩溃清理。
- Rust Pi JSONL：真实 `pi --mode rpc`、串行请求/响应关联、独立事件流、超时/退出处理。
- 无需修改 Core 的 [Hello 插件](examples/hello-plugin)，以及演示写入/联网/丰富 UI 的 [Plugin API 示例](examples/plugin-api-demo)。

## 安装自己的插件

在桌面“设置 → 插件”中输入本地绝对目录路径，例如本项目的 `examples/hello-plugin`，点击 Review installation，再批准权限。

ZIP 必须让 `plugin.json` 和 `main` 相对文件处于包根目录：

```bash
cd examples/hello-plugin
zip /tmp/hello-plugin.zip plugin.json index.js
```

安装时仅保存 manifest 与自包含入口源码快照；不执行 npm/install scripts。修改源文件后需要重新 Review 安装，Reload 仅重载已审核快照。禁用/卸载会清理命令、面板、监听器、pending calls；保留插件 storage。项目内插件不会因为打开 workspace 而自动执行。

## 设计与扩展

- [公开 TypeScript API](src/core/api.ts)
- [Desktop Plugin 开发者文档（API、权限、manifest、审核流程）](PLUGIN_API.md)
- [插件类型 SDK](sdk/index.d.ts) · [脚手架脚本](scripts/create-plugin.mjs) · [模板](templates/plugin)

项目和任务元数据存于 app-data 的 `tasks.json`，新任务使用独立 `sessions/<task-id>` 目录；Fork/Clone 任务保存经 Rust 校验的私有 session 文件映射，路径不发送给前端。Pi 从根用户消息 Fork 时会把 JSONL 延迟到首个 assistant 响应才创建；Pion 只暂存父目录已验证的待创建映射，重新打开时若文件仍不存在则回到该任务的独立 session，并保留待编辑草稿，不伪造 Pi 消息或写入 Pi 私有格式。历史由 Pi 持久化。最多保留 4 个已连接 Task；切换时后台 Agent 继续运行，旧 generation 和其他 taskId 的事件不会进入当前对话。后台 Extension dialog 明确取消，避免无界等待或替用户确认。同一工作区的并行 Agent 仍可能同时修改文件，Pion 只提示风险，不尝试合并或锁定项目。

设置页可以扫描固定的 `~/.pi/agent/sessions`。Rust 只接受官方 JSONL session header、现存且可 canonicalize 的 cwd、普通 `.jsonl` 文件和受限大小/数量；忽略 symlink、损坏文件和已不存在的项目。选中的文件批量复制到 Pion 私有 session root，Task 映射一次提交；失败时移除本次新副本，原文件不修改也不保持同步。opaque source ID 用于防止重复导入，路径不交给前端。复杂自定义 DOM、shell、文件 watch、第三方模块加载、自动 hot reload、Marketplace 暂不提供；文件写入与联网仅在 manifest 白名单内开放（见 [PLUGIN_API.md](PLUGIN_API.md)），未知权限直接拒绝。API v1 使用三段数值版本，不支持 prerelease/range。

Pi 0.87.0 RPC 没有直接查询或设置 active tools 的 command。Pion 因此加载一份固定、随应用发布的 Pi Extension，由 Rust allowlist 把三个枚举值转换为固定命令，再由公开的 `getAllTools()` / `setActiveTools()` 完成切换。完整模式启用 Pi 当前注册的全部工具；只读模式只启用 Pi 内建 `read`、`grep`、`find`、`ls`；仅聊天模式不向模型暴露工具。选择记录写入 Pi session 的 custom entry，不另建 Pion 会话状态。

工具预设只控制模型可调用的工具，不是进程沙箱。Pi Extension 本身仍以用户权限运行，打开项目仍表示信任项目级 Pi Extensions；Pion 内置 Pi Extension 与 Pion Desktop Plugins 的 Worker/CSP/权限体系互不混用。

## 验证与打包

```bash
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright install chromium webkit
npm run test:ui
npm run test:pi
npm run test:sessions
npm run check:format
npm run desktop:build
```

`test:pi` 串行检查 state、commands、models、thinking levels、stats、messages、自动压缩/重试、最后回复、abort 和内置工具预设 Extension；`test:sessions` 用本机 Pi 序列化测试历史，在临时目录验证复制后的 JSONL 可由 `--session` 恢复、两个并行 RPC 进程、A → B → A 恢复以及 tree/entries/Fork/Clone/重命名/HTML 导出，均不发起 provider 请求。自定义压缩与运行中扩展命令由受限 RPC 映射和双浏览器 fixture 测试覆盖；真实 provider 的完整对话仍需要在你的 Pi 配置下验收。

macOS 本地构建产物位于 `src-tauri/target/release/bundle/macos/Pion.app`；`npm run desktop:build` 默认仅打包本机 `.app`，没有签名或公证流程。

`.github/workflows/build-installers.yml` 在 Pull Request、手动触发以及推送 `v*` 标签时自动编译并打包各平台安装包：macOS（universal `.app` 与 `.dmg`）、Linux（`.deb` 与 `.AppImage`）和 Windows（NSIS `-setup.exe` 与 `.msi`）。Pull Request 与手动运行会把产物作为 workflow artifact 上传；推送标签时还会创建草稿 Release 并附加安装包。当前安装包未签名/公证，Windows/Linux 的浏览器沙箱与运行时行为仍需在对应平台人工验收。

插件沙箱采用 opaque-origin iframe + Blob Worker + CSP，适合当前受控 MVP。它不是 OS 容器，不能保证抵御浏览器漏洞或恶意内存耗尽。正式开放不受信任插件分发前需要独立安全评审和多平台原生验证。
