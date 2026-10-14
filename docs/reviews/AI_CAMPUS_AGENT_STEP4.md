# Step 4 实施报告：材料解析 → 任务草稿（human-in-the-loop）+ 批量落库（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 4 ｜ 结论：**完成，后端 91/91 测试通过，前端三连通过（typecheck/lint/build）**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| AI 信息解析（PDF/图片/文本 → Task） | 复用前端既有客户端提取（PDF≤12 页文本层/DOCX/TXT/MD/CSV/ICS/HTML）→ `POST /api/tasks/extract`（`{text}` 或 `{imageDataUrl}`，截图由视觉模型一次调用直提，省 OCR 往返）→ 模板 `prompts/task-extract.md`（version:1）驱动 | ✅ |
| 草稿不落库、用户可编辑确认 | `TaskDraftModal`：逐条编辑标题/类型/截止/优先级/描述、可删除；`confidence<0.6` 强制核对警示；确认后 `POST /api/tasks` 批量创建（source=AI_PARSE） | ✅ |
| deadline 严禁猜测 | 模板规则 + 服务端三重清洗：无法解析→null、早于当天→null、模型漏规则时兜底；前端 DatePicker 允许留空 | ✅ |
| 任务批量创建能力 | `TaskService.create/createBatch`（title 非空≤500、type 六类白名单、priority 钳制 1-3、description≤2000、status=PENDING、`@Transactional` 任一条非法整体回滚） | ✅ |
| 与聊天上下文联动 | 抽取落库后立即可见于 `/ai` 聊天五段式【当前任务】段与输入框上方 chips（Step 3 已读 task 表，本步零改动） | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **`/tasks/extract` 用 JSON（text/imageDataUrl）而非 multipart 文件上传** | Step 0 已批准修正：服务端不引入 PDF 解析库，文件文本层提取沿用前端既有管线（与「转交 AI 助手」完全同源）；截图路径反而比 OCR 中转少一次模型往返 |
| **草稿不落库 + 手动确认创建，而非复用 ai_action 提案卡** | 提案卡当前无字段级编辑 UI，而抽取结果 confidence<0.6 必须强制人工核对；独立草稿模态给出完整编辑能力，确认走普通 REST，不占用提案状态机 |
| **`POST /api/tasks` 从 Step 5 提前到本步** | 草稿确认落库的前置依赖；`source` 由服务端按端点标注（AI_PARSE），不接受客户端指定，防止伪造来源 |
| **createBatch 加 `@Transactional`** | 「全有或全无」才是草稿确认的正确语义——测试先行发现无事务时首条合法任务已落库（半截数据），补事务后整体回滚 |
| **模型偶发非 JSON/脏字段在服务端清洗而非报错** | 复用既有 `parseJson` 降级链（剥代码块→readTree→截取最外层{}→纯文本兜底）；逐条清洗（空标题丢弃、type 白名单外归 OTHER、priority 钳制、超长截断）并在 note 中报告「已忽略 N 条」 |
| **截图路径复用 `parseImageText` 的校验与信号量** | 抽出 `validateImageDataUrl`（格式/4MiB/魔数）供两条路径共用；`imageAnalysisSlots`(2) 并发闸门原样保留，行为与既有截图 OCR 一致 |
| **图片 prompt 注入当前日期（含星期）** | 模板需要推断「10月20日」的年份；与聊天侧 `LocalDate.now(clock)` 同源，测试可用固定时钟确定化 |

## 3. 数据流

```
文件（PDF/DOCX/TXT/MD/CSV/ICS/HTML）
  → 前端 extractImportFileText（既有客户端提取，Step 0 批准）
  → POST /api/tasks/extract {text}
截图 → readChatImage → POST /api/tasks/extract {imageDataUrl}（视觉模型直提）
  → promptTemplates.get("task-extract") + 当前日期 → system
  → llmClients.active()（未配置 503，快速失败）
  → parseJson → toExtractResult：逐条清洗 + confidence 钳制 + note 汇总
  → TaskExtractResult（不落库）
前端 TaskDraftModal：用户核对/编辑（confidence<0.6 警示）
  → POST /api/tasks {tasks} → createBatch（@Transactional，source=AI_PARSE）
  → message.success；任务进入 task 表
  → /ai 聊天下轮【当前任务】段 + chips 自动可见（Step 3 链路）
```

## 4. 测试（新增 14 个，累计 91/91）

**`AiCampusAgentExtractTest`（10 个，Spring 集成，固定时钟 2026-09-27）**

