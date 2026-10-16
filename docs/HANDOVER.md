# HANDOVER — 项目交接主文件（多 Agent 协作用）

> **本文件是项目的「当前状态唯一真相」。** WorkBuddy 与 Codex 交替开发同一份代码，任何 Agent 在开工前先读本文件，收工前必须更新本文件（至少更新「会话日志」与「当前状态快照」）。
>
> **已同步到项目网盘**（tdrive 根目录，2026-10-16）：`Timetable-HANDOVER-交接主文件.md`（本文件）、`Timetable-交接总览-20261015.md`（自包含精简版，可整份粘给新 Agent）、`下一步方向调研报告.md`（**下一步方向决策依据，接手必读**）、`REA-逆向验证报告.md`、`ai-campus-agent-源码快照-ec2ec62.zip`（**免 git 的源码通道**）、`ai-campus-agent-git-bundle.bundle`（免凭证的 git 通道），操作细节见 `/workspace/Git同步操作指引.md`。
>
> 最近更新：2026-10-16 ｜ 更新者：WorkBuddy ｜ 对应提交：`ec2ec62` + 待提交的分支改名与 GitHub 同步通道
>
> ⚠️ **下一步做什么，请直接读 `/workspace/下一步方向调研报告.md` 第 8 节。**本文件第 6 节已按其结论重排待办。
> 🆕 **跨环境同步现已有正式通道**：主分支 `main`（原 `master` 已改名），远端为 GitHub **私有仓库**。有 GitHub 凭证的机器直接 `git clone`；无凭证的机器用网盘 zip 快照（已验证解压即 134/134）。两种方式都有效，网盘通道继续保留。

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
| HEAD | `ec2ec62` docs: HANDOVER 记录日期翻篇测试修复、部署版核对结论与 git bundle 同步通道（分支已由 `master` 改名为 **`main`**） |
| 开发进度 | **Step 0–7 全部完成**；**V1.0 收口三轮全部完成**（档案端点 + 端到端旅程 + 文档 + 展示态 STALE + 计划缓存失效） |
| 后端测试 | **134/134 通过**（0 失败 0 错误，2026-10-16 全量复跑 BUILD SUCCESS） |
| 前端 | typecheck 通过；lint **0 错误 / 7 警告**（7 个警告全在存量文件，属基线，不得新增）；build 通过 |
| 工作区 | 干净（无未提交改动） |
| 当前阶段 | V1.0 功能收口完成；下一步方向已调研定稿（见 `/workspace/下一步方向调研报告.md`），待用户确认后进入第一阶段「成本治理」。剩余仅**人工走查**（浏览器 / 桌面端打包），需用户在本机执行 |
| **⚠️ 多环境同步** | **2026-10-16 起已配置 GitHub remote（私有仓库）**，主分支 `main`，`.github/workflows/ci.yml` 在 `main` 上触发。**原分支名 `master` 已改名为 `main`**（改名前 CI 的 `branches: [main]` 是空转，从不触发）。另一环境（Codex）的分叉提交 `9bb3200` **不在本仓库对象库中**，需先 fetch 再合并或按 `/workspace/Git同步操作指引.md` 用网盘 zip 整体覆盖 |
| **线上部署状态** | `timetable.zozovip.work` 首页 200，但**前端是 baseline `61981d9`，未部署 V1.0**（资产哈希与字符串扫描实证，详见第 5 节 2026-10-16 条）。后端版本外部不可判定（API Key 拦截在路由前） |

**代码规模（2026-10-15 实测）**

| 层 | 文件数 | 行数 |
|---|---|---|
| 后端主代码 | 139 | 12,173（`service` 层 8,043 行，占 66%） |
| 后端测试 | 19 | 4,606 |
| 前端 | 48 | 9,561（8 页面 / 19 组件 / 4 API / 2 store） |

