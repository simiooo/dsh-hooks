# DSH Hooks

为 DeepSeek Harness 复用 **Codex command hooks**。支持插件详情中的配置管理、配置和脚本热重载、输入框上方的人类授权，以及会话级撤销。当前是 0.2.0，支持下表中的事件，**尚未完整覆盖 Codex hooks**。

## 安装

```sh
dsh plugin --profile web add github:simiooo/dsh-hooks
```

把 `web` 换成你的实际 profile。仓库附带编译产物，安装时不需要执行构建脚本。该 profile 需要原生 `shell`、`workingDirectory`、`approval`；权限条还需要 Web/桌面 Client、Typert Gateway 和 conversation UI。验证基线为 Harness **0.2.1-rc.2**；上游接口仍会变化。

默认读取 `CODEX_HOME`（未设置时为 `~/.codex`）中的 `hooks.json`、`config.toml`，再从当前 Git 项目根目录到会话目录逐层合并 `.codex/hooks.json` 和 `.codex/config.toml`。匹配的处理器累加，不用项目配置覆盖用户配置。

首次触发时，输入框上方显示授权条。展开后可以查看**所有可执行命令、事件、来源文件和工作目录**。点击「本会话允许」才执行；「拒绝」不运行命令。授权绑定当前会话与文件内容版本，不写入永久白名单。工具栏盾牌图标可随时撤销。

原生审批服务保留 `approval/asked` / `approval/decided` 审计。权限 API 使用 Harness 的认证与资源授权通道，只有具有交互能力的 **Host owner** 可以查看和批准；共享访客不能授权主机代码。无 UI 的 profile 使用原生审批回答器；没有回答器或审批被禁用时拒绝执行。

授权不在会话间继承；子 agent 的工具 hook 在对应子会话中单独审查。

## 在插件详情中配置

打开 **插件 → DSH Hooks → 钩子**：

- 来源卡片显示用户、项目、自定义和插件配置的钩子数、问题数；刷新按钮重新读取，打开页面时也会自动更新。
- 点击来源，按事件查看钩子；展开显示命令、超时、匹配器及后台状态。未支持事件或无效处理器保留展示并禁用开关。
- 逐项开关立即影响 DSH 执行，并在重启后保留。开关变化撤销旧版本审批及运行任务，后续执行重新审查。
- 「编辑配置」打开实际 JSON / TOML 源文件并显示规范化后的真实路径。保存前校验语法和对应配置；文件、脚本、链接目标或开关已变化时拒绝过期保存，保留编辑草稿。TOML 原文和注释按用户编辑后的文本保存。
- 默认用户文件尚不存在时，可从空来源的「创建配置」建立 `hooks.json`。创建使用排他发布，不覆盖同时新建的文件。

有多个已知工作目录时，目录选择器切换所检查的项目层；用户配置适用于所有项目。详情贡献仅显示在本插件的 bundle / row 页面，使用原生 `plugins.detail.section` 插槽，无需修改 Harness。

开关保存在 Host 的 `~/.dsh/hooks-data/controls.json`，可通过 `controlsPath` 改写；设置 `pluginDataRoot` 时默认随之移动。它们适用于读取同一配置的 DSH 会话/profile。开关身份绑定来源路径、事件、所在位置及命令；移动或修改命令后视为新钩子，仍须重新审查。配置文件本身只在用户明确保存编辑时修改。

管理 API 仅允许交互式 Host owner；请求使用 Host 已枚举的工作目录和来源 ID，拒绝任意文件路径。界面不执行展示中的命令。详情页依赖原生插件管理页面；会话权限条继续使用原有 composer 插槽。

## 最小示例

`.codex/hooks.json`：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "^Bash$",
      "hooks": [{
        "type": "command",
        "command": "node ./hooks/guard.mjs",
        "timeout": 10,
        "statusMessage": "Checking command"
      }]
    }]
  }
}
```

`hooks/guard.mjs`：

```js
let input = '';
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
if (event.tool_input.command?.includes('DROP DATABASE')) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Review the database deletion first.'
    }
  }));
}
```

这是协议示例，不是完整的命令安全策略。工具名称和参数可被脚本直接检查。

也可以修改该插件行的 `config`：

```yaml
config:
  discover: false
  configPaths: [./.codex/hooks.json]
  pluginRoots: []
  watchPaths: [./hooks/policy.json]
  pollIntervalMs: 1000
