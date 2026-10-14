# Step 2 实施报告：AIService 抽象层 + 学长人格 + 记忆提炼（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 2（LLM 抽象层 → DeepSeek 适配器 → 学长人格接入 → 记忆提炼触发）｜ 结论：**完成，67/67 测试通过，前端三连通过**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| 泛化 `DeepSeekClient` 为 `LlmClient` 接口 | `service/LlmClient.java`（保留全部同步/流式/取消能力，新增 `providerId()`） | ✅ |
| Provider 注册表 + `app.llm.active-provider` | `service/LlmClientRegistry.java` + `config/LlmProperties.java` + application.yml | ✅ |
| DeepSeek 适配器 | `service/DeepSeekLlmClient.java`（git mv 自 `impl/DeepSeekClientImpl`，temperature 改为可配置） | ✅ |
| 学长人格 Prompt（模板文件化 + 版本管理） | `resources/prompts/persona.md`（v1）+ `impl/PromptTemplateRegistry.java`（front matter 版本解析，classpath 加载+缓存） | ✅ |
| 人格接入 messages/stream 两条路径 | `AiServiceImpl.doSend`：persona 前置注入 system prompt，回调路径同样生效 | ✅ |
| Student 档案服务（AI 可写） | `dto/StudentProfilePatch.java` + `service/StudentProfileService(+Impl)`：白名单 8 字段、类型/长度校验、标签去重限流、`snapshot()` 供 _before | ✅ |
| Memory 长期记忆服务 | `service/MemoryService(+Impl)`：类型白名单（GOAL/INTEREST/ABILITY/HABIT/PREFERENCE）、content≤200、importance 钳制 1-5、source 区分 USER/AI | ✅ |
| 记忆提炼触发（human-in-the-loop） | `AiServiceImpl.refineMemory`：每轮回复落库后一次轻量调用（`memory-extract.md` v1），产出 SAVE_MEMORY/UPDATE_PROFILE 提案（PENDING），用户确认后才写库 | ✅ |
| 提案与 done 事件自动合流 | 提炼提案插入同一 assistant 消息，`toResponse` 从 DB 重载 actions，SSE `done` 后前端 `refreshMessages` 自动可见，**SSE 协议零改动** | ✅ |
| 新作用域 PROFILE/MEMORY + 指纹失效 | `scopeOf`/`fingerprintOf` 扩展；档案/记忆各有独立指纹输入（纯函数），调用模型前算快照，execute 时比对 | ✅ |
| 前端渲染新提案类型 | `types/index.ts`（AiActionType + AiActionScope）；`AiActionCard.tsx`（记忆卡 + 档案 diff 表 + 作用域标签） | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **保留「客户端断开不落库」语义**（偏离方案 §2.4 的 persist-on-stop） | 现有测试 `cancelledStreamDoesNotPersistAssistantOrProposal` 固化了这一刻意设计，且 AGENTS.md 要求保留 AI 提案边界；中断即丢弃比半截落库更干净。提炼仅在正常完成后触发 |
| **人格/提炼 Prompt 走 classpath 模板文件**（非硬编码字符串） | 后续调人格只改 md 不改 Java；front matter `version` 进日志，便于线上排查「哪版人格产生了这条提案」 |
| **`legacy-direct` 作为回滚开关** | `active-provider=legacy-direct` 时映射为 deepseek，V1.0 行为与原实现完全等价；未来接第二家 provider 只改配置 |
| **注册表回退策略**：激活项未注册/未配置 → 回退任一已配置客户端；全不可用 → 503 降级文案 | 「换模型/加模型」不该让 AI 功能整体不可用；但完全没配 key 时必须明确失败而不是白跑一轮数据库写入 |
| **UPDATE_PROFILE 的 `_before` 存整份档案快照（对象）**，其余 action 存数组 | 档案是单例，撤销时按字段反向恢复；无档案时 `_before` 缺失 = 「新建档案」语义，前端据此切换文案 |
| **提炼失败只记日志不抛错** | 学长可以不在线，记忆可以下次再提炼；主回复链路永不被次要功能阻断 |

## 3. 数据流（记忆提炼链路）

```
用户消息 → doSend：
  ① 加载 profile/memories（_before 与指纹基线，调用模型前算快照）
  ② llmClients.active() 快速失败（未配置 → 503，不写库）
  ③ persona 注入 system prompt → 主聊天（同步/流式）
  ④ 短事务落库 assistant + 主提案（拆分/校验/_before 富化/同作用域旧提案失效）
  ⑤ refineMemory：memory-extract 模板 + 档案 + 已有记忆 + 最近 12 条对话窗口
     → 轻量 chatJson → SAVE_MEMORY / UPDATE_PROFILE 提案 → 同一消息落库
  ⑥ toResponse 重载 actions 返回（提炼提案随 done 自动可见）
用户点确认 → executeAction：claim → 指纹比对（过期→STALE+409）→ applyAction → 兄弟提案续接/失效
```