**已识别的基础设施缺口（此前未记录）**：① 无 LLM 调用计量/预算 ② `LlmClientRegistry` 仅注册 DeepSeek 一家（单点 + 无法分级路由）③ 无用户行为埋点 ④ 无模型输出评估集。已按《下一步方向调研报告》排入第 6.1 节。

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
| 收口 1 | 档案端点 `GET/PUT /api/profile` + 设置页表单 + 端到端旅程测试 | `dd763c9` | — |
| 收口 2 | 用户手册「AI 学长」章节 + README 能力与配置项 | `a39a5c7` | — |
| 收口 3 | 提案展示态 STALE + 每日计划 stale 提示与覆盖重算 | `c9cd72b` | — |

（报告全在 `docs/reviews/AI_CAMPUS_AGENT_STEP*.md`）

---

## 3. 架构决策（续写前必读，踩过坑的地方）

### 3.1 AI 交互边界

- **human-in-the-loop**：AI 只产出 `ai_action` 的 **PENDING 提案**，用户逐条确认后才 `execute`。提案阶段零落库。
- **五段式作用域**：`COURSE`（课表+考试）/ `TODO`（待办+循环）/ `TASK` / `PROFILE`（档案）/ `MEMORY`（记忆）。`scopeOf()` 按 `actionType.contains("TASK")` 等分派。
- **各作用域独立指纹**：改一个域的数据只让该域的 PENDING 提案变 STALE，不会连带失效其他域。
- **指纹必须在调模型之前算**：否则模型思考期间的数据变化会进入基线，过期提案会通过复查。
- **`_before` 快照**：提案里带执行前的数据快照供前端展示 diff；**执行时必须剥掉**（`UPDATE_PROFILE` 曾因未剥 `_before` 导致 parse 400，Step 2 修复）。
- **展示态 STALE（只读判定，不落库）**：读消息时对 PENDING 提案做一次指纹复核，数据已变就在响应里返回 `STALE`，但**数据库里仍是 PENDING**。真正的失效写入仍发生在执行那一刻——展示只是提前告诉用户「这张卡别点了」，避免用户点了才收到 409。`executeAction` 的逻辑一行没动。

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
- **stale 判定不加表字段**：用「输入表（course/exam/task/student_profile）`MAX(updated_at)` > `daily_plan.created_at`」判断。判定偏保守（改了下周的课也会提示），宁可多提示一次。
- **`get()` 与 `generate()` 分工明确**：`get()` 只提示不重算（首页只读路径）；`generate()` 命中缓存但**已 stale 时删旧行覆盖重算**——用户主动点「重新生成」就是同意消耗这次 token。命中且未 stale 仍然直接返回缓存，一天不会重复烧额度。

### 3.4 数据库与迁移

- Flyway 双 vendor：`src/backend/src/main/resources/db/migration/{h2,mysql}`，改结构必须**两处都改**。
- V4 新增 4 表：`student_profile`、`task`、`student_memory`、`daily_plan`。
- 既有表不会被 `CREATE TABLE IF NOT EXISTS` 升级，结构变更必须写迁移。
- **Course / Exam 表没有 `api_key` 列**，通过 `schedule_id` 间接归属；校验走 schedule 归属而非直接比对 apiKey。

### 3.5 测试约定