```

相对 `configPaths` / `watchPaths` 以每个会话的当前工作目录解析。`pluginRoots` 为用户显式选中的 Codex 插件根目录；支持根 `plugin.json` 的 `extensions.com.openai.hooks`、`.codex-plugin/plugin.json` 和默认 `hooks/hooks.json`。显式声明会替代插件默认文件发现。路径必须留在插件根目录，拒绝越界与越界符号链接。

## 兼容范围

| Codex 事件 | 当前行为 |
| --- | --- |
| `SessionStart` | 在首个模型请求前执行；支持 source matcher、纯文本/JSON 上下文、`continue:false`。为展示人类授权，延迟到首个实际输入的 pre-step，创建空会话时不运行。仅主会话。 |
| `UserPromptSubmit` | 拒绝输入、上下文、`continue:false`；忽略 matcher。不会对单纯注入的上下文重复触发。 |
| `PreToolUse` | 完整参数、deny、legacy block、exit 2、上下文。allow 仍经过宿主后续策略。 |
| `PostToolUse` | 保留结构化结果（包括 `null`）；block 转为工具反馈；`continue:false` 替换原结果为反馈，模型继续。 |
| `Stop` | block/exit 2 续跑；正确维护 `stop_hook_active` 和最后一条 assistant 文本；`continue:false` 优先。忽略 matcher，仅主会话。 |
| `Interrupt` | 用户中断的主回合结束后尽快执行；只使用已审查版本，不阻止中断。 |
| `SessionEnd` | agent 释放或插件卸载时执行清理；只使用已审查版本，强制同步。插件卸载也会触发，这是 Harness 侧的扩展。 |

各事件的触发、取消、错误、并发和重载边界见 [边界矩阵](docs/hook-boundaries.md)，并由协议、引擎、宿主适配和 Client 回归测试覆盖。

共享输入包含 `session_id`、`transcript_path:null`、`cwd`、`hook_event_name`、实际 model，以及适用事件的 `turn_id`。目前 `permission_mode` 为兼容占位值 `default`，不代表 Harness 当前审批模式。子 agent 的工具事件使用父 `session_id`。

- `bash` / `exec_command` 映射为 `Bash`，`apply_patch` 也匹配 `Edit` / `Write`；其他工具保留原名。非 shell 参数完整传递；`exec_command.cmd` 同时映射到 `tool_input.command`。
- 同事件匹配的命令并发启动，按配置顺序合并反馈。超时单位为秒，默认 600 秒；清理/中断默认 1 秒、最多 3 秒，仍受宿主 shell 上限约束。
- 支持 `commandWindows`（TOML 也接受 `command_windows`）、`statusMessage`、`async`、`additionalContextLimit`。异步命令每会话最多并发 8 个，待运行上限 256；人类审查先于后台启动。异步任务独立于触发它的回合取消，输出在当前或下一回合的后续 pre-step 注入，不主动开启回合，不接受后台控制决策。撤销、重载、会话结束和卸载仍会取消并丢弃旧输出。
- `additionalContextLimit` 默认为约 2500 token，按每 token 4 字符估算；0 直通。较长输出存入本机临时目录，只注入首尾和路径。单次 stdout 默认上限 1 MiB；被截断的协议输出不会作为有效决策。
- 命令通过 `ctx.shell` 执行，保留宿主取消、沙箱和凭据过滤。`systemMessage` / `statusMessage` 写入 Harness 日志，不另外模拟 Codex 的 hooks UI。
- 插件命令获得 `PLUGIN_ROOT`、`PLUGIN_DATA` 和对应的 `CLAUDE_PLUGIN_*` 变量。数据目录默认 `~/.dsh/hooks-data/<root hash>`，可通过 `pluginDataRoot` 改写。

**明确的能力差异：**

- `PermissionRequest`、`PreCompact`、`PostCompact`、`SubagentStart`、`SubagentStop`、`PreModelRequest`、`PostModelRequest` 会输出不支持的诊断；不会伪造等价事件。当前公开拦截点不足以保证它们的 Codex 时序。
- 只执行 `command`，其他 handler 类型诊断后跳过。没有实现 Codex 的 MCP tool hooks、prompt/agent hooks、管理员配置层和逐插件持久信任 UI。
- Harness 的工具参数在 pre-execute 前已冻结并记录，无法安全实现 `updatedInput`。有效的改参请求会**拒绝原调用**并说明原因，避免悄悄执行旧参数。Codex 当前不支持的 `ask` 等 PreToolUse 输出按协议诊断，不绕过宿主审批。
- 为避免错误脚本无限续跑，`Stop` 默认最多继续 10 次，可配置 `maxStopContinuations`。
- 配置和脚本来自 Host 文件系统。远程 shell 的执行目录、脚本路径必须在 Host 与执行环境可对应；stdout 溢出路径是 Host 本机路径。
- 默认 Windows 使用 PowerShell 语义，并保留原生程序的退出码 2。Windows Host 使用 POSIX/SSH shell 时设置 `shellFlavor: posix`；可显式设置 `powershell`。该选项同时决定 `commandWindows` 的选择。

## 热重载

按文件内容及实际路径哈希检测变化，不依赖 mtime。覆盖配置、manifest、命令直接引用的 `.js/.mjs/.cjs/.ts/.py/.sh/.ps1/.cmd/.bat` 文件和 `watchPaths`；新增文件、删除文件、编辑器原子保存和同内容链接换目标都可检测。解释器导入的模块、无扩展名程序、复杂 shell 间接引用和数据文件请显式加入 `watchPaths`。

文件变化会取消旧版本的待审批请求和运行任务，清除该版本授权；下一次执行重新审查。每个事件执行前也复核快照。配置语法错误会阻止相关操作，不继续执行旧配置。热重载不自动重放已发生的事件；插件自身代码更新遵循 Harness 的插件加载/重启流程。

审批默认等待 120 秒（`permissionTimeoutMs`）；超时、撤回及最后一个等待者取消均关闭请求，迟到的允许不生效。并发触发共享同会话、同版本审批，单个操作取消不撤销其他等待者。配置错误或权限未批准不会被解释成 Stop 的续跑决策；Interrupt / SessionEnd 跳过未审查版本，不弹出新审批。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
npm pack
```

