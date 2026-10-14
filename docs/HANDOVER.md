# HANDOVER — 项目交接主文件（多 Agent 协作用）

> **本文件是项目的「当前状态唯一真相」。** WorkBuddy 与 Codex 交替开发同一份代码，任何 Agent 在开工前先读本文件，收工前必须更新本文件（至少更新「会话日志」与「当前状态快照」）。
>
> 最近更新：2026-10-14 ｜ 更新者：WorkBuddy ｜ 对应提交：`99d4f4c`

---

## 0. 协作规则（务必遵守）

| 规则 | 说明 |
|---|---|
| **开工先读本文件** | 不要凭记忆或旧报告判断进度。`docs/reviews/*` 是历史报告，只有本文件的「当前状态快照」代表现在。 |
| **收工必更新本文件** | 至少更新：① 会话日志追加一条 ② 当前状态快照（HEAD / 测试数 / lint 警告数）③ 下一步待办。 |
| **改代码前先 `git status`** | 另一个 Agent 可能刚提交过。发现工作区有未提交改动，先读完再决定是接续还是另起。 |
| **一个 Step 一个提交** | 提交信息格式：`Step N: <中文简述>`。不要掺入无关重构。 |
| **改完必须跑双端验证** | 后端 `./mvnw -B test -o`；前端 `npm run typecheck && npm run lint && npm run build`。两者都过才算完成。 |
| **禁止提交** | 密钥、真实数据库配置、`node_modules`、`target`、`dist`、日志、数据库导出、`%LOCALAPPDATA%\TangentTimetable` 下的真实用户数据。 |
| **不重写项目** | 用户明确要求：增量模块化改造，保留原课表/待办/循环规则功能不变。 |

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 项目根目录 | `/workspace/Timetable/Timetable-fix-complete-optimization-plan`（Git 根同此） |
| 项目代号 | Tangent-Timetable → 升级为 **AI Campus Agent（AI 校园个人助手）V1.0** |
| 目标用户 | 大学生；AI 定位为「AI 大学学长」 |
| 技术栈 | Spring Boot 3.2.5 + Java 17 + MyBatis-Plus 3.5.6 + Flyway（h2/mysql 双 vendor）；React 18 + TS + Vite + AntD 5 + dayjs |
| 后端 | `src/backend`（Maven wrapper 在此目录内） |
| 前端 | `src/frontend` |
| 桌面外壳/打包 | `src/desktop`（与 Web 共用前后端） |
| 主分支 | `main`；基线提交 `61981d9`（= 部署版 timetable.zozovip.work，构建 hash 一致） |

**常用命令**

```bash
# 后端（在 src/backend 下）
./mvnw -B test -o          # 全量测试（离线）
./mvnw -B -o -q compile    # 只编译
./mvnw -B -o test -Dtest=ClassName   # 单个测试类

# 前端（在 src/frontend 下）
npm run typecheck
npm run lint
npm run build
```

---

## 2. 当前状态快照

| 项 | 状态 |
|---|---|
| HEAD | `99d4f4c` Step 7: 长期记忆治理 |
| 开发进度 | **Step 0–7 全部完成**（方案开发序列走完） |
| 后端测试 | **130/130 通过**（0 失败 0 错误） |
| 前端 | typecheck 通过；lint **0 错误 / 7 警告**（7 个警告全在存量文件，属基线，不得新增）；build 通过 |
| 工作区 | 干净（无未提交改动） |
| 当前阶段 | 进入 **V1.0 收口**：端到端验收 + 文档补齐 |

**Step 完成表**

| Step | 内容 | 提交 | 报告 |
|---|---|---|---|
| Step 0 | 接收源码 zip、与部署版核对（构建 hash 一致） | `61981d9` | `docs/reviews/AI_CAMPUS_AGENT_STEP0.md` |
| Step 1 | 4 张核心表 + Flyway V4 双 vendor 迁移 + 迁移测试 | `d9dec02` | `..._STEP1.md` |
| Step 2 | LLM Provider 抽象层 + 学长人格模板 + 记忆提炼提案链路 | `cc01106` | `..._STEP2.md` |
| Step 3 | 五段式上下文注入（档案/任务/记忆/课表/问题）+ 上下文摘要端点 | `e8c7eb9` | `..._STEP3.md` |
| Step 4 | 材料解析（PDF/图片/文本）→ 任务草稿 → 批量落库 | `ae9f0a5` | `..._STEP4.md` |
| Step 5 | Task 全量 CRUD + TASK 作用域提案 + AI Dashboard 首页 | `2842472` | `..._STEP5.md` |
| Step 6 | AI 每日计划（模板 + 生成 + 服务端强校验 + 缓存 + 首页时间线） | `6ffe864` | `..._STEP6.md` |
| Step 7 | 长期记忆治理（去重合并 + importance 治理 + 设置页 UI + top-N + 提炼开关） | `99d4f4c` | `..._STEP7.md` |