- **服务级集成**：`TestApplication` + `@Import` + 固定 Clock（`2026-09-27T02:06:00Z`，Asia/Shanghai）+ H2 mem `MODE=MySQL` + `@MockBean LlmClient`。真实事务、真实 Mapper、真实迁移，只 mock 外部 LLM。
- **例外**：`AiCampusAgentDailyPlanTest` 用 `Clock.systemDefaultZone()`。**凡是要比较「应用层时间戳 vs 数据库 `ON UPDATE` 时间戳」的测试，都不能用固定 Clock**，必须让两者同源（见 3.6）。
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
| MockMvc `getContentAsString()` 无参 | 按 ISO-8859-1 解码 UTF-8 响应 → 中文乱码。必须写 `getContentAsString(StandardCharsets.UTF_8)`（jsonPath 内部用 UTF-8，所以断言可能过、自己解析却乱码） |
| 提案执行前动了同域数据 | 会让提案变 STALE（409）。这是设计：用户改过数据后旧提案不该再执行。写旅程测试时注意操作顺序 |
| 档案补丁「null=保持原值」 | AI 提案语义如此；表单要「清空=删除」，走 `profileService.replace` 而不是 `applyPatch` |
| 固定 Clock 与数据库 `NOW()` 不同源 | `AiCampusAgentDailyPlanTest` 原来固定 2026-09-27，而 H2 `NOW()` 是真实当前时间（相差数周）→ stale 判定恒为 true，连「二次生成命中缓存」都失败。凡是比较应用层时间与 DB `ON UPDATE` 时间的逻辑，测试夹具必须用 `Clock.systemDefaultZone()` |
| `List.of(...)` 不接受 null | `MAX(updated_at)` 无数据时返回 null，塞进 `List.of` 直接 NPE。改用 `String[]` 循环累加 |
| **测试里写死「今天」的日期字面量** | `TaskEndpointIntegrationTest` 曾写死 `2026-10-15` 作为任务截止时间，而 `AiServiceImpl.parseExtractedDeadline` 的设计是「**过去的截止时间一律清洗成 null**」→ 日期一翻篇（2026-10-16）断言必挂。**两类时钟要分清**：① 带固定 `Clock` 的 AI 测试（`AiCampusAgent*Test`，today 恒为 2026-09-27）写死日期是安全的；② `@SpringBootTest` 全量启动、无 Clock 覆盖的测试（`TaskEndpointIntegrationTest` 等）用的是 `TimeConfig` 真实系统时钟，**凡是「未来/过去」语义的日期必须用 `LocalDate.now().plusDays(n)` 相对构造**。手动创建路径（`POST /api/tasks`）不过期清洗，写死过去日期反而不受影响——这个不对称是设计，别"顺手统一" |

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
| `controller/` | `AiController`（聊天/提案执行）、`TaskController`、`DailyPlanController`、`DashboardController`、`MemoryController`、`StudentProfileController` |
| `service/StudentProfileService` | 档案读写：`applyPatch`（AI 提案，null=保持）与 `replace`（表单，null=清空）**语义相反，别用错** |

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

### 2026-10-16 · WorkBuddy · 主分支 master → main + GitHub 私有仓库同步通道

**触发**：用户授权「可以推到 GitHub 上」。这是本项目**第一次拥有真正的远端**，跨环境同步问题从「手动传文件」升级为 `git push`/`git clone`。

**① 推送前的安全体检（不可逆操作，必须先做）**：

| 检查项 | 结果 |
|---|---|
| 提交历史中的真实密钥 | ✅ 无。`sk-` 全量命中均为 `task-extract`/`task-owner`/`placeholder="sk-..."`/`sk-xxxx` |
| 配置文件硬编码凭证 | ✅ 无。`application.yml` 全部走环境变量，默认值是 `your-deepseek-api-key` 这类占位符 |
| 曾提交后删除的敏感文件 | ✅ 无。`docs/CREDENTIALS.md`、`application-local.yml`、`*.local.yml` 由 `.gitignore` 拦截，未进入历史 |
| 归档对话中的个人信息 | ✅ 无手机号/邮箱/学号/真实姓名；部署文档服务器地址已用 `<SERVER_HOST>` 占位 |
| 许可证 | MIT（Copyright (c) 2026 Tangent0712），允许再分发；**私有仓库下无额外义务**，转公开时须保留原版权声明 |
| 仓库体积 | 348 文件 / `.git` 4.2 MB，无大文件（`releases/`、`target/`、`node_modules/` 均已忽略） |

**② 修掉两个隐藏问题**：

