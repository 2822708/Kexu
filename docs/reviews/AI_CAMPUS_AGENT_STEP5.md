# Step 5 实施报告：Task 全量 CRUD + TASK 作用域提案 + AI Dashboard 首页（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 5 ｜ 结论：**完成，后端 103/103 测试通过，前端三连通过（typecheck/lint/build，零新增 lint 警告）**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| Task CRUD + 状态流转 | `TaskService` 全量接口：list/listOpen/list(筛选)/get/create/createBatch/update/delete/updateStatus；`TaskController` 对应 GET `/api/tasks`（status/type/deadlineBefore/deadlineAfter）、GET `/{id}`、POST、PUT `/{id}`、PATCH `/{id}/status`、DELETE `/{id}`；写操作后 `invalidateProposalsOnDataChange(SCOPE_TASK)` | ✅ |
| AI 提案创建/修改任务 | `scopeOf` 新增 TASK 作用域（第五个）；协议行 CREATE_TASK/UPDATE_TASK + 「任务模块说明」Prompt 段；`applyAction` 两分支（CREATE_TASK 落库 source=AI_PARSE、sourceRef=`message:{id}`；UPDATE_TASK 缺 id→400）；`enrichBeforeSnapshot` 为 UPDATE_TASK 生成 `_before` 快照供前端 diff | ✅ |
| TASK 作用域指纹 | `taskFingerprintInput` 纯函数覆盖**全部任务**（id/title/type/deadline/priority/status/description，任何字段变化含状态流转都被察觉）；与查库现算同源；与 TODO/COURSE/PROFILE/MEMORY 四作用域互相隔离（手动改任务只失效任务提案） | ✅ |
| AI Dashboard 接口 | `GET /api/dashboard?date=&scheduleId=` 一次聚合：档案+问候名、今日课程（dayOfWeek+教学周双命中）、今日任务（今天截止/已逾期/无截止）、48h 截止单列、14 天考试倒计时、规则计算的今日重点；planSummary 为 Step 6 占位 null；scheduleId 缺省取最近创建课表，他人课表 404 不泄露 | ✅ |
| Dashboard 页面上线 | `/` → `DashboardPage`（问候→今日课程→今日任务→48h→考试倒计时→今日重点→AI 建议占位→底部聊天入口）；`/timetable` 保留；`/todos` 顶部「待办 vs 任务」引导条；侧边栏新增「首页」且选中判定对 `/` 精确匹配 | ✅ |
| 提案卡渲染 | `AiActionCard` 增 CREATE_TASK（任务摘要行）/UPDATE_TASK（changed-only diff 表，复用 DIFF_COLUMNS）；ACTION_LABELS/SCOPE_TAGS(TASK→cyan)/作用域说明同步 | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **任务提案校验放在 `isValidProposal` 既有框架内，而非执行时才报错** | 与课程/待办/考试提案完全同构：提案阶段即校验标题/类型白名单/优先级 1-3/状态白名单/deadline 可解析（不可解析的截止不生成提案，避免用户确认后执行才失败）；UPDATE_TASK 额外校验目标任务存在且属于当前账号 |
| **指纹覆盖全部任务而非仅未完成任务** | AI 提案基于全部任务推理（UPDATE_TASK 可能引用已完成任务）；任何字段变化——包括把任务标记 DONE——都必须让相关提案失效，否则旧推理会施加到新数据上 |
| **`update` 补丁语义：title 必填、type/priority 缺省保持、deadline=null 显式清除** | 前端编辑与 AI 提案都按完整字段提交，null 即「用户要清空」；与 updateStatus 分工——前者改内容，后者专管状态流转（白名单校验，值不变则不动 updatedAt） |
| **列表排序显式 nulls-last：`ORDER BY (CASE WHEN deadline IS NULL THEN 1 ELSE 0 END), deadline ASC, id ASC`** | H2 与 MySQL 的裸 `ORDER BY deadline ASC` 都把 NULL 排最前，与「无截止排后」的产品预期相反；CASE 表达式跨两个 vendor 通用（测试先行固化） |
| **Dashboard 今日重点由后端规则计算，不烧 token** | 逾期/今天截止/48h/考试倒计时是确定性推导，规则计算保证输出稳定、零成本、可测试；真正的「AI 每日计划」留给 Step 6 的 planSummary |
| **今日课程「星期 + 教学周」双命中** | 单测固定时钟 2026-09-28（周一、第 4 周）：周一课程命中、周三课程不出现；复用 `AiPromptBuilder.weekOf` 与聊天上下文同源同算 |
| **手动任务变更也触发提案失效** | `TaskController` 写操作后统一调 `aiService.invalidateProposalsOnDataChange(apiKey, SCOPE_TASK)`——用户在页面改数据与 AI 自己改数据，对提案生命周期一视同仁 |