（报告全在 `docs/reviews/AI_CAMPUS_AGENT_STEP*.md`）

---

## 3. 架构决策（续写前必读，踩过坑的地方）

### 3.1 AI 交互边界

- **human-in-the-loop**：AI 只产出 `ai_action` 的 **PENDING 提案**，用户逐条确认后才 `execute`。提案阶段零落库。
- **五段式作用域**：`COURSE`（课表+考试）/ `TODO`（待办+循环）/ `TASK` / `PROFILE`（档案）/ `MEMORY`（记忆）。`scopeOf()` 按 `actionType.contains("TASK")` 等分派。
- **各作用域独立指纹**：改一个域的数据只让该域的 PENDING 提案变 STALE，不会连带失效其他域。
- **指纹必须在调模型之前算**：否则模型思考期间的数据变化会进入基线，过期提案会通过复查。
- **`_before` 快照**：提案里带执行前的数据快照供前端展示 diff；**执行时必须剥掉**（`UPDATE_PROFILE` 曾因未剥 `_before` 导致 parse 400，Step 2 修复）。

### 3.2 长期记忆（Step 7 重点）

- **同一事实只允许一条 ACTIVE**：两层去重——Prompt 层走 `UPDATE + target_id`；服务端 `create` 按「同 type + 归一化内容」查重兜底。
- 归一化只保留字母/数字/汉字并转小写，忽略标点空格大小写；**不做子串包含判断**（会把"准备考研"和"准备考研和实习"误合并）。
- 重复写入 **importance 只升不降**。
- 排序 `importance desc, updatedAt desc, id asc`；上下文注入上限 20 条；ACTIVE 上限 50 条（到顶 409）。
- 归档（SUPERSEDED）≠ 删除：归档不进上下文但留痕。
- **回滚开关**：`app.ai.memory-refine-enabled=false` 只停提炼，对话与已有记忆注入照常。

### 3.3 每日计划（Step 6）

- 计划是「**校验过的结构化时间线**」而非自由文本：课程块必须与课表逐条一致、任务块只引用未完成任务、至少一个 BREAK、时间不重叠。
- 不合规直接 **502，不做逐条降级**（半截计划比没有计划更糟）。
- 节次→时刻由服务端换算后写进输入，校验用同一函数比对（输入所见＝校验所据）。
- 生成即缓存，一天一条（uk(api_key, plan_date)）；`GET` 只读缓存，**永不烧 token**。

### 3.4 数据库与迁移

- Flyway 双 vendor：`src/backend/src/main/resources/db/migration/{h2,mysql}`，改结构必须**两处都改**。
- V4 新增 4 表：`student_profile`、`task`、`student_memory`、`daily_plan`。
- 既有表不会被 `CREATE TABLE IF NOT EXISTS` 升级，结构变更必须写迁移。
- **Course / Exam 表没有 `api_key` 列**，通过 `schedule_id` 间接归属；校验走 schedule 归属而非直接比对 apiKey。

### 3.5 测试约定

- **服务级集成**：`TestApplication` + `@Import` + 固定 Clock（`2026-09-27T02:06:00Z`，Asia/Shanghai）+ H2 mem `MODE=MySQL` + `@MockBean LlmClient`。真实事务、真实 Mapper、真实迁移，只 mock 外部 LLM。
- **HTTP 层**：`@SpringBootTest(classes = TimetableApplication.class)` + `@ActiveProfiles("standalone")` + `@AutoConfigureMockMvc` + device 注册（`POST /api/auth/device`）取 key。
- 测试是全项目的安全网：**改动后任何既有测试失败，先判断是「预期变化」还是「真实回归」**，属预期变化的要在报告「偏离记录」里写明。

### 3.6 已踩过的坑（别再踩）

