# Step 6 实施报告：AI 每日计划（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 6 ｜ 结论：**完成，后端 115/115 测试通过，前端三连通过（typecheck/lint/build，零新增 lint 警告）**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| daily-plan.md 模板（version:1） | `resources/prompts/daily-plan.md`：输出 `{date,items:[{start,end,type:COURSE\|TASK\|BREAK\|SUGGESTION,title,ref_id,note}],summary≤50}`；8 条规则约束课程块一致、任务块只排未完成、至少一个 BREAK、时间不重叠、不制造焦虑 | ✅ |
| `POST /api/plans/daily`（生成+缓存） | 命中缓存直接返回（`cached=true`），否则一次性生成 → 服务端校验 → 落库 `daily_plan`（uk(api_key,plan_date)） | ✅ |
| `GET /api/plans/daily?date=` | 只读缓存，未生成返回 null（首页加载永不烧 token） | ✅ |
| Dashboard「AI 建议」区填充 | `DashboardDto` 增 `plan` 对象 + `planSummary`；首页展示时间线与学长式总评，未生成时给「生成今日计划」入口 | ✅ |
| 验收：课程块与课表一致 | 服务端逐条校验 `ref_id` 属于今日课程、起止时刻等于节次换算值、今日课程不得遗漏；任一不符 502 且不落库 | ✅ |
| 验收：任务块均未完成 | `ref_id` 必须属于未完成任务（PENDING/IN_PROGRESS）；引用已完成任务或凭空 id → 502 | ✅ |
| 验收：含 BREAK | 全天无休息块 → 502「没有安排休息」 | ✅ |
| 验收：summary 无焦虑措辞 | 模板明令禁止施压措辞；服务端截断至 50 字 | ✅ |
| 验收：二次生成命中缓存 | `verify(chatJson, times(1))`：第二次 generate 直接返回 `cached=true` | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **计划是「校验过的结构化时间线」而非自由文本** | 首页要展示可核对的一天：课程块必须与课表一致、任务块必须是真实未完成任务。约束由服务端强制（不通过 502 让用户重试），而不是靠模型自觉——一份与课表矛盾的时间线比没有计划更糟 |
| **课程时刻由服务端按作息表换算，不让模型推算** | 模型常把「第1-2节」脑补成 08:00-10:00。服务端把换算后的 `08:00-09:35` 直接写进输入，校验时用同一函数比对，保证「输入所见＝校验所据」 |
| **不合规直接 502，不做逐条清洗降级** | 与材料抽取（可丢弃个别脏条目）不同，计划是一个整体：丢弃课程块会漏课、丢弃任务块会让计划残缺。宁可让用户点一次重试，也不给半截计划 |
| **生成即缓存，一天一条** | 省 token 且首页展示稳定（不会每次刷新换一套安排）；`uk_daily_plan_date` 保证唯一，`GET` 只读、`POST` 才可能触发模型 |
| **计划输入用全量未完成任务，不用聊天的 14 天窗口** | `listOpen` 的 14 天窗口是聊天上下文预算裁剪，会把「下下周截止但今天该动工」的任务藏起来（测试先行发现：10-15 截止的任务被窗口排除，导致计划里的任务块被判无效）。计划场景需要模型看到全部未完成事项再决定今天推进哪些 |
| **缓存损坏视为未生成** | content JSON 解析失败返回空列表而非抛错，用户重新生成即可；不让一条坏数据把首页打挂 |
| **未配置由注册表统一抛 503** | `LlmClientRegistry.active()` 已覆盖「未配置/全 provider 不可用」，计划侧不再重复一套文案（原实现里的 `isConfigured` 分支是永远走不到的死代码，已删） |

## 3. 数据流

```
GET /api/dashboard（首页）── 只读 daily_plan 缓存 → plan + planSummary
                             未生成 → null，前端显示「生成今日计划」

POST /api/plans/daily {date?, scheduleId?}
  → 命中缓存？→ 返回 cached=true（不调模型）
  ↓ 否
  装配真实输入（AiPromptBuilder.buildDailyPlanInput）：
    日期/星期/教学周 + 作息表 + 今日课程（id/名称/换算后起止时刻/地点/教师）
    + 全部未完成任务（id/标题/类型/优先级/截止/状态）+ 学生档案
  → prompts/daily-plan.md（system） + 输入（user） → llmClients.active().chatJson
  → parseJsonOrFail（剥代码块 → readTree → 截取最外层 {} → 失败 502）
  → toValidatedItems 服务端校验：
      类型白名单 / HH:mm 且 end>start / 课程块与课表逐条一致（含不漏课）
      / 任务块只引用未完成任务 / 至少一个 BREAK / 标题≤50、note≤50、summary 截断至 50
  → 落库 daily_plan（items JSON + summary）→ 返回 cached=false
```

## 4. 测试（新增 12 个，累计 115/115）

**`AiCampusAgentDailyPlanTest`（11 个，Spring 集成，固定时钟 2026-09-27，计划日 2026-09-28 周一）**