## 3. 数据流

```
AI 聊天：模型返回 {"actions":[{"type":"CREATE_TASK","data":{"tasks":[...]}}]}
  → splitToSingleActions（按 tasks 数组拆独立卡片）
  → scopeOf → TASK；isValidProposal（标题/类型/优先级/状态/deadline 可解析；UPDATE_TASK 校验归属）
  → enrichBeforeSnapshot（UPDATE_TASK 从 ProposalContext.tasks 找目标任务生成 _before）
  → ai_action 落库（PENDING + TASK 作用域指纹）
用户点「确认执行」→ applyAction：
  CREATE_TASK → taskService.create(source=AI_PARSE, sourceRef="message:{messageId}")
  UPDATE_TASK → taskService.update（status 非空则流转）
  → 同作用域旧提案失效；执行后指纹重算，数据变化的提案标记 STALE（409）

手动 CRUD（REST）→ TaskController → TaskService → invalidateProposalsOnDataChange(TASK)

GET /api/dashboard（一次聚合）
  → 档案 + 今日课程（schedule 双命中）+ 今日任务（今天截止/已逾期/无截止）
  + 48h 截止 + 14 天考试 + 规则今日重点（planSummary=null 占位）
前端 DashboardPage：TaskCard（优先级徽章+倒计时）+ 聊天入口
```

## 4. 测试（新增 12 个，累计 103/103）

**`AiCampusAgentTaskTest`（7 个，Spring 集成，固定时钟 2026-09-27，H2 MODE=MySQL）**

| 测试 | 固化行为 |
|---|---|
| createTaskProposalExecutesWithAiParseSourceAndSourceRef | CREATE_TASK 提案 scope=TASK/PENDING；提案阶段零落库（human-in-the-loop）；执行后落库且 source=AI_PARSE、sourceRef=message:{messageId} |
| updateTaskProposalCarriesBeforeSnapshotAndExecutes | `_before` 快照携带原标题；执行后标题/截止/优先级/描述全改；source=MANUAL 不被 AI 覆盖 |
| updateTaskProposalCanTransitionStatus | status→DONE 后 listOpen 为空（已完成任务退出聊天上下文与首页） |
| taskDataChangeMarksPendingTaskProposalStale | 手动建任务 → TASK 指纹变化 → 提案执行 409（消息含「任务」），目标任务未写入 |
| taskScopeIsIndependentFromTodoScope | 同一回复含 CREATE_TASK+CREATE_TODO：手动改任务后 TODO 提案照常执行、TASK 提案 409 |
| taskCrudLifecycleWithOwnershipChecks | 他人读写删一律 404；列表截止升序+无截止排后；status/类型/deadlineAfter 筛选；非法 status 400；补丁语义（deadline=null 清除、type/priority 保持、updatedAt isAfter）；状态流转白名单；删除后 404 |
| createTaskRejectsInvalidDrafts | 空标题/非法类型/越界优先级均 400 且零落库 |

**`DashboardIntegrationTest`（3 个，真实应用 + MockMvc + 设备注册鉴权）**

| 测试 | 固化行为 |
|---|---|
| dashboardAggregatesProfileCoursesTasksAndRuleBasedHighlights | 聚合断言：1 门今日课（周三课不出现）/3 个今日任务/1 个 48h/1 场考试倒计时/4 条规则重点（「已逾期 8 天」「今天截止」「将在 36 小时后截止」「还有 7 天考试」）/planSummary null |
| dashboardForFreshAccountIsEmptyButFriendly | 新账号全空但 200，greetingName null、profilePresent false |
| dashboardRejectsForeignScheduleAndRequiresAuth | 未登录 401；他人 scheduleId 404 不泄露；本人 200 |

**`TaskEndpointIntegrationTest`（+1）**：`taskCrudOverHttpWithOwnershipIsolation` —— HTTP 全链路：创建→列表/筛选（含非法 status 400）→越权 GET/PUT/DELETE 404→PATCH status→PUT 补丁→DELETE→404。

**`AiCampusAgentPromptTest`（+1）**：`chatPromptProtocolDocumentsTaskActionsAndModuleRules` —— 固化协议两行（CREATE_TASK/UPDATE_TASK 字段与 status 白名单）与「任务模块说明」段（task vs todo 分工、deadline 禁猜、priority 语义、status 流转、动宾标题）。

