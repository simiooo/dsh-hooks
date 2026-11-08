# 压缩时序与 DeepSeek 缓存

0.3.0 支持 Codex `PreCompact`、`PostCompact`。依据为 [Codex 官方协议](https://learn.chatgpt.com/docs/hooks)；原生验证为 Harness 0.2.1-rc.2 的 BasicCompactionEngine。DSH 的摘要扩展点可继承原有回放和请求构造，插件不另行实现摘要算法。

## 实际时序

1. 原生策略检查 token 压力 / 超窗错误，或 `/compact` 同步取得 maintenance；选择合法、工具成对的区间。
2. 宿主同步写入 `compaction/start` 锁标记并准备只读回放输入。这个标记不替换模型历史。
3. 在原生摘要扩展点等待 `PreCompact`。`continue:false` 取消操作，此时尚未调用摘要模型或替换历史。
4. 原样调用原生 summarizer。它保留会话系统消息、工具和选中历史，把原生摘要指令放在尾部。恢复重试继续使用同一个事务的 PreCompact 结果。
5. 原生摘要、工具配对校验、历史替换、`compaction/end` 和手动 flush 按宿主原有流程执行。
6. 已提交的压缩等待 `PostCompact`；它可停止继续，但不撤销已提交摘要。提交后的 flush 失败也触发一次 PostCompact，再保留原持久化错误。
7. 主会话执行 `SessionStart(source=compact)`；其上下文通过持久消息尾部追加，在第一次压缩后请求之前可见，包括不再经过 pre-step 的超窗重试。手动维护若追加了恢复文本，再 flush 该尾部后才释放维护锁。

原生 `compaction/start` 是锁及审计标记，因此早于 PreCompact；实际摘要与历史压缩晚于 PreCompact。等待 hook 时保留原生互斥和取消语义。没有可压缩区间的 no-op、busy 和无效区间不会调用摘要扩展点，因此不触发这两个事件。原生日志重放不会重新执行 hook。

## 协议与边界

| 条件 | 行为 |
| --- | --- |
| manual / auto | matcher 匹配 trigger。pressure 和 context-overflow 均为 auto；手动 `/compact` 为 manual。 |
| turn_id | 自动压缩传实际活动 turn；DSH 空闲 maintenance 无活动 turn，传空字符串，不借用上一回合 ID 或制造新回合。 |
| continue:false | Pre 在摘要请求/历史替换前停止；Post 在已提交摘要后停止继续。均保留待处理用户输入。 |
| stdout / additionalContext | Pre/Post 不将这些文本注入模型；additionalContextLimit 产生忽略警告。systemMessage 保留日志用途。 |
| exit 2、legacy block、解析失败、超时 | exit 2 为 hook 失败，不是压缩 veto；legacy block 没有压缩控制语义。解析/进程/超时遵循非阻断 hook 失败策略。 |
| async | 后台处理不能阻断已启动的压缩，也不会把 Pre/Post 上下文写进模型；会话/版本生命周期仍有效。 |
| 同事务重试 / 连续收敛 | 摘要恢复重试共享一次 Pre；新原生压缩事务各有一对 Pre/Post。 |
| 失败 / 取消 | 摘要或替换失败不运行 Post。取消不启动新的后续 hook；已提交历史不回滚。 |
| Post 停止后新输入 | 保留 source=compact 的待恢复状态；下一次显式输入执行 SessionStart，不自动开启模型回合。 |
| 权限 | compact-only 配置在普通输入回合先审查，Pre 也先覆盖 Post 的权限。空闲 manual 只复用已审查或永久允许的版本，避免在回合外开启审批。未获授权时跳过 hook，仍执行原生压缩；只有实际 hook 的明确停止决策才停止压缩。 |
| 重载 / 撤销 | 旧版本 hook 进程及待输出失效；不会重放已通过的 Pre，也不会撤销已提交历史。后续阶段重新检查当前版本；空闲 manual 不能开启新审批。 |
| 插件或压缩服务卸载 | 取消并排空适配器操作；还原原生方法描述符，保留后来注册的外层包装。 |

当前通过 BasicCompactionEngine 的文档化 `summarize` 扩展点及 `compactRegion` / `compactNow` 接入；后者必须同步调用 `runMaintenance`。它是局部、可卸载的实例适配，不更换原生 compactor，也不修改磁盘上的 Harness 源码。没有这些约定的自定义压缩后端会报告兼容错误，需要自己的适配；不将同步 session 观察事件冒充可等待的压缩拦截点。

## 缓存保持条件

[DeepSeek 官方缓存指南](https://api-docs.deepseek.com/guides/kv_cache/) 要求复用已经持久化的完整前缀单元。模型自己的 KV 压缩与调用方请求前缀复用是不同层面的机制；插件能验证请求保持条件，无法保证远端调度、缓存保留时间和实际命中率。[1017 官方模型卡及报告入口](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017) 保留作为版本背景。

Harness 原生实现依据：[原生 summarizer](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/src/summarizer.ts)、[DeepSeek 适配器](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/src/adapter.ts)。适配器继续使用原始回放对象、模型路由、工具声明、推理配置和会话元数据。插件不注册动态 system prompt，不设置 startsRequestSeries，不重建摘要 messages，不改写 thinking/signature，也不介入原生 in-history 系统更新、addition-only 工具能力和图片策略。

压缩本身替换历史，按宿主原有行为在首个被替换 token 后改变前缀；这不是 hook 引入的额外变化。Pre/Post 诊断不进入模型；SessionStart 的有效恢复文本属于明确配置的新上下文，追加到尾部。

## 可复现验证

```powershell
$env:DSH_SOURCE_DIR = 'D:\path\to\built-harness'
npm run test:compaction
```

脚本使用真实 Cordis、AgentLoop、BasicCompactionEngine、TokenMeter、Approval 和 DeepSeek Messages 适配器，连接本机 SSE 端点，不使用真实密钥或调用线上模型。

分别运行无插件和有插件两组：手动 maintenance、原生压力策略、HTTP context_length_exceeded 后的真实原生恢复重试。比较完整 HTTP JSON 原始字节、解析后的 body、beta 及稳定身份/压缩 header，包括真实工具声明、thinking/signature 回传、in-history / addition-only 能力。通过两轮之间改变系统提示，实际验证旧 system 头保留而新快照进入历史。Pre/Post 测试返回的 additionalContext 必须完全不出现在模型请求中；另验证两种加载顺序、Pre/Post 停止分支，以及溢出重试前的 SessionStart 恢复。

实测这三组无模型上下文输出场景的请求完全相同。该测试证明插件没有额外破坏原生请求前缀；SSE 返回的模拟 cache usage 不是线上缓存命中率测量。
