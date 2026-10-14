# Step 3 实施报告：五段式上下文注入 + 截断策略 + 前端上下文 chips（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 3 ｜ 结论：**完成，后端 77/77 测试通过，前端三连通过**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| 【学生档案】全量注入 | `### 学生档案` 段：8 字段中文标注；空档案显示占位文案并约束 AI「先询问、不假设」 | ✅ |
| 【当前任务】未完成且 14 天内/已逾期 ≤15 条 | `### 当前任务` 段 + `TaskService.listOpen`（PENDING/IN_PROGRESS、窗口筛选、截止升序/无截止排后）；超限截断并标注「当前仅提供前 15 条，共 N 条」 | ✅ |
| 【长期记忆】ACTIVE 按 importance top 20 | `### 长期记忆` 段（`[类型·重要度N] 内容`）；超限标注「当前仅提供重要度前 20 条，共 N 条」 | ✅ |
| 【用户问题】永不截断 | user 消息本就在 system prompt 之外，天然满足 | ✅ |
| 截断策略统一 | 沿用既有 `appendContextRecord`（整条省略 + 标注，不截断 id/日期/脚本）；条数预算集中在 `AiPromptBuilder`（MAX_TASKS=15 / MAX_MEMORIES=20 / MAX_COURSES=100） | ✅ |
| 上下文 chips | `GET /api/ai/conversations/{id}/context` 返回 `AiContextSummary`（与注入同源同算）；输入框上方 chips：档案✓/未填写 · 课表 N 门 · 任务 N(+ ) · 记忆 N(+ ) | ✅ |
| 回答与真实数据一致 | 集成测试种子化（档案+课程+5 状态各异的任务+记忆），断言 prompt 含真实 id、窗口外/已完成任务不出现、排序正确 | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **新段追加在既有数据段之后，不动已有 sections** | 既有「已有课程/待办/考试/循环」是动作协议的基底（真实 id、撤销语义、现有测试断言），五段式是增量不是替换；方案 §2.6 的融合原则也是「扩展」 |
| **条数预算归 PromptBuilder，TaskService 只回答「有哪些未完成任务」** | 预算是 prompt 层的关注点；服务层不过早 limit，截断提示的「共 N 条」才可能真实 |
| **摘要与注入单一数据源**：`buildChatSystemPrompt` 返回 `ChatPrompt(prompt, summary)`，端点侧复用同一 `summarizeContext` 纯函数 | 避免 chips 计数与实际注入不一致（两套逻辑必然漂移） |
| **摘要走独立 GET 端点而非塞进消息响应** | 摘要是会话级关注点，不随消息持久化；发送前/切对话/执行提案后都可刷新，消息 DTO 保持干净 |
| **无截止时间的任务计入上下文（排在有时截止之后）** | 方案字面是「14 天内或已逾期」，但 Step 4 的 AI 抽取任务 deadline 禁猜常为 null——若排除，抽取结果在聊天里永远不可见；截断时按「紧急度」从尾部砍，无截止任务最后被砍，符合直觉 |
| **任务/记忆暂无对应 action，AI 被引导到页面操作** | 诚实原则段已声明「只能做 action.type 列出的操作」；Step 5 上线 CREATE_TASK 时同步补协议说明 |

## 3. 数据流

```
doSend：加载 profile/memories/openTasks（与指纹基线同批）
  → buildChatSystemPrompt(..., profile, openTasks, memories)
      → ChatPrompt{ prompt, summary }
  → system 消息 = prompt；主聊天/流式不变
前端：切对话/发送成功/执行提案 → GET /conversations/{id}/context → chips
```

## 4. 测试（新增 10 个，累计 77/77）

**`AiCampusAgentContextTest`（5 个，Spring 集成）**

| 测试 | 固化行为 |
|---|---|
| fiveSegmentContextInjectsRealIdsWithBudgetRules | 档案/任务/记忆/课程四段注入且带真实 id；窗口外（30 天）与已完成任务不出现；排序=逾期→窗口内→无截止；类型/状态中文标注 |
| taskBudgetCapsAtFifteenWithTruncationNote | 17 条窗口内任务 → prompt 仅 15 条 + 「共 17 条」标注，第 17 条标题不出现 |
| contextSummaryReflectsSeededData | 摘要计数与种子一致；窗口外任务不计入 |
| contextSummaryOnEmptyAccountIsAllZero | 空账号全 0、profilePresent=false |
| contextSummaryRejectsForeignConversation | 越权访问返回 404 |

**`AiCampusAgentPromptTest`（+5 个，纯单元）**：空数据占位三态、任务段 15 条截断+标注、记忆段 20 条截断+标注、档案全字段渲染、`summarizeContext` 预算与档案判定（含 courseCount 150→100）。

## 5. 变更文件清单

**新增（后端 main，3）**：`dto/AiContextSummary.java`、`service/TaskService.java`、`service/impl/TaskServiceImpl.java`

**修改（后端 main，4）**：`service/impl/AiPromptBuilder.java`（新签名+三段+预算+摘要+ChatPrompt record+标签助手）、`service/impl/AiServiceImpl.java`（TaskService 注入、doSend 接线、contextSummary）、`service/AiService.java`（接口方法）、`controller/AiController.java`（GET /conversations/{id}/context）

**测试（3）**：新增 `AiCampusAgentContextTest`；`AiCampusAgentPromptTest` +5；两个测试装配类 @Import 补 `TaskServiceImpl`

**前端（4）**：`types/index.ts`（AiContextSummary）、`api/index.ts`（contextSummary）、`pages/AiChatPage.tsx`（状态+加载+chips 渲染+三处刷新点）、`index.css`（.chat-context-chips）

## 6. 验收对照（方案 Step 3 行）

- 「问今天有什么课/最近任务/与目标差距，回答与库中真实数据一致」：注入内容含全部真实 id 与字段（fiveSegmentContext... 测试逐项断言）；模型侧回答质量由 DeepSeek 保证，输入侧真实性已固化。
- 「种子数据 10 任务+3 天课表演练」：测试用 5 条任务覆盖 逾期/窗口内/窗口外/已完成/无截止 五种状态 + 17 条批量截断，比验收种子更严。
- 回滚「模板版本回退」：persona/memory-extract 均版本化；五段式为代码段，回滚=还原本提交。

## 7. 遗留与下一步（Step 4 输入）

- 任务无 CRUD/页面（Step 5），当前只读；AI 无任务类 action（Step 5 补 CREATE_TASK/UPDATE_TASK 时需同步协议段与 TASK 作用域指纹）
- chips 刷新点：切对话/发送/执行/取消；设置页改档案或记忆后暂不实时刷新（Step 7 记忆管理页上线时补）
- 下一步：Step 4 文件解析（`/ai/parse-file` + `/tasks/extract` + task-extract.md）
