# DSH Hooks

为 DeepSeek Harness 复用 **Codex command hooks**。支持配置和脚本热重载、逐 hook 的全局／项目／会话权限，以及原生设置页和会话浮层。当前是 0.5.0，支持下表中的九个事件，**尚未完整覆盖 Codex hooks**。

## 安装

```sh
dsh plugin --profile web add @simooom/dsh-hooks@0.5.0
```

把 `web` 换成你的实际 profile。npm 包附带编译产物，安装时不需要执行构建脚本；开发版也可以通过 `github:simiooo/dsh-hooks` 安装。该 profile 需要原生 `shell`、`workingDirectory`；权限条还需要 Web/桌面 Client、Typert Gateway 和 conversation UI。验证基线为 Harness **0.2.1-rc.2**；上游接口仍会变化。

默认读取 `CODEX_HOME`（未设置时为 `~/.codex`）中的 `hooks.json`、`config.toml`，再从当前 Git 项目根目录到会话目录逐层合并 `.codex/hooks.json` 和 `.codex/config.toml`。匹配的处理器累加，不用项目配置覆盖用户配置。

输入框上方仅显示 Hooks 浮层和允许数量。点击后，在 Harness 原生弹框中逐项查看有效权限、继承来源和命令，选择「跟随设置」「允许」或「拒绝」。这里的修改只作用于当前会话；关闭或 Escape 不作答，也不影响草稿。

设置页管理持久的全局和项目规则，每条 hook 都有「继承」「允许」「拒绝」。解析顺序是 **会话 → 项目 → 全局 → 默认待授权**，取最近的明确规则。继承项实时跟随设置，明确覆盖保持独立。项目以规范化 Git 根目录识别，子目录共享项目规则，独立 worktree 分开；无 Git 时以工作目录识别。

全局「默认允许」适用于所有项目中已确认的执行版本，不覆盖逐项拒绝或局部例外。新增 hook、命令或脚本变化仍需确认；名称和排序变化保留原授权。关闭默认允许只撤回默认值，保留逐项规则。会话的「恢复继承」删除当前实例的覆盖，不修改模板。

权限拒绝、未授权、配置错误和插件异常均在插件边界捕获并跳过 hook；消息、原生工具和压缩继续。Web/桌面权限独立于 DSH 工具审批，完全权限模式同样可操作。只有已授权 hook 按协议明确返回的阻断决定才控制执行。新允许用于后续事件，不补跑已跳过的 hook。

全局／项目规则保存在 Host 私有的 `~/.dsh/hooks-data/permissions/policy.json`，以互斥写入、观察版本和原子替换防止并发覆盖。可以通过 `permissionsDir` 或 `pluginDataRoot` 移动存储。权限 API 仅允许交互式 **Host owner**；项目配置只能声明 hook，不能自行授予执行权限。保存前先写入 `permissions/audit/` 意图记录，审计记录本身不授予执行权限；保存失败不会降级允许。

撤销或重载只取消受影响 hook 的任务，并丢弃旧版本待注入输出；其他 hook 继续。其他 Host 在下一次权限检查或轮询时观察变化；停止已启动进程仍取决于原生 shell 的取消支持。会话实例关闭、重建后删除临时覆盖，重新继承模板。

0.4.x 的目录授权仍按原目录和整份快照匹配，**不会自动扩大为全局或项目授权**。旧审批接口保留给兼容客户端和 CLI；新会话弹框不提供永久授权或跨域修改。详细规则见 [权限模型与边界](docs/permissions.md)。

Nuto 输出 `budget_exceeded` 的原因及 DSH 独立配置见 [记忆注入排查](docs/nuto-memory.md)。

## 在插件详情中配置

打开 **插件 → DSH Hooks → 钩子**：