- **分支名 `master` → `main`**：`.github/workflows/ci.yml` 写的是 `on: push: branches: [main]`，而实际分支叫 `master` → **CI 从建立以来一直是空转，从未真正跑过**。改名后 CI 才会触发。
- 改名前全仓库文档已无 `master` 残留（HANDOVER 第 1 节本就写 `main`），改完两者一致。

**③ 与既有渠道的关系**：网盘的 zip 快照与 git bundle **继续保留**——私有仓库需要授权才能 clone，而对方环境（Codex）无凭证时网盘仍是唯一通道。两条路指向同一份代码。

**④ 用户决策记录**（2026-10-16）：仓库可见性 = **私有**；分支 = **改为 main**；`docs/archive/` 内部文档 = **原样推送**；凭证 = 用户自行 `gh auth login`。

### 2026-10-16 · WorkBuddy · 复验基线发现 1 个日期翻篇失败 + 部署版核对 + git bundle 同步通道

**触发**：另一环境（Codex）报告「本地/备份/远端优化分支均为 `9bb3200`、远端查 `7612bbe` 未找到、`docs/HANDOVER.md` 未找到 → 134/134 未复验、本机 REA 缺运行文件」。逐项处理如下。

**① 134/134 实际不成立（已修）**：本沙箱跑全量测试，`TaskEndpointIntegrationTest.extractThenConfirmCreatesTasksWithAiParseSource` **1 个失败**（133/134）。根因是**又一处日期硬编码**：服务端 `AiServiceImpl.parseExtractedDeadline` 的设计就是「过去的截止时间一律清洗为 null」，而测试写死 `2026-10-15`，今天 `2026-10-16` 一起床断言必然挂。**产品行为正确，测试缺陷**。改为 `LocalDate.now().plusDays(7)`（输入文本同步改成相对日期），已单独跑该类 5/5、全量 **134/134 BUILD SUCCESS**。提交 `7b7ad63`。教训已补进 3.6。

**② 部署版核对（用资产哈希，比 REA 更直接）**：REA 在本沙箱可用（`npx rea-agents@6.5.0`），但其 web 命令需 CDP 浏览器；改用**内容哈希比对**，结论更硬：

| 资源 | 线上 `timetable.zozovip.work` | 本地 `dist` | 判定 |
|---|---|---|---|
| `react-*.js` | md5 `cc3c292f…` | md5 `cc3c292f…` | **完全一致**（同 React 版本） |
| `index-*.js` | `index-Cm4yYtry.js` 149,707 B | `index-CEirBQDd.js` 182,121 B | 本地大 32 KB |
| `antd-*.js` | `antd-D3xlKeEY.js` 1,226,868 B | `antd-Dq_GqYmF.js` 1,237,349 B | 本地大 10 KB |
| `index-*.css` | `index-BP6lxbFV.css` 22,107 B | `index-Cl_cbg2Z.css` 22,157 B | 本地大 50 B |

字符串扫描：线上 `index.js` 中「学长」「每日计划」「长期记忆」**均 0 次**，本地分别 3/2/2 次 → **线上前端 = baseline `61981d9`，尚未部署 V1.0**。首页 GET 200，标题仍为「大切课程表 · 课程表与待办」。**线上后端版本无法从外部判定**——API Key 拦截器在路由之前，`/api/**` 无论是否存在一律 401（用不存在的路径做过对照组，响应体同为 `{"code":401,"message":"缺少 X-API-Key 请求头"}`）。

**③ git 同步断裂的真相与修复**：本沙箱仓库**从未配置任何 remote**（`git remote -v` 为空），18 个提交只存在于本沙箱；`9bb3200` 不在本仓库对象库中，说明对方环境已是**另一条分叉的提交线**，不是简单的「没 pull」。已生成 `git bundle`（完整 18 提交历史，812 KB）传上网盘，对方可直接 `git fetch` 拉取后再合并，无需 remote 凭据。见 `/workspace/Git同步操作指引.md`。

