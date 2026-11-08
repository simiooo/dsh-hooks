# Nuto 记忆注入排查

`<nuto-context status="budget_exceeded"/>` 是 Nuto 的注入状态，不是 DSH Hooks 未执行，也不表示记忆库已丢失。`nuto hook prompt` 默认 `--budget 1200`，其中还要扣除包装和预留预算；上下文放不下时，命令可以退出 0，只输出这行状态。

2026-11-08 在同一项目对照验证：默认预算仅返回 41 字节的状态标记；设置 `--budget 6000` 后返回 3886 字节，包含记忆和 issue；两次均退出 0。具体容量随记忆内容改变，6000 不是永久保证。需要更大预算时显式调整命令；不要绕过 Nuto 的预算检查或把截断后的用户规则当作完整注入。

`additionalContextLimit` 是 DSH Hooks 收到输出后的限制，不能替代 Nuto 自己的 `--budget`。共享的 `~/.codex/hooks.json` 同时影响 Codex；这次修复没有修改它。

## DSH 独立配置

将 [示例](examples/nuto-hooks.json) 复制为 `~/.dsh/hooks/nuto.json`，在本插件的原生配置中指定：

```yaml
config:
  discover: false
  configPaths: [~/.dsh/hooks/nuto.json]
```

`discover: false` 停止自动读取共享 Codex 配置。若还使用其他 hooks，把它们加入此独立文件或显式列入 `configPaths`，避免重复运行。通过插件详情页可继续编辑和启停。配置变化后，旧授权失效；重新审查后可选择永久允许。

示例保留五个 Nuto 事件，并在首次 prompt 与压缩后恢复的命令上指定预算。`SessionStart` 的 `matcher: compact` 只用于压缩后恢复；普通新会话依靠 `UserPromptSubmit` 的首次 prompt 注入。`PostCompact` 的输出按 Codex 协议不进入模型，恢复上下文由 `SessionStart(source=compact)` 完成。记忆是提炼的事实、规则和事项，不能等同于历史聊天全文。

验证时检查实际输出包含所需记忆及来源，不能只依据退出码。调大预算仍返回相同状态时，继续检查预算包装、tokenizer、当前项目及 Nuto 返回的具体约束；不要为了清除标记而删掉用户规则。