## 5. 测试先行发现的 3 个真实缺陷（偏离记录）

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| 1 | `isValidProposal` 的 recordField switch 漏了 `CREATE_TASK/UPDATE_TASK` → 落入 `default -> null` → **所有任务提案被静默判为无效丢弃**（响应里根本不出现提案卡） | 5 个提案测试 `orElseThrow` No value present | 补分支 + 任务字段校验（标题/类型/优先级/状态/deadline 可解析/UPDATE_TASK 归属）；`hasValidJsonFieldTypes` 补 description/deadline/type/status 文本性与 priority 整型约束 |
| 2 | `baseWrapper` 裸 `orderByAsc(deadline)`：H2/MySQL 的 ASC 均把 NULL 排最前，「无截止排后」不成立 | 排序断言 actual=[无截止, 更早, 高数] | `last("ORDER BY (CASE WHEN deadline IS NULL THEN 1 ELSE 0 END), deadline ASC, id ASC")` |
| 3 | 测试种子用 `Timestamp.valueOf("2026-09-28 23:59")`（缺秒）抛 IllegalArgument | DashboardIntegrationTest seedTask | `LocalDateTime.parse(deadline.replace(" ","T"))` 规范化 |

## 6. 变更文件清单

**后端主代码（10）**

- `controller/TaskController.java`（改）：全量端点 + 写操作后 TASK 作用域提案失效
- `dto/TaskDraft.java`（改）：新增 `status` 字段（仅 update 路径有意义）
- `service/TaskService.java`（改）：完整 CRUD 接口（含筛选列表与 updateStatus）
- `service/impl/TaskServiceImpl.java`（改）：重写——ALLOWED_STATUSES、nulls-last 排序、补丁语义、状态白名单、`@Transactional createBatch`
- `service/impl/AiServiceImpl.java`（改）：SCOPE_TASK、scopeOf/scopeLabel/fingerprint/ProposalContext/_before/applyAction/split/toTaskDraft/isValidProposal 全套
- `service/impl/AiPromptBuilder.java`（改）：协议两行 + 任务模块说明段
- `controller/DashboardController.java`（新）、`dto/DashboardDto.java`（新）、`service/DashboardService.java`（新）、`service/impl/DashboardServiceImpl.java`（新）

**后端测试（4）**

- `service/impl/AiCampusAgentTaskTest.java`（新，7）、`controller/DashboardIntegrationTest.java`（新，3）、`controller/TaskEndpointIntegrationTest.java`（+1）、`service/impl/AiCampusAgentPromptTest.java`（+1）

**前端（11）**

- `types/index.ts`（改）：AiActionType +2、AiActionScope +TASK、StudentProfile、DashboardData
- `api/index.ts`（改）：taskApi 全量 CRUD + dashboardApi
- `api/client.ts`（改）：request 支持 PATCH
- `App.tsx`（改）：`/`→Dashboard、`*`→`/`
- `components/AppLayout.tsx`（改）：导航加「首页」、`/` 精确匹配选中、顶栏标题回首页
- `components/AiActionCard.tsx`（改）：CREATE_TASK/UPDATE_TASK 渲染 + TASK 作用域
- `components/TaskDraftModal.tsx`（改）：类型/优先级标签改抽 `utils/task.ts` 共享
- `pages/TodosPage.tsx`（改）：「待办 vs 任务」引导条
- `components/TaskCard.tsx`（新）、`pages/DashboardPage.tsx`（新）、`utils/task.ts`（新）

## 7. 验证记录

- 后端：`./mvnw -B test -o` → **Tests run: 103, Failures: 0, Errors: 0**（存量 91 全回归 + 新增 12）
- 前端：`npm run typecheck` 通过；`npm run lint` 0 错误、7 警告（与基线完全一致，零新增）；`npm run build` 通过（chunk 大小警告为存量 antd vendor 分包）

## 8. 遗留与下一步（Step 6 输入）

- `planSummary` 恒为 null，Dashboard「AI 学长建议」区为占位引导——Step 6 每日计划上线后填充
- 任务暂无独立管理页（列表/编辑/删除走 AI 对话与首页展示）；如需纯手动管理可基于已就绪的 `taskApi` 全量 CRUD 增页
- 手动任务创建入口（source=MANUAL）尚未在 UI 暴露，`POST /api/tasks` 目前固定 source=AI_PARSE