### 2026-10-15 · WorkBuddy · 下一步方向调研（无代码改动）

- 用户要求「搜集数据和信息，开下一步方向」。本轮**未改任何代码**，只做调研与规划。
- **产出**：`/workspace/下一步方向调研报告.md`（已同步网盘）。三个结论：
  1. **需求真实**：71.3% 大学生有时间管理问题、75% 自认拖延、38% 从无每日计划、72% 截止前 3 天才动笔。最关键的一条是「**42% 自以为管得不错，但只有 20% 规律用日历**」——这个认知—行为鸿沟就是整个品类的存在理由，只有能"替用户排"的 AI 填得平。
  2. **市场空白明确**：国内 3000+ 高校覆盖的课程表 App（超级课程表/WakeUp/喜鹊儿/星课程表）**全部停在「教务导入 + 课表展示」，无一带对话式 AI**；海外真 AI 只有 DormWay（接学校系统，国内走不通）和 Shovel 两家。我们的位置是「**数据不出本机、每一步都问你一句**」。
  3. **推荐路线**：**先降本（P0 成本治理）→ 再升智（P1 记忆升级）→ 再扩入口（P2 截图导入）→ 最后才 Agent 化（P3）**。埋点必须第一周就补，否则全是盲飞。
- **顺手量化了项目现状**（此前没有准确数字）：后端主代码 139 文件 / 12,173 行（`service` 层占 66%），测试 19 文件 / 4,606 行，前端 48 文件 / 9,561 行；**14 张表**，8 个页面。
- **识别出 4 个此前没记录的基础设施缺口**：① 无 LLM 调用计量/预算 ② `LlmClientRegistry` 仅注册 DeepSeek 一家（单点故障 + 无分级路由能力）③ 无用户行为埋点 ④ 无模型输出评估集。第 6 节待办已按此重排。
- **合规侧新证据**：2026 年中央网信办/工信部/公安部个人信息保护专项行动**把教育领域单列专项治理**，重点查「过度收集位置、学校、学籍」。「不爬教务」由此从限制变成护城河——竞品要做 AI 就得接教务，接了就进监管视野。

### 2026-10-15 · WorkBuddy · 外部工具验证：REA（逆向一切）

- 用户拉取 `github.com/bbylw/rea-cn.git`，要求做一次逆向验证它能不能用。**该仓库只是 REA 中文官网**（Astro 站点），工具本体是 npm 包 `rea-agents@6.5.0`。
- 验证结论：**能用**，详见 `/workspace/REA-逆向验证报告.md`（独立于本仓库）。要点：
  - 官网：npm install 221 包 / 0 漏洞 / build 3 页 ✅
  - 拿本项目 `src/frontend/dist` 做真逆向：exit=0，**从压缩 bundle 里 100% 还原出 6 条前端路由**（`/` `/ai` `/manual` `/settings` `/timetable` `/todos`），语义图 45 万+ 节点，limitations 标注诚实
  - MCP：`doctor healthy`，207 工具 / 6 prompt，握手全通；大目标需走「analyze → get_evidence_bundle → inspect_analysis_view」证据包工作流（实测三步通，末步 12KB 可读摘要）
- **4 个坑（复用前必读）**：① 默认输出 246MB / 5800 万 token，必须 `--token-limit` ② CLI 用 `path`、MCP 用 `input_path`，且 MCP 不支持 `maxSemanticNodes` ③ `--format md` 递归爆栈（RangeError）④ Node 必须 ≥22.19（沙箱已装 v24.22.0）
- 本项目代码**未做任何改动**，本次仅为外部工具验证。

### 2026-10-15 · WorkBuddy · V1.0 收口第三轮（展示态 STALE + 计划缓存失效）