| 测试 | 固化行为 |
|---|---|
| extractTasksFromCourseNoticeTextBuildsEditableDrafts | 课程通知文本 → 2 条草稿字段全对（title/type/deadline 精确到分钟/priority/description）；system 含「任务抽取器」+「当前日期：2026-09-27」；user 消息=原材料、无图片 |
| extractTasksFromScreenshotSendsImageToVisionModel | 真实 1x1 PNG data URL 通过格式/魔数校验；user 消息携带 imageDataUrl 走视觉模型；deadline=null 的草稿如实保留 |
| extractTasksCleansInvalidFieldsWithoutGuessingDeadlines | 空标题条目整条丢弃；白名单外 type→OTHER；过去截止→null；「下周五之前」不可解析→null；priority 99→3、0→1、缺省→2；60 字标题→50、260 字描述→200；ISO「T」分隔可解析；confidence 1.7→1.0；note 含「已忽略 1 条」 |
| extractTasksWithNothingToExtractReturnsZeroConfidenceAndNote | 空任务→confidence=0 + 「没有从材料中识别出需要完成的任务」 |
| extractTasksDegradesGracefullyWhenModelRepliesPlainText | 模型返回纯文本 → 降级为空草稿 + note，不抛错 |
| extractTasksRejectsMissingOrDuplicateInputs | 二者全无/二者俱全均 400「二选一」，且不调用模型 |
| extractTasksRejectsInvalidImageBeforeCallingModel | 非法 base64 图片 400，不调用模型 |
| extractTasksRequiresConfiguredProvider | 未配置 503 |
| createBatchPersistsDraftsOwnedByCaller | 落库归属/status=PENDING/source=AI_PARSE/时间戳；deadline=null 如实落库；他账号查不到 |
| createBatchRejectsWholeBatchWhenOneDraftInvalid | 一条空标题 → 整体 400 且零落库（事务回滚） |

**`TaskEndpointIntegrationTest`（4 个，真实应用启动 + MockMvc + 真实鉴权）**

| 测试 | 固化行为 |
|---|---|
| extractEndpointRequiresAuthentication | 无 Key / 未知 Key → 401 |
| extractThenConfirmCreatesTasksWithAiParseSource | 抽取响应（草稿+confidence+ISO 截止）→ 不落库 → 确认创建 → source=AI_PARSE、deadline IS NULL 计数正确、他账号 0 条 |
| createEndpointRejectsEmptyOrOversizedBatches | 空列表/21 条 → 400（@Size/@NotEmpty） |
| extractEndpointRejectsEmptyBodyAndUnsupportedImage | `{}` → 400「二选一」；非法 base64 → 400 |

## 5. 修复的缺陷

- **`createBatch` 缺事务**（测试先行发现）：无事务时任一条非法整体拒绝的语义不成立——首条合法任务已落库才抛错，用户面对半截数据。补 `@Transactional` 后整体回滚。

## 6. 变更文件清单

**新增（后端 main，6）**：`resources/prompts/task-extract.md`（version:1）、`dto/TaskDraft.java`、`dto/TaskExtractRequest.java`、`dto/TaskExtractResult.java`、`dto/TaskCreateRequest.java`、`controller/TaskController.java`

**修改（后端 main，3）**：`service/TaskService.java`（create/createBatch）、`service/impl/TaskServiceImpl.java`（实现+事务）、`service/AiService.java`（extractTasks 声明）、`service/impl/AiServiceImpl.java`（extractTasks 实现+清洗助手+validateImageDataUrl 重构 parseImageText 共用）

**测试（2）**：新增 `AiCampusAgentExtractTest`（10）、`TaskEndpointIntegrationTest`（4）

**前端（4）**：`types/index.ts`（TaskType/TaskStatus/TaskDraft/Task/TaskExtractResult）、`api/index.ts`（taskApi.extract/create）、`components/TaskDraftModal.tsx`（新增，草稿核对模态）、`components/QuickImportWidget.tsx`（「抽取为任务草稿」入口+双路径+创建成功反馈）

## 7. 与方案的偏离记录

1. **`/tasks/extract` 接收 JSON 而非 multipart 文件**（Step 0 已批准）：服务端零 PDF 依赖，文件文本提取在前端既有管线完成。
2. **草稿确认走 `POST /api/tasks` 而非 ai_action 提案**：提案卡无字段编辑 UI；confidence<0.6 的强制核对需要独立模态。ai_action 的 CREATE_TASK execute 分支仍留待 Step 5 与任务 CRUD 一起上线。
3. **`TaskService.create/POST /api/tasks` 提前实现**：草稿落库的前置依赖，非 Step 5 全量 CRUD（update/delete/status 流转仍在 Step 5）。

## 8. 遗留与下一步（Step 5 输入）

- Task CRUD 完整（update/delete/status 流转）+ AI Dashboard 首页（`/`→Dashboard）+ `/todos` 引导条
- ai_action 的 CREATE_TASK/UPDATE_TASK execute 分支 + TASK 作用域指纹（`invalidateProposalsOnDataChange(apiKey, SCOPE_TASK)`）
- 草稿模态目前只从 QuickImportWidget 进入；Step 5 Dashboard 可加「最近创建的任务」入口形成回路
- 任务暂无列表页：创建成功仅 message 提示，Step 5 补任务页后可改为「查看任务」跳转