| 坑 | 说明 |
|---|---|
| 裸 `orderByAsc` 把 NULL 排最前 | 任务排序必须用 `CASE WHEN deadline IS NULL THEN 1 ELSE 0 END` 做 nulls-last |
| `Long x = cond ? node.asLong() : null` | 三元混用 `long` 与 `null` 触发自动拆箱 NPE，必须显式 if/else |
| `Timestamp.valueOf("2026-09-28 23:59")` 缺秒 | 用 `LocalDateTime.parse(s.replace(" ", "T"))` |
| `isValidProposal` 的 switch 漏分支 | 漏了会静默丢弃整类提案；每加一种 action 必须同步 `splitToSingleActions` / `recordField` / 校验分支三处 |
| `LlmClientRegistry.active()` 先抛 503 | 之后的 `isConfigured()` 分支是永远走不到的死代码 |
| 前端 `client.ts` 方法白名单 | 新增 HTTP 方法（如 PATCH）要在 Options 白名单里补 |
| 前端 `&&` 短路返回 `unknown` | `m.target_id != null` 才能拿到 boolean，否则 `isUpdate && <Tag>` 报 TS2322 |

---

## 4. 关键文件地图

**后端**

| 文件 | 职责 |
|---|---|
| `service/impl/AiServiceImpl.java` | AI 主流程：上下文装配、提案构造/校验/执行、记忆提炼。最核心也最易改坏 |
| `service/impl/AiPromptBuilder.java` | 所有 Prompt 装配（聊天五段式、提炼窗口、每日计划输入、节次换算） |
| `service/impl/MemoryServiceImpl.java` | 记忆去重/治理/容量 |
| `service/impl/DailyPlanServiceImpl.java` | 每日计划生成 + 服务端强校验 + 缓存 |
| `service/impl/DashboardServiceImpl.java` | 首页规则聚合（今日课程/任务/48h/考试倒计时/今日重点） |
| `service/LlmClientRegistry.java` | 多模型注册与回退（含 legacy-direct 回滚开关） |
| `service/impl/PromptTemplateRegistry.java` | `resources/prompts/*.md` + front matter `version:N`；缺失返回 null 降级 |
| `controller/` | `AiController`（聊天/提案执行）、`TaskController`、`DailyPlanController`、`DashboardController`、`MemoryController` |

**Prompt 模板**（`src/backend/src/main/resources/prompts/`）

| 文件 | version | 用途 |
|---|---|---|
| `persona.md` | 1 | 「AI 大学学长」人格 + 提案协议 |
| `memory-extract.md` | **2** | 记忆提炼（v2 起含 `action:ADD\|UPDATE` + `target_id`） |
| `task-extract.md` | 1 | 材料解析 → 任务草稿 |
| `daily-plan.md` | 1 | 每日计划生成 |

**前端**

| 文件 | 职责 |
|---|---|
| `pages/DashboardPage.tsx` | 首页（AI Dashboard）：档案问候、今日课程/任务、48h、考试、规则重点、每日计划 |
| `pages/AiChatPage.tsx` | AI 聊天（流式） |
| `pages/SettingsPage.tsx` | 设置：小组件地址、AI Key、**长期记忆管理**、字体、作息表 |
| `components/AiActionCard.tsx` | 提案卡渲染（每类 action 一套展示，新增 action 要同步） |
| `components/MemoryManager.tsx` | 记忆管理（添加/行内编辑/归档/删除） |
| `components/PlanTimeline.tsx` | 每日计划时间线 |
| `components/TaskCard.tsx`、`TaskDraftModal.tsx` | 任务卡片与材料解析草稿确认 |
| `types/index.ts`、`api/index.ts` | 类型与 API 客户端（新增端点要同步两处） |

---

## 5. 会话日志（倒序，最新在最上）

### 2026-10-14 · WorkBuddy · 建立交接文件 + 完成 Step 7

- **背景**：用户要求建一个本地文件，把已做的事与对话都放进去，每次对话更新，以便 **WorkBuddy 与 Codex 一起做这个项目**。
- **本轮产出**：
  1. 新建本文件 `docs/HANDOVER.md` 作为多 Agent 协作的唯一状态入口。
  2. 在 `AGENTS.md` 中加了「交接文件」规则，让 Codex 也会被要求读写本文件。
- **Step 7 结论**：长期记忆治理完成（去重合并 + importance 治理 + 设置页 UI + top-N 调优 + 提炼开关），后端 130/130、前端三连通过，提交 `99d4f4c`。详见 `docs/reviews/AI_CAMPUS_AGENT_STEP7.md`。
- **遗留**：语义级去重（"准备考研" vs "打算考研"）仍依赖模型走 UPDATE；改记忆会让未执行的记忆提案变 STALE（符合设计但用户可能困惑）；每日计划缓存当天不变动。