- 处理交接文件第 6 节剩下的两个体验缺口，都来自「自动化测试过了、但用户会困惑」：
  1. **提案点了才知道失效**：`AiServiceImpl.toResponse` 增加只读指纹复核（`displayStatus`），PENDING 提案数据已变就在响应里返回 `STALE`，**库里仍是 PENDING**。真正失效写入仍在执行那一刻，执行逻辑一行没动。前端 `AiActionCard` 原本就渲染 STALE，直接复用。
  2. **每日计划当天一成不变**：`DailyPlanDto` 增 `stale`；`get()` 用「输入表 MAX(updated_at) > 计划 created_at」判定（**不加表字段**），只提示不重算；`generate()` 命中缓存**但已 stale 时删旧行覆盖重算**——因为用户主动点「重新生成」就是同意花这次 token，而 `get()` 是首页只读路径，永不烧 token。首页：`可能已过时` 橙标签 + 告警条 + 「重新生成」按钮。
- **测试踩坑（值得记住）**：`AiCampusAgentDailyPlanTest` 的固定 Clock（2026-09-27）与 H2 的 `NOW()`（真实当前时间）相差三周，导致 stale 恒为 true、「二次生成命中缓存」也失败。stale 判定本质依赖真实时间流逝，测试夹具改用 `Clock.systemDefaultZone()` 与数据库同源于默认时区。
- 另修 `List.of` 不接受 null 的 NPE（`MAX()` 无数据返回 null）。
- 新增 2 个测试固化行为：`rereadingHistoryShowsStaleProposalWithoutPersistingIt`（展示态不落库）、`cachedPlanIsFlaggedStaleAfterInputDataChanges`（提示 + 覆盖重算，一天仍只有一条）。132 → **134/134**，前端三连通过。提交 `c9cd72b`。

### 2026-10-14 · WorkBuddy · V1.0 收口第一轮（档案端点 + 端到端验收 + 文档）

- **端到端验收驱动开发**：按方案 §2.11 的 9 条旅程写 `AiCampusAgentJourneyIntegrationTest`（HTTP 层，真实应用/鉴权/迁移，只 mock LLM），一条链路串起建档 → 课表 → AI 提案 → 材料解析 → 首页聚合 → 记忆累积 → 每日计划 → ai_action 审计。
- **验收发现的真实缺口**：**没有学生档案的写端点**。首页有「去填写档案」引导，指向设置页却没有落点——档案此前只能靠 AI 提案写入，用户无法主动填。已补 `GET/PUT /api/profile` + 设置页 `ProfileForm` 卡片。
  - 附带设计决策：AI 提案的补丁语义是「null = 没提到，保持原值」，而表单需要「清空 = 删除」。两者语义相反，因此新增 `StudentProfileService.replace`（表单全量覆盖），**不动** `applyPatch`，AI 路径零影响。
- **体验缺口已补**：用户手册新增「AI 学长」章节（首页/档案/记忆/任务/每日计划），README 增 AI Campus Agent 能力表与配置项（含 `app.ai.memory-refine-enabled` 回滚开关）。
- **测试踩坑 2 个**（都已修复，见第 3.6 节）：
  1. MockMvc `getContentAsString()` 无参版按 ISO-8859-1 解码 UTF-8 响应 → 中文变乱码（jsonPath 内部用 UTF-8，所以先前没暴露）。必须写 `getContentAsString(StandardCharsets.UTF_8)`。
  2. 旅程里先落库材料任务再执行 AI 提案 → 提案 409 STALE。这是**设计行为**（TASK 域数据变了），不是 bug；旅程顺序改为「先确认 AI 提案，再做材料解析」。
- 结果：后端 132/132，前端三连通过。提交 `dd763c9`（档案端点 + 旅程测试）、`a39a5c7`（用户手册 + README）。

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

## 6. 下一步待办（按优先级，依据《下一步方向调研报告》重排）

> **V1.0 开发已收口。**以下待办的排序来自 `/workspace/下一步方向调研报告.md` 第 8 节，核心判断是：**记忆升级会推高 token 消耗，所以必须先降本**。