| 测试 | 固化行为 |
|---|---|
| generateBuildsTimelineFromRealCoursesAndTasksThenCaches | 4 块时间线按开始时刻升序；课程块 08:00-09:35 与第1-2节一致、refId=课程 id；任务块 refId=任务 id；落库一天一条；模型输入含真实课程 id 与换算时刻、含任务标题 |
| secondGenerateHitsCacheWithoutCallingModel | 第二次 `cached=true`、摘要一致、`verify(chatJson, times(1))` |
| getReturnsCachedPlanOnly | 生成前 `get` 为 null；生成后非 null；另一天 null |
| planRejectsCourseBlockThatDisagreesWithTimetable | 课程时间被改成 09:00-10:00 → 502「课程时间与课表不一致」，零落库 |
| planRejectsWhenTodaysCourseIsOmitted | 漏掉今天的课 → 502「遗漏了今天的课程」 |
| planRejectsTaskThatIsNotOpen | 引用已 DONE 的任务 → 502「不存在或已完成的任务」 |
| planRejectsTimelineWithoutBreak | 无休息块 → 502「没有安排休息」 |
| planRejectsUnparsableModelOutput | 模型返回纯文本 → 502「未返回可解析的计划」 |
| planRequiresConfiguredProvider | 未配置 → 503（注册表统一文案「AI 服务未配置或暂时不可用」） |
| emptyDayStillProducesSuggestionAndBreak | 无课无任务时仍产出 SUGGESTION+BREAK，且按时刻升序 |
| planTruncatesOverlongSummary | 80 字摘要截断为 50 字 |

**`DashboardIntegrationTest`（+1）**：`dashboardCarriesCachedDailyPlanSummary` —— 预置一条缓存，`GET /api/dashboard` 返回 `planSummary`、 `plan.cached=true`、 `plan.items[0].type=COURSE`；其余 3 个测试仍断言未生成时 `planSummary` 为 null。

## 5. 测试先行发现的 3 个真实缺陷（偏离记录）

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| 1 | `Long refId = cond ? node.asLong() : null` —— 三元表达式混用 `long` 与 `null` 触发**自动拆箱 NPE**，任何 `ref_id=null` 的块（BREAK/SUGGESTION）都会让生成直接崩 500 | 8 个测试同时报 `NullPointerException: Cannot invoke "java.lang.Long.longValue()"` | 改为显式 if/else 分支并注释说明 |
| 2 | `isConfigured()` 分支永远走不到：`LlmClientRegistry.active()` 先抛 503 | 测试期望「AI 未配置」实际得到「AI 服务未配置或暂时不可用」 | 删除死代码，与聊天/抽取共用注册表降级文案 |
| 3 | 用 `taskService.listOpen(...)` 取任务，14 天窗口把 10-15 截止的任务排除 → 合法任务块被判「不存在或已完成」 | 主流程测试直接 502 | 改用全量 `list(apiKey)` 过滤未完成状态并限流 30 条；注释说明「窗口只是聊天预算裁剪」 |

## 6. 变更文件清单

**后端（8）**

- `resources/prompts/daily-plan.md`（新）
- `service/impl/AiPromptBuilder.java`（改）：`buildDailyPlanInput` + `periodStart/periodEnd/courseTimeRange`（节次↔时刻换算）
- `dto/DailyPlanDto.java`（新）：date/items/summary/cached + 嵌套 DailyPlanItem
- `service/DailyPlanService.java`（新）、`service/impl/DailyPlanServiceImpl.java`（新）
- `controller/DailyPlanController.java`（新）：`GET/POST /api/plans/daily`
- `dto/DashboardDto.java`（改）：增 `plan`
- `service/impl/DashboardServiceImpl.java`（改）：注入 DailyPlanService，填 plan/planSummary
- （`entity/DailyPlan`、`mapper/DailyPlanMapper` 已于 Step 1 随迁移建好，本步首次启用）

**后端测试（2）**：`service/impl/AiCampusAgentDailyPlanTest.java`（新，11）、`controller/DashboardIntegrationTest.java`（+1，并加入 daily_plan 清理）

**前端（4）**

- `types/index.ts`（改）：`DailyPlanItemType`/`DailyPlanItem`/`DailyPlan`，`DashboardData.plan`
- `api/index.ts`（改）：`planApi.get/generate`
- `components/PlanTimeline.tsx`（新）：四类块按颜色区分的时间线
- `pages/DashboardPage.tsx`（改）：AI 建议区支持「生成今日计划」（loading/失败提示）+ 缓存计划渲染 + 「今日已生成」标签 + 刷新

## 7. 验证记录

- 后端：`./mvnw -B test -o` → **Tests run: 115, Failures: 0, Errors: 0**（存量 103 全回归 + 新增 12）
- 前端：`npm run typecheck` 通过；`npm run lint` 0 错误、7 警告（与基线一致，全部位于存量文件）；`npm run build` 通过

## 8. 遗留与下一步（Step 7 输入）

- 计划一旦生成当天不再变动：数据变化（新增任务/改课程）不会自动失效缓存。如需「数据变了提示重新生成」，可在 Task/Course 写操作时按日期清除当日缓存
- 「任务块不压在课程块上」目前只由 Prompt 约束（规则 5），未做服务端硬校验——避免模型轻微重叠就直接 502 打断体验
- Step 7：长期记忆去重合并（UPDATE 分支 + type 唯一性校验）、importance 治理、设置页管理 UI、top-N 调优