### 2026-10-14 · WorkBuddy · Step 7 长期记忆治理

- 诊断：记忆模块只有 `create`，去重全靠 Prompt 软约束 → 同一事实聊三轮会攒三条、token 越聊越贵。
- 实施：`memory-extract.md` 升 v2（`action`/`target_id`）；提炼窗口输出记忆 id（`- #7 [GOAL·5] ...`）；`AiServiceImpl` 按 action 分派校验与执行；`MemoryService` 增 `update/supersede/delete/getById/normalize`；排序改 `importance desc, updatedAt desc, id asc`；ACTIVE 上限 50；新增 `/api/memories` 四个端点；设置页 `MemoryManager` 卡片；`AiActionCard` 区分「新增」与「修正 #id」。
- 测试先行发现 2 个问题：① 提炼窗口原本不带 id，模型拿不到 `target_id`（已补）② 既有断言依赖旧格式与 `version:1`（已同步更新）。

### 2026-10-14 · WorkBuddy · Step 6 AI 每日计划

- `daily-plan.md` + `DailyPlanService` + `GET/POST /api/plans/daily` + 首页时间线；服务端强校验（课程块与课表一致/任务块只排未完成/≥1 BREAK/时间不重叠），不合规 502。
- 测试先行发现 3 个真实缺陷：三元表达式自动拆箱 NPE（8 个测试崩溃）、`isConfigured` 死代码、用 14 天窗口取任务导致合法任务块被误判（改用全量未完成任务）。103 → 115。

### 2026-10-14 · WorkBuddy · Step 5 Task CRUD + Dashboard

- Task 全量 CRUD + `CREATE_TASK`/`UPDATE_TASK` 提案链（scope/fingerprint/_before/applyAction/split/校验全套）+ 规则聚合首页。
- 5 个提案测试失败的根因：`isValidProposal` 的 switch 漏 `CREATE_TASK/UPDATE_TASK` 分支 → 任务提案被静默判非法丢弃（已补分支 + 字段校验）。77 → 103。

### 2026-10-14 · WorkBuddy · Step 0–4

- Step 0 核对源码与部署版一致；Step 1 建 4 表 + V4 双 vendor 迁移；Step 2 LLM 抽象层 + 人格模板 + 记忆提炼提案链路（修 `_before` 未剥离的 bug）；Step 3 五段式上下文注入 + 上下文摘要端点 + 前端 chips；Step 4 材料解析 → 任务草稿 → 批量落库（human-in-the-loop）。
- 更早：输出《项目分析报告》与《改造方案》，方案经用户批准后才动代码（方案文件：`/root/.codebuddy/plans/radiant-pulse-curie-SMd61jxd.md`）。

---

## 6. 下一步待办（按优先级）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **V1.0 端到端验收** | 按方案 §2.11「可演示旅程」走查：建档 → 聊天 → 提案确认 → 材料解析成任务 → 每日计划 → 首页聚合 → 记忆自动累积且只留一条 |
| 2 | **用户手册补 AI 章节** | `src/frontend/src/pages/UserManualPage.tsx` 目前未覆盖 AI 聊天/提案确认/记忆/每日计划 |
| 3 | **README 更新** | 说明 AI Campus Agent 能力与配置项（含 `app.ai.memory-refine-enabled`） |
| 4 | 记忆提案的 STALE 提示 | 卡片上说明「记忆已变更，请重新询问」，避免用户困惑 |
| 5 | 每日计划缓存失效 | 数据变化（新增任务/改课程）时提示重新生成（当前当天不变动） |

**暂缓 / 明确不做（方案已排除）**：浏览器插件、桌面助手、爬学校系统、推荐算法、本地模型训练、知识库。

---

## 7. 给 Codex 的接手提示

- 开工前先跑一次 `cd src/backend && ./mvnw -B test -o` 确认基线是 130/130，再动手——避免把别人引入的问题算到自己头上。
- 本项目**不重写**：所有改动走模块化增量，保留课表/待办/循环规则的既有行为。
- 新增 AI action 类型时，必须同步 4 处：`splitToSingleActions` 的 recordField、`isValidProposal` 的 switch、`applyAction` 的执行分支、前端 `AiActionCard` 的渲染。少一处就会出现「提案被静默丢弃」这类难查的 bug。
- 涉及数据库结构：h2 与 mysql 两套迁移都要改，并补迁移测试。
- 每次收工请在本文件第 5 节追加一条会话日志，并更新第 2 节的状态快照。