真实 Harness 验证使用已构建的源码工作区，不需要模型密钥：

```powershell
$env:DSH_SOURCE_DIR = 'D:\path\to\deepseek-harness'
npm run test:harness
```

验证运行真实 Cordis、AgentLoop、shell、原生审批审计和 Typert Gateway，覆盖工具拒绝、完整参数、首轮上下文、PostToolUse 结果替换与继续、Stop 状态、脚本热重载及重新授权、跨会话/错误版本/重复回答拒绝、交互权限和撤销；另验证详情管理 API 的读写、持久开关、过期保存拒绝、访客拒绝及原生详情插槽注册。普通测试另覆盖 UI 操作、并发、超时、异步队列、原子保存和协议边界。

`npm run test:visual` 可在已安装 Edge 的 Windows 上检查真实权限组件的桌面/窄屏布局与交互，截图写入 `.artifacts/`；其他平台通过 `BROWSER_PATH` 指定 Chromium 可执行文件。预览中的外围 composer 是测试夹具。

`npm run test:settings` 使用真实配置管理存储及浏览器，检查来源列表、事件详情、问题、窄屏、原生 dialog 焦点、持久启停和源文件编辑。截图写入 `.artifacts/settings-*.png`；外围插件详情页是夹具，配置及开关仅写入独立临时目录。

开发交付按本项目要求不部署 staging。尚未声称完整桌面宿主的端到端视觉验收；UI 的组件交互及原生插槽契约单独验证。

协议依据：[Codex Hooks](https://learn.chatgpt.com/docs/hooks)、[Codex 插件布局](https://developers.openai.com/plugins/build/plugins)、[Harness 上游 bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/hooks-codex)。参考比较了 [Claude hooks](https://code.claude.com/docs/en/hooks) 与 [pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，对外协议以 Codex 为准，未承诺运行 pi 的 TypeScript extensions。