### 6.1 第一阶段：成本与可用性治理（调研报告 §5 方向 C，约 1–2 周，纯基建）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **补用户行为埋点** | 提案确认率 / 计划采纳率（生成后 24h 内完成或调整占比）/ 7 日留存 / 单用户月 token 成本。**没有度量，后面全是盲飞，所以放第一** |
| 2 | **多 LLM provider 注册** | `LlmClientRegistry` 目前只有 DeepSeek 一家。补一个 OpenAI 兼容客户端（智谱 GLM / 通义 / 豆包均兼容），消除单点故障并获得议价能力 |
| 3 | **按任务分级路由** | 意图分类、简单改写走 flash 级；每日计划、复杂推理走主力级。2026 年国产模型价格：DeepSeek-V4-Lite 0.1/0.2 元每百万 token、GLM-4-Flash 免费、V4-Pro 1.0/2.0（缓存命中 0.025） |
| 4 | **Prompt Caching** | 系统提示词 + 学生画像这类稳定前缀打 cache 标记，输入成本可降 80–90% |
| 5 | **token 计量与预算** | 每次调用记 tokens/费用/模型/作用域；前端用量看板 + 月度预算上限 + 超限熔断 |
| 6 | **降级与重试** | provider 故障自动切备用；含已列入待排期的「计划生成失败重试退避」 |

### 6.2 第二阶段：记忆系统升级（调研报告 §5 方向 A，约 2–3 周）

依赖第一阶段的 cheap-model 路由——记忆升级会**显著增加**每次注入的上下文，不先降本会把项目烧穷。

| # | 事项 | 说明 |
|---|---|---|
| 7 | **建模型输出评估集** | 30–50 条固定脱敏用例（真实课表/任务/对话样本），每次改 prompt 或检索策略跑回归。没有这个，记忆升级就是盲改 |
| 8 | **记忆三层拆分** | 瞬时（当前会话）/ 工作（近 7 天高频事实）/ 长期（稳定偏好作息目标）。现为单层 `Memory` 表 |
| 9 | **混合检索 + k=3 起步** | MySQL 全文索引关键词召回 + 时间衰减排序；**top-k 从 3 开始测，不要"越多越安全"**（行业共识：注入无关记忆反而降质） |
| 10 | **写入前脱敏** | 落库前正则过滤 API key / 学号 / 身份证号。行业共识是"写入时 redact，不是事后补" |
| 11 | **记忆来源可溯** | 前端 `MemoryManager` 补「这条记忆从哪来 / 什么时候被用过 / 一键删除」 |
| 12 | 记忆语义级去重（旧待排期项） | "准备考研" vs "打算考研"目前靠模型走 UPDATE；更准需引入相似度，归入本阶段一并做 |

### 6.3 第三阶段：数据入口扩展（调研报告 §5 方向 B，约 2 周）

依赖第二阶段的记忆质量（"他总爱在晚上建任务"这类偏好要能被记住）。

| # | 事项 | 说明 |
|---|---|---|
| 13 | **截图导入课表** | `DeepSeekLlmClient` 已支持 `image_url`（vision 已在）。拍一张课表截图 → 模型解析 → **用户逐条确认** → 落库。OCR 错识别的风险由既有 human-in-the-loop 兜住 |
| 14 | **PDF 培养方案 / 成绩单解析** | 提取考试安排、学分要求 |
| 15 | **语音建任务** | `useSpeechInput` hook 已存在，接到任务创建链路 |

> ⚠️ 第三阶段的 UI 硬要求：确认界面要做到「**改一个字段比重新录入还快**」，否则用户宁愿手输。

### 6.4 第四阶段（远期，先立规矩再动代码）：Agent 多步执行

调研报告 §5 方向 D。多步提案（planner 拆解 → 逐步提案 → 批量确认）、工具注册表（Hook 点 `before_prompt_build` / `before_tool_call` / `message_received`）、执行回放审计。