- 来源卡片显示用户、项目、自定义和插件配置的钩子数、问题数；刷新按钮重新读取，打开页面时也会自动更新。
- 「权限」区域选择所有项目或当前项目，逐项设置规则、查看生效来源，使用恢复继承按钮删除本层覆盖。全局默认允许开关保留逐项和局部例外。
- 点击来源，按事件查看钩子；展开显示命令、超时、匹配器及后台状态。未支持事件或无效处理器保留展示并禁用开关。
- 逐项启用开关立即影响 DSH 执行并在重启后保留；停用会取消该 hook 的任务，保留其他 hook 的权限。启用后仍检查执行版本。
- 「编辑配置」打开实际 JSON / TOML 源文件并显示规范化后的真实路径。保存前校验语法和对应配置；文件、脚本、链接目标或开关已变化时拒绝过期保存，保留编辑草稿。TOML 原文和注释按用户编辑后的文本保存。
- 默认用户文件尚不存在时，可从空来源的「创建配置」建立 `hooks.json`。创建使用排他发布，不覆盖同时新建的文件。

有多个已知工作目录时，目录选择器切换所检查的项目层；用户配置适用于所有项目。详情贡献仅显示在本插件的 bundle / row 页面，使用原生 `plugins.detail.section` 插槽，无需修改 Harness。

启用开关保存在 Host 的 `~/.dsh/hooks-data/controls.json`，可通过 `controlsPath` 改写；设置 `pluginDataRoot` 时默认随之移动。权限身份根据来源和逻辑项生成，也可在 handler 上指定稳定的 `id`；名称和不同条目的排序变化不重置权限。旧开关 ID 兼容读取。配置文件本身只在用户明确保存编辑时修改。

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
| `PreCompact` | 实际摘要处理前运行，matcher 匹配 `manual` / `auto`；`continue:false` 在摘要请求与历史替换前停止。普通 stdout 与 additionalContext 不进入模型。 |
| `PostCompact` | 历史替换提交后运行，matcher 匹配 `manual` / `auto`；`continue:false` 停止后续继续，保留已提交摘要。不向模型注入上下文。 |
| `Stop` | block/exit 2 续跑；正确维护 `stop_hook_active` 和最后一条 assistant 文本；`continue:false` 优先。忽略 matcher，仅主会话。 |
| `Interrupt` | 用户中断的主回合结束后尽快执行；只使用已审查版本，不阻止中断。 |
| `SessionEnd` | agent 释放或插件卸载时执行清理；只使用已审查版本，强制同步。插件卸载也会触发，这是 Harness 侧的扩展。 |

各事件的触发、取消、错误、并发和重载边界见 [边界矩阵](docs/hook-boundaries.md)，并由协议、引擎、宿主适配和 Client 回归测试覆盖。

压缩事件适配 Harness 原生 `BasicCompactionEngine` 的摘要扩展点，保持原生选择、计价、prune、摘要请求、历史提交与 flush。手动压缩保留同步 maintenance 互斥；没有实际可压缩区间时不运行这两个 hook。其他压缩后端需要提供相同扩展约定。详细时序与 DeepSeek V4.1 / 1017 缓存回归见 [压缩与缓存说明](docs/compaction-and-cache.md)。

配置仅含压缩 hook 时，会在普通输入回合先展示版本审查。空闲 `/compact` 使用已经审查的版本；新配置或重载后的版本需先在普通输入回合批准，避免往回合外写入无效审批记录。DSH 空闲 maintenance 没有活动 turn，手动 payload 的 `turn_id` 为 `""`；自动压缩使用实际活动 turn。主会话成功压缩后按 `PostCompact → SessionStart(source=compact)` 恢复上下文，覆盖不重新进入 pre-step 的超窗重试。

共享输入包含 `session_id`、`transcript_path:null`、`cwd`、`hook_event_name`、实际 model，以及适用事件的 `turn_id`。目前 `permission_mode` 为兼容占位值 `default`，不代表 Harness 当前审批模式。子 agent 的工具事件使用父 `session_id`。

