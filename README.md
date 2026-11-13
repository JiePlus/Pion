# Pion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

基于 **Tauri 2 + React + TypeScript** 的插件优先 Pi Desktop Shell。

```text
Pi = Agent Runtime
Pion = Application Shell
Plugins = Features
```

第一批只实现 Core、Plugin Runtime、Pi RPC Adapter 和 Pi 基础任务界面，以及内置的 Git 审阅面板。Terminal、Worktree 不在 Core 中。

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

## 应用更新

**设置 → 通用 → Pion 更新** 显示当前版本并可手动检查更新。可分别开启“自动检查更新”和“后台自动下载更新”：开启后 Pion 启动时静默检查，有新版本即在后台下载，不会打断当前任务。下载完成后由用户点击“安装并重启 Pion”完成安装；Windows 安装器会退出当前应用，因此后台检查与下载不会自动调用安装器。下载暂存于当前进程，直接关闭应用会丢弃暂存，下次启动将重新检查并下载。

更新包由 `.github/workflows/build-installers.yml` 在合并或推送到 `main` 后自动发布，无需手改版本号。准备步骤读取最新 `main` 和已占用的稳定版本标签，将最高版本的补丁号加一（例如 `0.1.1 → 0.1.2`），同步 npm、Tauri、Cargo 及锁文件的六处应用版本声明，再原子推送版本提交和 `v<version>` 标签。三个平台固定构建同一个版本提交，全部成功后才由一个发布步骤上传草稿、生成包含四个架构入口的 `latest.json` 并公开 Release。应用继续通过 `plugins.updater.endpoints` 中的 GitHub `releases/latest/download/latest.json` 获取更新。Pull Request 与手动运行只构建、不升版、不签名、不发布；标签由工作流管理，不另行触发发布。

发布串行执行，不取消进行中的构建。GitHub 只保留最新的待运行任务，因此连续快速合并可能共用一次补丁发布；准备步骤以最新 `main` 为快照，后续合并的代码不会因旧提交覆盖而丢失。预留的版本和源码提交绑定到工作流 run ID，失败时在 Actions 中 **Re-run all jobs** 可恢复同一版本，不会再次升版；共用版本的任务也会用 `pion-release-run-<run-id>` 标签记录映射。已有公开版本只校验、不覆盖；较早任务重跑不会将 Latest 倒退。签名配置缺失会在升版前失败，构建或上传失败会保留预留标签及未公开的草稿供重跑恢复。请勿删除预留标签或强制重写 `main`。

本仓库已配置更新签名公钥及对应的 Actions 私钥 Secret，更新地址也已指向本仓库 Release。首个带更新能力的版本为 **0.1.1**，旧版安装包需先手动安装一次。自动升版使用现有 `GITHUB_TOKEN` 的 `contents: write` 权限，不需要 PAT；若以后给 `main` 增加禁止 Actions 直接推送的保护规则，需要同步调整发布权限或流程，否则准备步骤会明确失败。

迁移到其他仓库或需要替换密钥时，再按以下步骤配置（已有用户必须先通过旧密钥签名的版本接收新公钥，不能直接替换后要求旧安装包信任）：

1. 生成签名密钥（私钥不要提交到仓库）：`npm run tauri signer generate -- -w ~/.tauri/pion.key`
2. 把生成的公钥内容填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
3. 在仓库 Secrets 中添加 `TAURI_SIGNING_PRIVATE_KEY`（私钥文件内容）和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（生成时设置的密码，可为空）。

> 更新地址使用 GitHub 公开 Release 的 `latest.json`，因此仓库与 Release 必须可匿名访问：把仓库设为公开即可（或把 `plugins.updater.endpoints` 指向其他公开静态地址）。签名私钥只放在 GitHub Actions Secrets，公钥本来就可以公开。

## macOS 签名与公证（未启用）

当前发布的 macOS 包为 **未签名 / 未公证**，首次打开会被 Gatekeeper 拦截，用户需在“系统设置 → 隐私与安全性”中允许。启用签名与公证需要 Apple Developer 账号（付费），并在仓库 Actions Secrets 中配置：

1. 在 Apple Developer 后台创建 Developer ID Application 证书，导出为 `.p12` 后 base64 编码填入 `APPLE_CERTIFICATE`，证书密码填 `APPLE_CERTIFICATE_PASSWORD`。
2. 把证书导入 CI 的登录钥匙串（`macos-latest` 上用 `apple-actions/import-certificate` 导入 `APPLE_CERTIFICATE`）。
3. 配置 `APPLE_ID`（Apple ID 邮箱）、`APPLE_PASSWORD`（App-specific Password）、`APPLE_TEAM_ID`（Team ID）。
4. Tauri 构建时开启 `bundle > macOS > signingIdentity`（或环境变量 `APPLE_SIGNING_IDENTITY`），并在打包后执行 `notarytool submit --wait`、再 `stapler staple`；Tauri v2 可通过 `bundle.macOS.minimumSystemVersion` / `frameworks` 配合 `tauri-action` 的签名支持完成。

