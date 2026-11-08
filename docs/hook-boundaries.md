# Hook 边界矩阵

实现基线：2026-11-08 的 [Codex Hooks 协议](https://learn.chatgpt.com/docs/hooks)，宿主验证基线 Harness 0.2.1-rc.2。仅覆盖以下七个 command 事件；其他事件有明确诊断，不能据此视为完整兼容。

## 事件语义

| 事件 | 触发与输入 | 有效控制与上下文 | 生命周期边界 |
| --- | --- | --- | --- |
| SessionStart | 主 agent 的 startup / resume / clear / compact 生命周期后，首个实际 pre-step 前；source matcher | 纯 stdout 或 additionalContext 留到第一个真正进入模型的请求；continue:false 拒绝当前输入 | 空会话创建不运行。后续输入被 UserPromptSubmit 或其他插件拒绝、操作被取消时保留启动上下文。已完成的同步处理器不因输入拒绝而重跑；审批未完成/被拒绝时可重试。compact 会重新触发。 |
| UserPromptSubmit | 待提交的用户消息或 Stop 续跑消息；prompt 取文本，原消息及图片等块不变；忽略 matcher | 纯 stdout / additionalContext；exit 2、decision:block、continue:false 拒绝当前输入批次 | 纯上下文 pre-step 不触发。被拒绝批次的 prompt 上下文不进入下一批；启动上下文继续保留。不自动重提被拒绝的用户输入。 |
| PreToolUse | 每个有 agent 的工具执行前；完整 tool_input、tool_use_id 和规范化 tool_name | deny / legacy block / exit 2 拒绝原调用；上下文注入。allow 仍经过下游安全策略 | 工具自身尚未执行。updatedInput 在宿主无法改参时拒绝原调用并返回重试说明；deny 优先于改参。无 agent 的执行不拦截，hook shell 不递归触发工具 hook。 |
| PostToolUse | 工具执行后，成功和错误均可观察；tool_response 保留 JSON 的 null / false / 0 / 空字符串 | block / exit 2 产生工具反馈；continue:false 用 stopReason 替换原结果后让模型继续；可附加上下文 | 无法撤销已产生的工具副作用。替换结果只使用 content，不同时保留结构化 value；下游 block 仍优先。suppressOutput / updatedMCPToolOutput 当前按 Codex 不支持字段诊断，保留正常结果流程。 |
| Stop | 主回合准备停止且 inbox 无下一步输入；忽略 matcher；包含 stop_hook_active、最后 assistant 文本或 null | block / exit 2 通过 steer 继续当前回合；continue:false 优先取消，不再 steer | 本插件 continuation 默认每回合最多 10 次；可配置 maxStopContinuations。新回合重置计数及最后文本；事件重放按消息 ID 去重恢复标志。权限失败、配置错误、取消不是续跑决策。 |
| Interrupt | 主回合由用户中断，turn/end 报告 user abort 后尽快触发；忽略 matcher | 仅通知；控制字段不能重启、阻断或重新开启回合 | 同一 turn 去重；hook / parent / disposed 取消不触发。只使用已审查版本；不弹新审批。默认 1 秒、限制 1–3 秒。 |
| SessionEnd | 已进入生命周期的主 agent 释放，或插件卸载；reason matcher 当前值 other | 仅清理通知；强制同步，控制字段不影响已结束会话 | dispose 与 unload 重叠只清理一次；使用缓存 cwd，避免退出时重新初始化目录。先停旧任务，再运行已审查且未变化的清理。未审查、已撤销、已改版配置不运行清理。默认 1 秒、限制 1–3 秒。 |

子 agent 仅运行 UserPromptSubmit 和工具事件；SessionStart / Stop / Interrupt / SessionEnd 为主会话事件。子 agent 的工具 payload 使用父 session_id，但执行授权绑定子 agent 自身会话，不能继承主会话授权。

## 协议和故障边界

- 退出 0 且输出为空表示成功。退出 2 仅在 UserPromptSubmit / PreToolUse / PostToolUse / Stop 阻断，反馈来自 stderr；此时 stdout 不参与决策。其他非零退出、进程异常、超时、stdout 截断或 JSON 解析失败记录诊断，不制造阻断决策。
- 纯 stdout 仅在 SessionStart / UserPromptSubmit 成为上下文；PreToolUse / PostToolUse / SessionEnd 忽略普通文本，Stop / Interrupt 要求 JSON。看似 JSON 的畸形输出不会降级成上下文。
- JSON 必须为对象；hookSpecificOutput.hookEventName 必须等于当前事件。共享控制字段与事件字段进行类型校验，避免把字符串 false 当布尔决策。PreToolUse 的 ask、continue、stopReason、suppressOutput、legacy approve 按 Codex 不支持字段处理。
- 匹配命令并行执行，输出按配置顺序合并；同优先级取第一个反馈，halt 高于 block 高于结果替换，deny 不会被另一个 allow 抵消。后台控制全部忽略。
- matcher 为区分大小写的正则子串匹配；空和 * 匹配所有。UserPromptSubmit / Stop / Interrupt 忽略 matcher，连无效正则也不影响这三个事件。Bash、Edit / Write 的别名只影响匹配，不篡改其他工具参数。
- timeout 单位秒，支持小数并向上取整到至少 1 毫秒；拒绝非正数、非有限数和超过计时器范围的值。宿主自身 shell 超时上限仍有效。Windows 包装保留原生命令退出码 2。
- 默认 stdout 上限 1 MiB。每个 additionalContext 默认约 2500 token，0 为不限；超限保存完整文本到 Host 临时文件，模型只收到首尾及路径。这里只做字符估算，不是模型 tokenizer 的精确 token 数。

## 审批、重载和竞态

| 场景 | 结果 |
| --- | --- |
| 同会话、同快照的多个并发调用 | 共享一次人类审查；取消一个调用不取消其他等待者。最后一个等待者取消才撤回请求。 |
| 审批超时、撤销、插件卸载 | 请求关闭；即使审批提供者忽略 signal 或迟到返回允许，也不能获得授权，不会无限挂起审批等待。 |
| 审批期间配置/脚本变化 | 旧请求撤回；执行前再次读取文件，不把旧回答应用到新版本。语法错误时不运行旧配置。 |
| 切换 cwd 或旧目录读取尚未完成 | 取消旧版本、清除授权，刷新到最新目录；旧目录快照不能覆盖新目录快照。 |
| 编辑器原子保存、同大小改写、新建/删除文件 | 内容哈希变化使授权失效。间接导入、复杂 shell 引用、无扩展名程序及数据依赖需声明 watchPaths。文件读取和进程启动不是原子事务，不能承诺消除文件系统 TOCTOU。 |
| revoke / reload 与输出写入同时发生 | 同步结果复核版本；后台、待注入和溢出写入后的旧上下文丢弃。 |
| 触发回合取消，但 async hook 尚未完成 | async 继续隶属于当前会话；输出等当前/下一回合安全 pre-step，不主动唤醒 agent。 |
| 会话结束、同 ID 重建 | 旧任务永久取消并排空；旧 dispose 不能删除新会话状态，旧结果和授权不能进入新会话。 |
| async 超过容量 | 每会话最多 8 个运行、256 个待运行；再多的调用跳过并记录诊断。SessionEnd 即使配置 async 也同步执行。 |
| 权限条会话切换、慢 list 或重复点击 | 立即卸下旧会话控件；迟到响应和已完成请求不能重新显示可授权控件；按钮单次提交。撤回后回答不再有效，网络错误可明确重试。 |

服务端审批 API 同时检查 Host owner、交互能力、会话资源、请求 ID、版本指纹和一次性完成状态。Enter 输入不授权；Escape 只在权限条内部明确拒绝，IME、按键重复和组合键不会提交。权限条是原生 dock 的附加内容，保留原 composer 和草稿。

## 验证入口与已知差异

- `test/protocol.test.mjs`：事件输入输出、退出码、matcher、非法类型和控制优先级。
- `test/engine.test.mjs`：权限、超时、并发、脚本哈希、配置失败、后台生命周期、会话重建及上下文版本。
- `test/host.test.mjs`：七个原生事件适配、首轮上下文、结果替换、Stop 重放与上限、通知去重和子 agent 边界。
- `test/client.test.mjs` / `test/permissions.test.mjs`：显式回答、会话切换、请求撤回、失败重试、输入法及审批类型校验。
- `npm run test:harness`：真实 Cordis / AgentLoop / shell / Approval / Typert Gateway / SlotCore；含 PostToolUse 替换后模型继续、跨会话/版本/重复回答拒绝和重载再授权。
- `npm run test:visual`：真实浏览器组件桌面与窄屏 QA；外围 composer 为夹具，不等于完整桌面应用端到端验收。

Harness 当前没有稳定的 Codex transcript 文件路径、权限模式映射、任意 developer 消息插入及完整结束原因；payload 为 transcript_path:null、permission_mode:default，附加上下文通过 Harness 消息通道注入，SessionEnd reason 为 other。SessionStart 延迟到 pre-step，Interrupt 在原生用户中断完成事件后触发。工具改参、未映射事件、非 command handler 和这些时序差异均为明确兼容缺口。