- `bash` / `exec_command` 映射为 `Bash`，`apply_patch` 也匹配 `Edit` / `Write`；其他工具保留原名。非 shell 参数完整传递；`exec_command.cmd` 同时映射到 `tool_input.command`。
- 同事件匹配的命令并发启动，按配置顺序合并反馈。超时单位为秒，默认 600 秒；清理/中断默认 1 秒、最多 3 秒，仍受宿主 shell 上限约束。
- 支持 `commandWindows`（TOML 也接受 `command_windows`）、`statusMessage`、`async`、`additionalContextLimit`。异步命令每会话最多并发 8 个，待运行上限 256；人类审查先于后台启动。异步任务独立于触发它的回合取消，输出在当前或下一回合的后续 pre-step 注入，不主动开启回合，不接受后台控制决策。撤销、重载、会话结束和卸载仍会取消并丢弃旧输出。
- `additionalContextLimit` 默认为约 2500 token，按每 token 4 字符估算；0 直通。较长输出存入本机临时目录，只注入首尾和路径。单次 stdout 默认上限 1 MiB；被截断的协议输出不会作为有效决策。
- 命令通过 `ctx.shell` 执行，保留宿主取消、沙箱和凭据过滤。`systemMessage` / `statusMessage` 写入 Harness 日志，不另外模拟 Codex 的 hooks UI。
- 插件命令获得 `PLUGIN_ROOT`、`PLUGIN_DATA` 和对应的 `CLAUDE_PLUGIN_*` 变量。数据目录默认 `~/.dsh/hooks-data/<root hash>`，可通过 `pluginDataRoot` 改写。

**明确的能力差异：**

- `PermissionRequest`、`SubagentStart`、`SubagentStop`、`PreModelRequest`、`PostModelRequest` 会输出不支持的诊断；不会伪造等价事件。当前公开拦截点不足以保证它们的 Codex 时序。
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
npm run test:compaction
```

验证运行真实 Cordis、AgentLoop、shell 和 Typert Gateway，覆盖独立 Owner 授权、完全权限下手动操作、工具拒绝、完整参数、首轮上下文、PostToolUse 结果替换与继续、Stop 状态、脚本热重载及重新授权、跨会话/错误版本/重复回答拒绝、交互权限和撤销；另验证详情管理 API 的读写、持久开关、过期保存拒绝、访客拒绝及原生详情插槽注册。浏览器读取原生输入卡 CSS，对照桌面宽度上限、自定义宽度、hero、移动和嵌入布局的左边缘。普通测试另覆盖并发、超时、异步队列、原子保存和协议边界。

`test:compaction` 使用原生 AgentLoop、BasicCompactionEngine 和 DeepSeek Messages 适配器对回环 SSE 服务测试；对比手动、压力、真实超窗错误重试三条链路启用 hook 前后的完整 HTTP JSON 字节与 beta header，验证工具声明、thinking/signature 和调用能力保留。无实际模型调用，也不把模拟的 cache usage 当作线上命中率测量。

`npm run test:visual` 可在已安装 Edge 的 Windows 上检查真实权限组件的桌面/窄屏布局与交互，截图写入 `.artifacts/`；其他平台通过 `BROWSER_PATH` 指定 Chromium 可执行文件。预览中的外围 composer 是测试夹具。

`npm run test:settings` 使用真实配置管理存储及浏览器，检查来源列表、事件详情、问题、窄屏、原生 dialog 焦点、持久启停和源文件编辑。截图写入 `.artifacts/settings-*.png`；外围插件详情页是夹具，配置及开关仅写入独立临时目录。

开发交付按本项目要求不部署 staging。尚未声称完整桌面宿主的端到端视觉验收；UI 的组件交互及原生插槽契约单独验证。

协议依据：[Codex Hooks](https://learn.chatgpt.com/docs/hooks)、[Codex 插件布局](https://developers.openai.com/plugins/build/plugins)、[Harness 上游 bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/hooks-codex)。参考比较了 [Claude hooks](https://code.claude.com/docs/en/hooks) 与 [pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，对外协议以 Codex 为准，未承诺运行 pi 的 TypeScript extensions。