**前置条件（硬性）**：先书面定义安全边界——哪些 action 允许批量确认、哪些必须逐条、循环检测熔断阈值是多少——并纳入 code review 检查项。这是唯一可能侵蚀「人类在环」底线的方向，**绝不做全自动**。

### 6.5 仍需用户本机执行

| # | 事项 | 说明 |
|---|---|---|
| — | **人工走查（浏览器 / 桌面端）** | V1.0 功能已全部收口，唯一未验证项是 UI 交互与桌面端打包；**需用户在本机执行**：`npm run dev` 走一遍首页/聊天/设置，再做桌面冒烟（沙箱无法做人工走查） |
| — | **用 REA 核对线上部署版** | `compare_application_versions` 可对比 `timetable.zozovip.work` 与本地 build。工具已验证可用（见第 5 节 / `/workspace/REA-逆向验证报告.md`），待用户决定是否接入 MCP 常驻 |

### 6.6 已完成的旧待办（留档）

| # | 事项 | 状态 |
|---|---|---|
| — | 记忆/档案提案的 STALE 提示 | ✅ 展示态 STALE（不落库）+ 卡片提示 |
| — | 每日计划缓存失效 | ✅ stale 判定（不加表字段）+ 首页提示 + 覆盖重算 |
| — | V1.0 端到端验收 | ✅ `AiCampusAgentJourneyIntegrationTest` |
| — | 用户手册 AI 章节 / README | ✅ |

**暂缓 / 明确不做（方案已排除，调研报告再次确认）**：浏览器插件、桌面助手、爬学校教务系统、推荐算法、本地模型训练、全国高校知识库、社交 / 广告 / 用户画像。

> 注：「不爬教务」在调研中被重新定性为**护城河**：2026 年网信办/工信部/公安部个人信息保护专项行动把教育领域单列治理，重点查过度收集位置/学校/学籍。竞品要做 AI 就得接教务系统，接了就进监管视野；我们走「用户主动上传 → 解析 → 人工确认」，既拿到结构化数据又不碰学校系统。

---

## 7. 给 Codex 接手提示

- 开工前先跑到 `docs/HANDOVER.md` 第 2 节看当前基线（现在是 134/134），跑一次 `cd src/backend && ./mvnw -B test -o` 确认，再动手——避免把别人引入的问题算到自己头上。
- **沙箱 Node 环境**：系统默认 `node` 是 **v22.13.1**（前端 typecheck/lint/build 均已验证通过）；另装了 nvm **v24.22.0**，需 `source ~/.nvm/nvm.sh && nvm use 24` 才能用（非交互 shell 里 `nvm` 不可直接调用）。**本项目代码两个版本都能构建**，不必主动切换；只有跑外部工具 REA 时才需要 ≥22.19。
- 本项目**不重写**：所有改动走模块化增量，保留课表/待办/循环规则的既有行为。
- 新增 AI action 类型时，必须同步 4 处：`splitToSingleActions` 的 recordField、`isValidProposal` 的 switch、`applyAction` 的执行分支、前端 `AiActionCard` 的渲染。少一处就会出现「提案被静默丢弃」这类难查的 bug。
- 涉及数据库结构：h2 与 mysql 两套迁移都要改，并补迁移测试。
- 每次收工请在本文件第 5 节追加一条会话日志，并更新第 2 节的状态快照。
- **下一步方向不要自己拍脑袋**：`/workspace/下一步方向调研报告.md` 已给出四阶段路线与理由（先降本 → 再升智 → 再扩入口 → 最后 Agent 化），第 6 节是其落地拆解。若要调整路线，先读该报告第 8.1 节的顺序论证。
- **新增 LLM provider 时**：实现 `LlmClient` 接口并在 `LlmClientRegistry` 注册，同时补 `LlmProperties` 的 providerId 说明；注意 `active()` 会先抛 503，`isConfigured()` 不是可达分支（见 3.6）。