## 4. 测试（67/67 通过，基线 54 → 67）

**新增 `AiCampusAgentChatTest`（7 个，Spring 集成，真实 H2+Mapper+Flyway，仅 mock LLM）**

| 测试 | 固化行为 |
|---|---|
| systemPromptCarriesSeniorPersonaAndProposalProtocol | 主聊天 system prompt 含学长人格 + JSON 协议 + 数据权威性约束 |
| refinementProposesMemoryAndProfileAndExecuteWritesBoth | 提炼产出双提案（scope/status 正确、`_before` 非空）；**确认前零落库**；execute 后记忆与档案双双写入 |
| multipleMemoriesSplitIntoIndependentProposals | 多条记忆拆成独立卡片 |
| invalidRefinementProposalsAreDroppedWithoutTouchingData | 非法类型/空 content/越权字段全部丢弃，主提案不受影响 |
| memoryDataChangeMarksPendingMemoryProposalStale | 设置页改记忆 → 记忆域指纹变化 → 提案 STALE + 409 |
| profileDataChangeMarksPendingProfileProposalStale | 设置页改档案 → 档案域指纹变化 → 提案 STALE + 409 |
| refinementFailureDoesNotBreakMainReply | 提炼调用抛异常 → 主回复与主提案完好 |

**新增 `AiCampusAgentPromptTest`（6 个，纯单元）**：front matter 版本解析与剥离、classpath 模板加载、缺失模板返回 null、`buildMemoryRefineWindow` 三段式内容与截断。

**适配**：`OptimizationRegressionTest`（@MockBean 改 LlmClient、@Import 新 bean、清理表扩 4 张）、`DeviceAuthIntegrationTest`（类型替换）。

## 5. 修复的缺陷（本步实测发现）

| 缺陷 | 发现途径 | 修复 |
|---|---|---|
| `PromptTemplateRegistry.parse` front matter 定位错误（version 恒 0、body 未剥离） | PromptTest | 重写 parse：要求 `---\n` 开头、`\n---` 收尾且校验独立成行 |
| **`applyAction` UPDATE_PROFILE 未剥 `_before` 直接 parse → 400「不支持的档案字段」**（执行链路真实 bug，提案永远执行不了） | 测试预置档案后暴露 | 执行时 deepCopy 剥 `_before` 再 parse |
| 过期提示语对 PROFILE/MEMORY 域错误显示「待办已发生变化」 | 代码审查 | 新增 `scopeLabel()`，提示语按作用域生成 |

## 6. 变更文件清单

**新增（后端 main，10）**：`service/LlmClient.java`、`service/LlmClientRegistry.java`、`config/LlmProperties.java`、`service/DeepSeekLlmClient.java`（mv）、`dto/StudentProfilePatch.java`、`service/StudentProfileService.java`+`impl/StudentProfileServiceImpl.java`、`service/MemoryService.java`+`impl/MemoryServiceImpl.java`、`service/impl/PromptTemplateRegistry.java`、`resources/prompts/{persona,memory-extract}.md`

**修改（后端，5）**：`service/impl/AiServiceImpl.java`（注册表注入/persona/refineMemory/新 action 全链路/新 scope 指纹/_before 富化/scopeLabel）、`service/impl/AiPromptBuilder.java`（persona 参数 + buildMemoryRefineWindow）、`config/DeepSeekProperties.java`（temperature 可配置）、`application.yml`（`app.llm.active-provider`）、`service/DeepSeekClient.java`（删除，接口已泛化）

**测试（4）**：新增 `AiCampusAgentChatTest`、`AiCampusAgentPromptTest`；适配 `OptimizationRegressionTest`、`DeviceAuthIntegrationTest`

**前端（2）**：`types/index.ts`、`components/AiActionCard.tsx`

## 7. 验证记录

- 后端：`./mvnw -B test` → **Tests run: 67, Failures: 0, Errors: 0**，BUILD SUCCESS
- 前端：`npm run typecheck`（0 错误）→ `npm run lint`（0 错误，7 个既有 react-refresh warning 与本次无关）→ `npm run build`（成功）

## 8. 遗留与下一步（Step 3 输入）

- 档案/记忆尚未进入聊天 system prompt（五段式上下文）——Step 3 主任务
- 前端无档案/记忆管理页（当前只能经 AI 提案间接写入）——Step 7
- `Task`/`DailyPlan` 服务与页面未动——Step 5/6
- 提案执行无「撤销」入口（`_before` 已具备，前端 diff 已展示）——按方案属 V1.0 范围外，记录待议