未配置上述 Secrets 前不要把包标注为“可直接安装”：本地 `npm run desktop:build` 产物同样未签名。

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
- Desktop Plugin API v1：命令、事件、声明式 UI（含 table / code / diff / input / image）、Pi、workspace 只读与白名单写入、Git 只读（`workspace.git`）、独立 storage、受限网络请求。
- 插件权限扩展：`workspace.write`（路径白名单、大小限制）与 `network.fetch`（域名白名单，由宿主代理、不跟随重定向）；审核界面展示新增权限与白名单。
- 本地文件夹/ZIP 审核安装；内容快照授权、自动加载已启用插件、手动 Reload、Disable、Uninstall。
- 左侧 **Pi 技能** 使用 Pi 资源解析结果显示用户、项目和 Pi 包内的 Skill 及启用状态。可按用户或项目范围添加、移除本地 Skill 路径；用户范围可启用或禁用 Skill，项目范围可为每个 Skill 选择继承、加载或卸载，并可设置是否在命令菜单中显示 `/skill:name`。左侧 **Pi 包** 支持用户或项目范围的安装、更新和移除。
- 每插件隔离 Worker、禁止直接 DOM/Tauri/其他插件；写文件与联网仅经宿主且受白名单约束；激活 timeout、heartbeat、payload 限额、崩溃清理。
- Pion 自身更新：设置页手动检查，可开启启动时自动检查并在后台静默下载，用户确认安装并重启后生效。
- Rust Pi JSONL：真实 `pi --mode rpc`、串行请求/响应关联、独立事件流、超时/退出处理。
- 无需修改 Core 的 [Hello 插件](examples/hello-plugin)，以及演示写入/联网/丰富 UI 的 [Plugin API 示例](examples/plugin-api-demo)。
- 一方 [Git/Diff 插件](plugins/git-diff-plugin)：只读展示当前工作区分支、staged/unstaged/untracked 改动与带行号的 unified diff（参考 VS Code / GitHub Desktop 的文件行与状态徽标），通过插件审核安装后加载，仅申请 `workspace.git` 权限。

## Git 审阅面板

打开任务后，顶栏的分支按钮显示当前项目未提交改动的 `+增 −删` 行数，点击即在对话右侧打开 **审阅** 面板（参考 Codex 的 Review 面板，宽度可拖动调整，开关状态会记住）：

- **范围**：未暂存 / 已暂存 / 分支（对比 `origin/HEAD` 指向的默认分支或 `main`/`master` 的分叉点）/ 上一轮（发送消息时记录工作区快照，对比 Pi 本轮改动；快照用临时 index 写成 tree，不影响真实暂存区）。
- **暂存与还原**：按文件或按 diff 块暂存、取消暂存、还原；还原与删除未跟踪文件需要再点一次确认。块操作会在宿主重新生成 diff 并逐字节匹配后才用 `git apply` 应用，diff 已变化时会提示刷新。
- **提交**：提交对话框可选择是否包含未暂存改动，以及「提交 / 提交并推送 / 提交并创建 PR」。创建 PR 使用已登录的 GitHub CLI（`gh pr create --fill`），已存在的 PR 直接返回链接。
- **分支与远程**：分支菜单可切换或新建分支；更多菜单提供抓取、拉取（仅快进）、推送、创建拉取请求。非 Git 项目可一键初始化仓库。

Git 命令都由宿主在当前项目目录内执行：路径必须是项目内相对路径并按字面匹配，不弹出终端或编辑器，SSH 使用 BatchMode，本地命令 20 秒、远程与提交（含 hooks）90 秒超时，执行期间不占用宿主共享状态锁。任务运行中不能提交或切换分支。

## 安装自己的插件

在桌面“设置 → 插件”中输入本地绝对目录路径，例如本项目的 `examples/hello-plugin`，点击 Review installation，再批准权限。

一方 Git/Diff 插件同样按此流程安装，输入本项目的 `plugins/git-diff-plugin` 目录即可。它只读取 Git 状态与 diff（`workspace.git` 权限），不写文件、不联网；在“设置 → 扩展面板”里可把它移动到主区域、右侧栏或底部面板。

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

`.github/workflows/build-installers.yml` 在推送到 `main`、面向 `main` 的 Pull Request 与手动触发时编译并打包：macOS（universal `.app` 与 `.dmg`）、Linux（`.deb` 与 `.AppImage`）和 Windows（NSIS `-setup.exe` 与 `.msi`）。`main` 自动升版并在三个平台全部成功后统一发布；PR 与手动运行仅上传 workflow artifacts。`npm run test:release` 用本地临时 Git 远端和模拟 GitHub API 检查升版、并发、重跑、完整更新清单和草稿恢复，不写真实远端。更新包签名不等于操作系统代码签名；当前 macOS 安装包仍未签名/公证，Windows/Linux 的浏览器沙箱与运行时行为仍需在对应平台人工验收。

插件沙箱采用 opaque-origin iframe + Blob Worker + CSP，适合当前受控 MVP。它不是 OS 容器，不能保证抵御浏览器漏洞或恶意内存耗尽。正式开放不受信任插件分发前需要独立安全评审和多平台原生验证。

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。你可以自由使用、复制、修改、合并、发布、分发、转授权和/或出售本项目的副本，并可将其包含在你的软件中，前提是保留本许可证与版权声明。软件按"原样"提供，不提供任何明示或默示保证。详见 [LICENSE](LICENSE)。
