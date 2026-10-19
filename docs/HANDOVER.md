# HANDOVER — 项目交接主文件（多 Agent 协作用）

> **本文件是项目的「当前状态唯一真相」。** WorkBuddy 与 Codex 交替开发同一份代码，任何 Agent 在开工前先读本文件，收工前必须更新本文件（至少更新「会话日志」与「当前状态快照」）。
>
> **已同步到项目网盘**（tdrive 根目录，2026-10-16）：`Timetable-HANDOVER-交接主文件.md`（本文件）、`Timetable-交接总览-20261015.md`（自包含精简版，可整份粘给新 Agent）、`下一步方向调研报告.md`（**下一步方向决策依据，接手必读**）、`REA-逆向验证报告.md`、`ai-campus-agent-源码快照-ec2ec62.zip`（**免 git 的源码通道**）、`ai-campus-agent-git-bundle.bundle`（免凭证的 git 通道），操作细节见 `/workspace/Git同步操作指引.md`。
>
> 最近更新：2026-10-16 ｜ 更新者：WorkBuddy ｜ 对应提交：`ec2ec62` + 待提交的分支改名与 GitHub 同步通道
>
> ⚠️ **下一步做什么，请直接读 `/workspace/下一步方向调研报告.md` 第 8 节。**本文件第 6 节已按其结论重排待办。
> 🆕 **跨环境同步现已有正式通道**：主分支 `main`，远端为 GitHub **私有仓库 `2552555/timetable-ai`**（2026-10-16 推送，CI 全绿）。有 GitHub 凭证的机器直接 `git clone`；无凭证的机器用网盘 zip 快照（已验证解压即 134/134）。两种方式都有效，网盘通道继续保留。

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
| HEAD | 见 `git log -1 --oneline`（分支 `main`；已与 GitHub 私有仓库 `2552555/timetable-ai` 同步） |
| 开发进度 | **Step 0–7 全部完成**；**V1.0 收口三轮全部完成**（档案端点 + 端到端旅程 + 文档 + 展示态 STALE + 计划缓存失效）；**信息处理中心 `/info` 落地**（信息收纳盒 + AI 查询中心 + 最近解析预览，两处边界适配见 3.9） |
| 后端测试 | **209/209 通过**（0 失败 0 错误；含 P0-1 的 `UsageStatsIntegrationTest` 8 个、通知箱 `NoticeEndpointIntegrationTest` 9 个、P0-2 预算 `LlmBudgetGuardTest` 13 个、多 provider 路由 `LlmRoutingTest` 11 个、计划重试与并发 `AiCampusAgentDailyPlanRetryTest` 6 个、provider 配置 `LlmProviderSettingsTest` 9 个、provider 端点 `LlmProviderEndpointTest` 6 个、本地设置加密 `LocalSettingsEncryptionTest` 6 个、ThreadLocal 防回归 `AiStreamIdentityIntegrationTest` 2 个 + `RequestContextTest` 5 个） |
| 前端 | typecheck 通过；lint **0 错误 / 9 警告**（9 个全在存量文件：AiChatPage 3、TodosPage 1、5 个 Context/theme 各 1，属基线，不得新增）；build 通过 |
| 工作区 | 见 `git status`。**本地领先 origin 的提交均未推送**（数量以 `git rev-list --count origin/main..main` 实时为准，含 P0-1、通知箱/分时 UI、引导页/模块自定义、P0-2、身份修复及收工文档提交）。缺 `ghp_`/`github_pat_` 开头的 PAT，见 6.5 |
| 当前阶段 | V1.0 功能收口完成；**成本治理 P0-1（埋点 + 计量 + 看板）与 P0-2（月度预算 + 超限熔断）均已完成**；**《产品界面与功能细化方案》两轮均已完成**。**2026-10-18 用真实 DeepSeek Key 完成了首次端到端验收**，并修复了一个只有真实调用才能暴露的 P0（流式对话工作线程丢失调用方身份，详见第 5 节当日条目）。剩余仅**人工走查**（浏览器 / 桌面端打包），需用户在本机执行 |
| **⚠️ 多环境同步** | **2026-10-16 已推送 GitHub 私有仓库 `2552555/timetable-ai`**（https://github.com/2552555/timetable-ai ），remote `origin` 已配置，主分支 `main`，标签 `v1.0`。**CI 首次真实运行并全绿**（backend + frontend 均 success）。另一环境（Codex）的分叉提交 `9bb3200` **不在本仓库对象库中**，需先 fetch 再合并，或用网盘 zip 整体覆盖 |
| **网盘同步产物** | 根目录 `MTOwZfixfiEX`。`ai-campus-agent-git-bundle.bundle`（949,805 B，md5 `7b509d010dd527aaa6905c6186d91f2c`）+ `ai-campus-agent-源码快照-<HEAD>.zip`（md5 见《Git同步操作指引》§7）+ 三份文档，均已刷新到当前 HEAD 并经 **ETag == 本地 md5** 验证。上传/下载通道的坑见 3.7 与第 5 节当日收尾条目 |
| **线上部署状态** | `timetable.zozovip.work` 首页 200，但**前端是 baseline `61981d9`，未部署 V1.0**（资产哈希与字符串扫描实证，详见第 5 节 2026-10-16 条）。后端版本外部不可判定（API Key 拦截在路由前） |

**代码规模（2026-10-18 实测，含信息处理中心）**

| 层 | 文件数 | 行数 |
|---|---|---|
| 后端主代码 | 165 | 14,449（`service` 层占大头） |
| 后端测试 | 24 | 5,712 |
| 前端 | 62 | 16,042（11 页面 / 26 组件 / 4 API / 2 store） |

| 缺口 | 状态 |
|---|---|
| ① 无 LLM 调用计量/预算 | ✅ **已全部解决**：P0-1 计量与看板（V5 迁移 + `llm_usage` + `/api/stats/*` + 统计页）；**P0-2 月度预算与超限熔断**（两级额度 + 装饰器拦截 + 统计页预算卡片）。**默认不限制**，需显式配置额度。**2026-10-18 真实 Key 端到端验收**又抓出并修掉两个静默缺陷：CHAT/REFINE 场景不计量、流式对话丢身份（见第 5 节当日条目） |
| ② `LlmClientRegistry` 仅注册 DeepSeek 一家（单点 + 无法分级路由） | 未解决（6.1 第 2/3 项） |
| ③ 无用户行为埋点 | **提案确认/拒绝已解决**（P0-1：`ai_event` + `ai_action.decided_at`）；留存 / 计划采纳率未做 |
| ④ 无模型输出评估集 | 未解决 |

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
- **失败分类重试（2026-10-19，成本治理 6.1 #6）**：模型输出不合规是**常态**而非故障，一次就放弃等于把可恢复的抖动直接变成用户的失败。因此只对 502（校验不过）/ 503 / 504 重试，`app.llm.plan-retry.*` 控制次数与退避（指数 800→1600ms 封顶 4000ms + ≤300ms 抖动），默认 3 次；`enabled=false` 即退化为 V1.0 一次行为。**模板缺失（500）、未配置 provider（503 "AI 服务未配置"）、写库失败一律不重试**——重试一百次也还是那个结果，白等。抖动不是装饰：上游恢复瞬间多个用户的失败请求齐刷刷打过去会把上游再打死一次。
- **并发去重（2026-10-19）**：`generate()` 按 `apiKey@planDate` 加 `ReentrantLock`，同一天只允许一个请求真正调模型。此前是「先查缓存 → 再删旧行 → 调模型」全程无锁：两个请求同时进来会各烧一次 token，然后同时 insert 撞 `uk_daily_plan_date`，用户看到 500。锁在 `finally` 里用 `hasQueuedThreads()` 判断后摘除（必须与 unlock 同线程，否则会挤掉锁对象导致失序）。这是单机方案——多实例部署时这套缓存本身也不成立，别拿它当分布式锁。
- **旧计划不先删**：改成「新计划落库成功后再删旧行」（`replaceCached`）。先删后插的话，模型连续失败会让用户从「有份旧计划可看」变成「什么都没有」。有测试钉住（`keepsPreviousPlanWhenEveryRetryFails`）。

### 3.4 数据库与迁移

- Flyway 双 vendor：`src/backend/src/main/resources/db/migration/{h2,mysql}`，改结构必须**两处都改**。
- V4 新增 4 表：`student_profile`、`task`、`student_memory`、`daily_plan`。
- 既有表不会被 `CREATE TABLE IF NOT EXISTS` 升级，结构变更必须写迁移。
- **Course / Exam 表没有 `api_key` 列**，通过 `schedule_id` 间接归属；校验走 schedule 归属而非直接比对 apiKey。
- V5（成本治理 P0-1）新增 `llm_usage`（每次 LLM 调用的 token/延迟/成本）、`ai_event`（行为事件），并给 `ai_action` 加可空的 `decided_at`。**没有 JSON 列**，故不涉及 H2 的 TEXT / JacksonTypeHandler 兼容策略。
- V6 新增 `notice_card`（今日待阅通知箱）。**原始材料不落库**——整段群聊记录既占空间又有隐私负担，只存 AI 提炼后的结构化卡片。

### 3.5 测试约定

- **服务级集成**：`TestApplication` + `@Import` + 固定 Clock（`2026-09-27T02:06:00Z`，Asia/Shanghai）+ H2 mem `MODE=MySQL` + `@MockBean LlmClient`。真实事务、真实 Mapper、真实迁移，只 mock 外部 LLM。
- **例外**：`AiCampusAgentDailyPlanTest` 用 `Clock.systemDefaultZone()`。**凡是要比较「应用层时间戳 vs 数据库 `ON UPDATE` 时间戳」的测试，都不能用固定 Clock**，必须让两者同源（见 3.7）。
- **HTTP 层**：`@SpringBootTest(classes = TimetableApplication.class)` + `@ActiveProfiles("standalone")` + `@AutoConfigureMockMvc` + device 注册（`POST /api/auth/device`）取 key。
- 测试是全项目的安全网：**改动后任何既有测试失败，先判断是「预期变化」还是「真实回归」**，属预期变化的要在报告「偏离记录」里写明。

### 3.6 通知箱（今日待阅）

- **信息入口只有手动喂入**：用户转发/粘贴/截图给助手，AI 提炼成卡片。**没有自动抓取**——群消息监听、教务系统对接、校园邮箱同步全部不做（见第 6 节红线）。
- **截图路径复用既有 OCR**：`POST /api/notices/extract` 只接受文本。前端先调 `aiApi.parseImageText` 转文字再进来，这样图片校验与并发闸门不用在通知箱里重复实现，OCR 成本也落在它自己的埋点场景 `SCENE_OCR` 上。
- **卡片不是任务**：`notice_card` 与 `task` 分开。通知里绝大多数是「知道了就行」的信息，自动转任务会让待办区迅速失去信噪比。只有用户点「加入日程」才转。
- **「忽略 → 降低同类信息」是显式规则，不是学习模型**：按 `source` 统计历史忽略率，超过 50% 且样本 ≥ 2 条的来源其新卡片**排序靠后**。降权只影响顺序，**不隐藏任何卡片**——用户没说「别再给我看」，只是「别老推这个」。
- 只统计 `IGNORED` / `DONE` 两种已决定状态参与降权计算。PENDING 的卡片还没被看过，用它去惩罚用户会导致「刚导入一批通知还没看，新通知就被降权」。

### 3.7 已踩过的坑（别再踩）

| 坑 | 说明 |
|---|---|
| 裸 `orderByAsc` 把 NULL 排最前 | 任务排序必须用 `CASE WHEN deadline IS NULL THEN 1 ELSE 0 END` 做 nulls-last |
| `Long x = cond ? node.asLong() : null` | 三元混用 `long` 与 `null` 触发自动拆箱 NPE，必须显式 if/else |
| `Timestamp.valueOf("2026-09-28 23:59")` 缺秒 | 用 `LocalDateTime.parse(s.replace(" ", "T"))` |
| `isValidProposal` 的 switch 漏分支 | 漏了会静默丢弃整类提案；每加一种 action 必须同步 `splitToSingleActions` / `recordField` / 校验分支三处 |
| `LlmClientRegistry.active()` 先抛 503 | 之后的 `isConfigured()` 分支是永远走不到的死代码 |
| 给被 `@Import` 的组件加硬依赖 | `LlmClientRegistry` 加 `LlmUsageRecorder` 挂 12 个用例、加 `LlmProviderSettings` 挂 **81 个**。精简测试上下文不会 Import 新组件，用 `ObjectProvider` + `getIfAvailable()` 兜住 |
| 为了让 `List.copyOf(keys)` 不 NPE 而丢弃 client | 跳过 `providerId()` 为 null 的实现，等于把 AI 整个关掉（挂 57 个用例）。给稳定占位 id 继续用才对——降级要保证功能还在 |
| `mvn -q test` 会吞掉断言失败 | `-q` 只保留 ERROR 级别的 Maven 输出，surefire 的失败明细写进了 `target/surefire-reports/*.txt` 而不上屏。跑「预期会失败」的变异验证时，别拿 `mvn -q` 的 stdout 判断结果，去看那份报告（`Failures`/`Errors` 计数） |
| 并发去重锁在 `finally` 里直接 remove | 必须 `if (!lock.hasQueuedThreads())` 才摘除，且判断与 `unlock()` 同线程。否则等锁的线程还没进排队队列时对象被摘走，后续请求会拿到一把新锁，锁形同虚设 |
| 前端 `client.ts` 方法白名单 | 新增 HTTP 方法（如 PATCH）要在 Options 白名单里补 |
| 前端 `&&` 短路返回 `unknown` | `m.target_id != null` 才能拿到 boolean，否则 `isUpdate && <Tag>` 报 TS2322 |
| MockMvc `getContentAsString()` 无参 | 按 ISO-8859-1 解码 UTF-8 响应 → 中文乱码。必须写 `getContentAsString(StandardCharsets.UTF_8)`（jsonPath 内部用 UTF-8，所以断言可能过、自己解析却乱码） |
| 提案执行前动了同域数据 | 会让提案变 STALE（409）。这是设计：用户改过数据后旧提案不该再执行。写旅程测试时注意操作顺序 |
| 档案补丁「null=保持原值」 | AI 提案语义如此；表单要「清空=删除」，走 `profileService.replace` 而不是 `applyPatch` |
| 固定 Clock 与数据库 `NOW()` 不同源 | `AiCampusAgentDailyPlanTest` 原来固定 2026-09-27，而 H2 `NOW()` 是真实当前时间（相差数周）→ stale 判定恒为 true，连「二次生成命中缓存」都失败。凡是比较应用层时间与 DB `ON UPDATE` 时间的逻辑，测试夹具必须用 `Clock.systemDefaultZone()` |
| `List.of(...)` 不接受 null | `MAX(updated_at)` 无数据时返回 null，塞进 `List.of` 直接 NPE。改用 `String[]` 循环累加 |
| **测试里写死「今天」的日期字面量** | `TaskEndpointIntegrationTest` 曾写死 `2026-10-15` 作为任务截止时间，而 `AiServiceImpl.parseExtractedDeadline` 的设计是「**过去的截止时间一律清洗成 null**」→ 日期一翻篇（2026-10-16）断言必挂。**两类时钟要分清**：① 带固定 `Clock` 的 AI 测试（`AiCampusAgent*Test`，today 恒为 2026-09-27）写死日期是安全的；② `@SpringBootTest` 全量启动、无 Clock 覆盖的测试（`TaskEndpointIntegrationTest` 等）用的是 `TimeConfig` 真实系统时钟，**凡是「未来/过去」语义的日期必须用 `LocalDate.now().plusDays(n)` 相对构造**。手动创建路径（`POST /api/tasks`）不过期清洗，写死过去日期反而不受影响——这个不对称是设计，别"顺手统一" |
| **改 `LlmClient` 方法签名 → 波及所有 mock** | P0-1 给 `chatJson` / `chatJsonStream` 加了带 `scene` 的重载，旧签名保留为 `default` 方法。这样**只保证实现类零改动，不保证调用方零改动**：测试里 50 处 `when(provider.chatJson(any()))`（1 参）不再匹配业务侧 2 参调用，Mockito 静默返回 null，报出来的是「AI 未返回内容」这种完全指不到根因的错。**接口签名变更后，先全局搜 mock 再跑测试**，别指望 default 方法能一劳永逸 |
| **分时换肤别全局改 CSS 变量** | 项目是「CSS 变量（`index.css`）+ antd `ConfigProvider` TOKENS（`theme.tsx`）」**双轨并行硬编码**——antd Card 的背景来自 `colorBgContainer` 而不是 `var(--bg-card)`。全局改变量会让自定义 class 与 antd 组件逐层脱节。正确做法是在页面容器（`.dashboard-page[data-period]`）作用域内只覆盖 `--accent` 与页面级 tint，不碰主题本身，也不覆盖用户手动选的亮/暗模式 |
| **`useMemo` 不能写在 early return 之后** | `DashboardPage` 有 `if (loading && !data) return <Skeleton/>`，在它之后调用 `useMemo` 会违反 Hooks 调用顺序，lint 的 `rules-of-hooks` 直接报错（不是警告）。要么把 Hook 提到 early return 之前，要么像 `nextCourse` 那样改成普通计算——给小数组排序每次重算的成本可以忽略 |
| **裸 `FloatButton` 会重叠** | antd 的 `FloatButton` 默认都定位在右下 24px，想放第二个必须用 `FloatButton.Group` 包起来，否则两个浮球叠在同一位置互相遮挡 |
| **语音 hook 绑在会重挂载的组件上会被打断** | `useSpeechInput` 在组件卸载时 `abort`。录音途中用户切页面/关弹窗就会静默中断。全局语音能力必须提到 Provider 层（本项目是 `VoiceAssistantProvider` 挂在路由外层）。另外 `onTranscript` 给的是**累计全文**不是增量，必须用 ref 存住录音前的 base 文本再拼接 |
| **埋点/统计类代码的两个通病** | ① 浮点金额直接返回 → 前端拿到 `0.026600000000000002`，必须 `roundMoney()` 取整 4 位；② 毫秒→秒换算里 `/10` 写了两次 → 耗时差 10 倍。两者都是**测试先发现的真实产品 bug**，别把断言改成迁就实现 |
| **往长 JSX 里插函数时先看自己在不在 `return (` 里** | 给 `DashboardPage` 加 `renderModule` 时按「`<Row>` 这一行」定位插入点，结果函数被插进了 JSX 内部，报的是 `TS1382: Unexpected token. Did you mean {'>'}?` 这种完全指不到位置的错。**按行号脚本改动 JSX 文件后，第一件事是确认插入点相对 `return (` 的位置** |
| **localStorage 里的用户配置必须读时清洗** | 存模块的 `order` / `hidden` 时，只过滤「认识的 key」还不够——**必须把默认列表里有、存档里没有的 key 补进去**。否则以后新增模块，老用户存档里没有它，就永远看不到这个新功能，而且根本不知道去哪开。JSON 解析失败要静默回默认，别让一个坏存档把首页搞白屏 |
| **`LlmClientRegistry` 是 8 个测试切片的显式 `@Import` 项** | 给 registry 加构造依赖（P0-2 加了 `LlmBudgetService`）会让这 8 个切片全部起不来上下文。**改 registry 构造函数 = 同步改 8 个测试文件的 `@Import` 与 import 语句**。别用 `Optional` 注入来「省事」——熔断 bean 缺失时静默失效正是最危险的失败模式 |
| **配置 Map 的 key 要归一化** | yml 里写 `chat:` 而场景常量是 `CHAT`，不在 setter 里转大写就会「配置看起来对了但永远命中不了」。这类静默失效最难查 |
| **ThreadLocal 身份传不进线程池** | `RequestContext` 是 ThreadLocal，异步任务（`streamExecutor`）跑在工作线程上取不到调用方设的值。下游 `DeepSeekLlmClient` 读到 null **不报错**，只会静默不记账、静默跳过预算检查。**这个 bug mock 测试永远测不到**——被替换掉的正是读 ThreadLocal 的那段代码；防回归测试必须让 mock 在被调用时**主动读一次 `RequestContext`** 复现真实行为。修复模式：异步派发一律走 `RequestContext.callWithApiKey(apiKey, task)`（set → 执行 → finally 恢复），且**必须恢复**——线程复用下残留身份会让下一个请求的花费记到本账号，比丢失更危险 |
| **mock 忘了 stub `isConfigured()` → 503 走「无声」分支** | `LlmClientRegistry.active()` 在没有任何客户端 `isConfigured()` 时抛 503 `BusinessException`。流式链路里这个异常只 `emit("error")` + `complete()`，**不调 `SseEmitter.onError`、不打 error 日志**。排查指纹：mock 从未被调用 + 无任何异常日志 + `onError` 未触发 = 任务在到达 LLM 之前就抛了 `BusinessException`。所有 stub `chatJson*` 的测试都要先 `when(provider.isConfigured()).thenReturn(true)` |
| **网盘上传成功的判据是 PUT 响应，不是下载** | COS 对成功的单部 PUT 返回 **HTTP 200 + 空 body + `ETag` = 文件 MD5**；失败一定带 XML 错误体（如 `InvalidAccessKeyId`，542 字节）。**下载失败 ≠ 上传失败**：`file_download` 签发的 URL 自身出过两次故障（10-16 presign 的 AK 无效；10-17 晚间 URL 干脆缺 presign 签名参数），都报 `InvalidAccessKeyId`，但当时的上传其实是好的。曾因此**误删过已上传成功的 bundle 条目**又重传一遍。正确做法：PUT 后核对 `ETag == 本地 md5` 即完成内容级验证，比下载回传更硬；下载只作端到端抽验 |
| **网盘 COS 临时凭证偶尔「签发即无效」** | `file_upload` 返回的预签名 URL 有小概率直接不可用（首次 PUT 即 `InvalidAccessKeyId`）。处理：**原样重发一次 `file_upload` 拿新凭证**，不要改代码也不要怀疑密钥——重签后同样方法立刻成功。凭证有效期约 2 小时（`q-key-time`），过期重签即可 |
| **standalone 真机验证必须 `-Pstandalone` 打包** | H2 驱动只在该 profile 里是 `runtime` scope，不带就 `Cannot load driver class: org.h2.Driver`，而且报错会伪装成 `courseMapper` → `sqlSessionFactory` → `dataSource` 一长串 bean 创建失败，看着像代码问题。同一 profile 还负责把 `frontend/dist` 复制进 jar。真机验证前先 `unzip -l target/*.jar \| grep -c "BOOT-INF/lib/h2"` 自查 |
| **真机验证要 `--app.bootstrap-key=`** | 否则 `ApiKeyBootstrap` 走「无初始账号」分支，所有写接口 401（连注册都要 Key，形成死锁）。日志特征：`No bootstrap account configured` |
| **「把错误原文附在翻译后面」的清洗顺序** | 我曾用「滤掉非字母数字后看剩下什么」判断原文是否只有状态码，结果把中文（「账户余额不足」）也滤成空，差点吃掉用户唯一能查文档的线索。**正确顺序：先剥掉自己的模板词（中文，会干扰判断）→ 见非 ASCII 就一律保留 → 最后才清洗做判断**。并且这个判断要配一正一反两条测试，只测「不显示冗余」会掩盖「误吃信息」 |
| **`llm.provider.` 前缀是保留给 provider 名的** | `localProviderIds()` 会把 `llm.provider.<x>.*` 里的 `<x>` 当 provider 名收集。想加「默认 provider」这类全局键，必须放在前缀之外（本项目用 `llm.active-provider`），否则会凭空多出一个名叫 `active` / `default` 的 provider，而且症状很怪：设置页多一行空配置 |
| **改 `active-provider` 的读法要一次改全三处** | `forScene` / `activeProviderId` / 构造函数日志各读一次，漏一处就出现「切了但日志还写着旧的」或「切了但对话还用旧的」。统一收进一个 `configuredActiveProvider()`，并写一条**变异测试**（把它改回直接读 properties，测试必须失败）——只断言「界面显示了新值」是测不出这个的 |
| **兜底态必须显式暴露，不能静默回退** | 默认 provider 配置坏了时 registry 会按可用性自动回退（这是对的，否则全站 503）。但如果界面只显示「当前默认：alpha」，用户会以为在跑 alpha，实际在跑 beta，账单和效果都对不上。要有一个明确的 fallback 态并给出警告 + 一键改回的出口 |
| **删掉正在当默认的 provider 要连带清默认设置** | 否则下次启动指向不存在的 id。但不该「自动挑下一个」——默认用谁是用户的决定。相应地，端点测试的 `@BeforeEach` 也要单独复位默认值，因为那个「删 provider」的清理循环只在默认正好等于该 provider 时才连带清 |

### 3.8 预算熔断（成本治理 P0-2）

**两级额度，语义不同**：

| 级别 | 配置 | 超了会怎样 |
|---|---|---|
| 场景额度 | `app.llm.budget.scene-monthly-limits.<scene>` | **只熔断该场景**。对话超限不该让课表解析一起挂——后者往往更紧急、更不可替代 |
| 全局额度 | `app.llm.budget.monthly-limit-cny` | 熔断全部（总闸） |

**默认不限制**：两项都不配时 `isEnabled()` 为 false，拦截整体跳过。预算熔断默认打开会让没配预算的人某天突然用不了 AI 且不知道为什么——要熔断必须显式配额度。

**拦截点在 `LlmClientRegistry.active()` 返回的装饰器**（`BudgetAwareLlmClient`），而不是 `DeepSeekLlmClient` 内部。理由：① 换 provider 不用重做；② 检查在 delegate 调用**之前**，超限的请求一次 token 都不花。装饰器**不是 Spring bean**——否则会被 registry 的 `List<LlmClient>` 收集进去自己包自己。

**统计口径与用量看板完全一致**（同自然月、同单价表、失败调用同样计入），否则会出现「看板说没超，但请求被拦」这种无法解释的现象。额度按自然月结算，每月 1 号自动归零，无定时任务。

### 3.9 信息处理中心的两处边界适配（`/info`，2026-10-18）

用户设计稿里有两处要求与项目登记禁区/工程现实冲突，落地时做了适配，**续写或扩展该页面前必读**：

1. **「AI 自动检索官方渠道最新动态」≠ 自动爬取**。登记禁区明确「不做自动爬学校系统」。因此 `queryPlan` 的定位是**结构化查询计划**：AI 输出「目标 / 去哪查（channels，只给渠道名称不给实时内容）/ 注意事项 / 分阶段节点（phases + leadDays 通用周期经验值）」，prompt 模板里写明「你不联网、不检索、不知道最新动态」，note 字段必须提醒以官方渠道当期公告为准。**若未来要做真检索**，方向是用户显式授权下的官方源白名单 + 定时轮询，且要重新过禁区评审，不要直接在该端点上加抓取逻辑。
2. **「上传文件仅存本地浏览器缓存」的真实语义**。文本类文件（PDF/DOCX/TXT/MD/CSV/JS/HTML）确实是纯客户端本地提取（pdfjs / mammoth 在浏览器内完成，字节不出设备）；但截图 OCR 复用既有 `aiApi.parseImageText`，**经服务器瞬态转发、不落盘**；解析产生的 notice 元数据落设备工作区（服务端）。页面文案因此写「文件在浏览器本地读取，原文不作保存」，**不要**写「自动存入本地并解析」——原文件并不保存，写了就是误导。
3. **订阅 = 本地收藏查询条件**。`timetable.querySubs.v1` 只存 id/category/keyword/时间，作用是「之后一键重新生成计划」。没有后台匹配、没有推送——文案不得声称「会提醒你」。

### 3.10 多 provider 路由与降级的三条硬约束（2026-10-19）

改动 `LlmClientRegistry` / `FallbackLlmClient` / `AbstractOpenAiLlmClient` 前必读：

1. **流式调用一旦吐过正文，就绝不能再切 provider 重试。** 否则备用 provider 的回复会接在
   已吐出的内容后面，用户看到两份内容拼在一起。`FallbackLlmClient` 用计数监听器盯着
   `onReasoning` / `onContent`，已产出就直接抛原错误。非流式没有这个顾虑，可以放心重试。
2. **499（客户端已断开）不重试。** 用户都走了，再切一家纯属浪费上游配额。其余错误码
   （401/429/502/504…）换一家往往就能成功——这正是配第二个 provider 的意义。
3. **装饰器顺序是 `BudgetAware(Fallback(primary, backups))`。** 预算检查必须在最外层：
   超限的调用一次 token 都不该花，更不该去重试。反过来包会让每次重试都多一次预算判定。

**踩过的坑**：`LlmClientRegistry` 不要直接注入 `ObjectMapper` / `LlmUsageRecorder`。精简的测试
上下文（如 `campus-agent-plan`）没有 `LlmUsageMapper`，硬依赖会让整个容器起不来——12 个测试
就是这么挂的。用 `ObjectProvider` 且**只在真配了 provider 时才 `getIfAvailable()`**。

---

### 3.11 界面配置 provider 的三个约束（2026-10-19）

- **加密判据必须按模式，不能按字面量**：`LocalSettings` 最初只对 `deepseek.api-key` 加密，其余键明文落盘。新增 `llm.provider.<id>.api-key` 时会静默泄漏用户 Key，而界面文案还写着「加密保存」。现改为匹配 `*-api-key`，AAD 绑定真实键名（不同键的密文不能互换），启动时把历史明文敏感项补加密。**以后新增任何存 Key 的键名，务必以 `api-key` 结尾。**
- **优先级是「界面 > 配置文件」**，且字段级覆盖：只填 Key 时模型名仍取 yml。反过来（配置赢）会出现「我明明填了为什么还用旧的」，是最难排查的一类问题。
- **热生效靠配置指纹**：`LlmProviderSettings.version()` 变化时 registry 重建动态客户端。指纹里 Key 必须用摘要而非长度——第一版算长度，`sk-1` 换 `sk-2` 不触发重建，用户改了 Key 还在用旧的。
- **`deepseek` 有独立入口**：它走既有 `deepseek.api.*` 与本机 Key 设置，provider 端点显式拒绝这个 id，避免两个入口互相打架。

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
| `service/DeepSeekLlmClient.java` | DeepSeek 调用实现。**token 计量落点**：非流式读 `usage`，流式必须开 `stream_options.include_usage`（usage 在最后一个 chunk） |
| `service/LlmUsageRecorder.java`、`service/AiEventRecorder.java` | 成本/行为埋点。**异常必须吞掉**，埋点不能影响业务 |
| `config/LlmPricingProperties.java` | 单价表（`app.llm.pricing`）。**调价走环境变量，别改代码** |
| `service/impl/NoticeServiceImpl.java` | 今日待阅通知箱。source 降权是**显式规则**不是学习模型；只统计已决定状态 |
| `controller/NoticeController.java` | `/api/notices/*`。转任务后要调 `invalidateProposalsOnDataChange` |
| `service/impl/UsageStatsServiceImpl.java` | 用量聚合 + 提案漏斗 + 预算卡片。注意 `roundMoney()` 与 `avgDecideSeconds` 的毫秒→秒换算 |
| `service/LlmBudgetService.java` | P0-2 预算判定。**场景额度只拦该场景，全局额度拦全部**；统计口径与用量看板必须一致 |
| `service/BudgetAwareLlmClient.java` | P0-2 拦截装饰器，由 `LlmClientRegistry.active()` 包装。**不是 Spring bean**（否则被 `List<LlmClient>` 收集进去自己包自己） |
| `config/LlmBudgetProperties.java` | 预算配置。**默认不限制**；Map key 在 setter 里转大写 |
| `service/impl/PromptTemplateRegistry.java` | `resources/prompts/*.md` + front matter `version:N`；缺失返回 null 降级 |
| `controller/` | `AiController`（聊天/提案执行；**流式任务必须经 `RequestContext.callWithApiKey` 携带身份进工作线程**）、`TaskController`、`DailyPlanController`、`DashboardController`、`MemoryController`、`StudentProfileController`、`UsageStatsController`（`/api/stats/*`） |
| `interceptor/RequestContext.java` | ThreadLocal 身份。**异步派发一律走 `callWithApiKey(apiKey, task)`**（set → 执行 → finally 恢复调用前状态）；空身份时 `LlmUsageRecorder` / `LlmBudgetService` 会打 warn 日志 |
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
| `pages/DashboardPage.tsx` | 首页（AI Dashboard）：档案问候、今日课程/任务、48h、考试、规则重点、每日计划 + **分时动态 UI**（早/午/晚三档内容权重，共用同一份数据）+ **模块自定义**（`renderModule` 按配置渲染，注意它必须在 `return (` 之前定义） |
| `pages/AiChatPage.tsx` | AI 聊天（流式） |
| `pages/SettingsPage.tsx` | 设置：小组件地址、AI Key、**长期记忆管理**、字体、作息表 |
| `pages/StatsPage.tsx` | AI 用量统计（路由 `/stats`）：成本/调用/token/确认率 + 每日趋势 + 分场景 + 提案漏斗 + **本月预算卡片**。`budget` 为 null 时整块不渲染。**不引图表库** |
| `pages/OnboardingPage.tsx` | 启动引导页（3 步）+ 使用指引。**第 2 步的「它不会做什么」不许删**——避免过度承诺 |
| `pages/UserManualPage.tsx` | 用户手册。顶部有「再看一次功能说明」常驻入口，跳转到 `/onboarding` |
| `hooks/useDashboardModules.ts` | 首页模块排序/显隐，存 `timetable.dashboard.modules`。**时段可用性（`periods`）与用户开关分开**：前者不可改 |
| `components/DashboardModuleSettings.tsx` | 模块自定义弹窗（上下箭头排序 + 开关 + 恢复默认） |
| `components/NoticeInboxPanel.tsx` | 今日待阅卡片列表（加入日程/忽略/稍后提醒/了解详情） |
| `components/NoticeDraftModal.tsx` | 通知草稿确认弹窗（human-in-the-loop） |
| `store/VoiceAssistantContext.tsx` | 全局语音新增待办。**Provider 挂路由外层**，否则录音会被卸载打断 |
| `hooks/useReminders.ts` | 三级提醒。**纯前端，关页面不提醒**，阈值写 `REMINDER_LEADS` 常量便于后续接后端推送 |
| `components/AiActionCard.tsx` | 提案卡渲染（每类 action 一套展示，新增 action 要同步） |
| `components/MemoryManager.tsx` | 记忆管理（添加/行内编辑/归档/删除） |
| `components/PlanTimeline.tsx` | 每日计划时间线 |
| `components/TaskCard.tsx`、`TaskDraftModal.tsx` | 任务卡片与材料解析草稿确认 |
| `types/index.ts`、`api/index.ts` | 类型与 API 客户端（新增端点要同步两处） |

---

## 5. 会话日志（倒序，最新在最上）

### 2026-10-19 · WorkBuddy · 界面里切换默认 provider（成本治理 6.1 #2 收尾）

**动机**：上一轮做完连通性测试后还剩最后一个缺口——**测通了也不代表在用它**。
`active-provider` 只读 yml，桌面单机版用户没法换默认服务。

**做了什么**：
1. `LlmProviderSettings` 新增本地覆盖键 `llm.active-provider`，优先级同 provider 字段
   （界面 > 配置文件）
2. 三道写入校验：id 合法、provider 存在、**配置必须完整**
3. `PUT /api/ai/providers/active` + `DELETE /api/ai/providers/active`（重置回配置文件）
4. registry 三处取 `active-provider` 的地方统一走 `configuredActiveProvider()`
5. 设置页：表格状态列加「默认」标签、操作列加「设为默认」、顶部状态条三态

**最关键的约束：不能把默认设成配置不全的 provider。**
放行的话用户点完看不出任何异常，问题要到下一次对话才炸，且报错完全不指向这里。
所以后端直接 400 拒绝，前端按钮同步禁用——两道闸，而不是「相信前端会拦」。

**状态条刻意分三色**，因为严重程度完全不同：
- 绿：正常，标出「界面设置 / 配置文件」来源，界面设的可一键改回
- 红：一条都不可用
- **黄（fallback）**：设的那个不可用、正在按可用性兜底

黄色这一态最需要喊出来——用户以为在用的是 A，实际在跑 B，账单和效果都对不上，
不写清楚就永远发现不了。这个状态没有用「静默回退」敷衍过去。

**验证**：
- 新增 11 项测试（7 个 settings + 4 个端点），**全量 232/232 绿**
- **变异验证**：把 registry 改回只读 `properties.getActiveProvider()`，
  `registryRoutesToUiSelectedProvider` 立刻失败——证明测的是「注册表真的读了」，
  而不只是「界面显示了」
- **真机端到端**（standalone jar + 两个会回显端口的假上游 + 真发起 AI 对话）：
  - 默认 alpha → 对话回复「来自端口17901」；切到 beta → 回复「来自端口17903」。
    **这是最硬的证据：切换真的改变了实际调用走向，不只是界面刷新**
  - 把默认的 alpha Key 清掉 → `activeSource=fallback`，AI 自动走 beta 而不是 503
  - Chromium 点击 8 项断言全过：状态条、默认标签、禁用态、切换、改回
  - 截图：`docs/assets/llm-provider-active-switched.png`（切换成功）、
    `llm-provider-active-fallback.png`（兜底警告）

**踩到的坑**：
- **`llm.active-provider` 不能放 `llm.provider.` 前缀下**：那个前缀被
  `localProviderIds()` 当 provider 名扫描，`llm.provider.active` 会被误认成名叫
  `active` 的 provider
- **删 provider 要连带清默认设置**：否则下次启动指向不存在的 id。但不做「自动挑下一个」
  ——默认用谁是用户的决定，不该替他猜
- **端点测试的 `@BeforeEach` 要一起复位默认**：删 provider 才连带清默认，
  所以那个循环清不掉残留

### 2026-10-19 · WorkBuddy · provider 连通性测试（成本治理 6.1 #2 收尾）

**动机**：上一轮做完界面配置后，用户填完 Key 只能靠「生成一次计划」间接验证。
既慢，又把「配置问题」和「内容问题」混在一起——报错了不知道该改 Key 还是改 prompt。

**做了什么**：
1. `LlmProviderProbe`：真发一次最小请求（`回复两个字：可用`），15 秒总时限，
   独立单线程池（不抢公共池），`scene=null` 走无埋点路径，**不写 `llm_usage`**
2. `POST /api/ai/providers/{id}/test`：**只测已保存的配置，绝不接受前端传 baseUrl**
   —— 否则这端点就是现成的 SSRF 跳板
3. 错误翻译：401→Key 无效 / 404→地址或模型名不对 / 429→额度问题 / 连接失败→查网络
4. 前端：表格每行「测试」按钮（逐行 loading）+ 表格下方**常驻结果区**

**为什么不用 toast 就够了**：失败原因常有五六十字（要告诉用户去改哪一项），
toast 三秒就没了。结果区能停着看、能对照着改，还带可关闭。

**三个设计取舍**：
- **失败也返回 `latencyMs`**：0.1 秒失败是被拒（Key/地址错），3 秒失败是网络慢，
  这是用户唯一能自己判断的线索。为此专门补了
  `everyFailureCarriesLatencySoUiCanTellFastRejectFromSlowNetwork`
- **原文只有状态码时不附「（原文：…）」**：`（原文：AI 服务调用失败: HTTP 401）`
  对用户零价值，状态码的信息已经在翻译句里了。但**上游真带了额外说明就必须保留**
  （「账户余额不足」是用户唯一能拿去查文档的线索）。两条测试一正一反钉住
- **保存或删除后清掉该 provider 的测试结论**：配置都改了，上次的「可用」已经过期，
  留着会让用户以为还在用这个服务

**验证**：
- `LlmProviderProbeTest` 8 项（真实 `HttpServer` 当上游，不 mock HTTP 层——
  要测的就是「状态码怎么翻译成人话」）、`LlmProviderEndpointTest` 10 项
- **全量 221/221 绿**；前端 tsc 干净、eslint 9 warnings（与基线一致，0 error）、build 通过
- **变异验证**：删掉所有 `latencyMs` 赋值，新用例立刻失败
- **真机点击验证**（standalone jar + H2 + Chromium，两个假上游分别返回 200 和 401）：
  - 点 good 行「测试」→ 绿色 toast「good 可用（41 ms）」+ 结果区
    「good 可用 · fake-ok · 41 ms / 模型返回：「可用」」，按钮变「重新测试」
  - 点 leaky 行「测试」→ 红色结果区「API Key 无效或已过期，请检查 Key 是否填对、
    是否属于这个服务」，无多余原文
  - 页面上 grep 明文 Key：0 次。截图存 `docs/assets/llm-provider-probe-ok.png`、
    `llm-provider-probe-fail.png`

**踩到的坑（已记入 3.7）**：
- **`standalone` 打包必须带 `-Pstandalone`**：H2 驱动只在该 profile 里是 runtime
  scope，不带就 `Cannot load driver class: org.h2.Driver`；前端 dist 也是这个 profile
  才复制进 jar
- **`ApiKeyBootstrap` 要 `--app.bootstrap-key=`** 才能有 ADMIN 账号，否则所有写接口 401
- **错误翻译的误判方向**：我先用「滤掉非字母数字后看剩下什么」判断原文有没有额外信息，
  结果把中文「账户余额不足」也滤成空，差点吃掉关键线索。正确顺序是
  **先剥自己的模板词 → 见非 ASCII 就保留 → 再清洗判断**

**未做**：「设为默认 provider」按钮（要改 `active-provider`，涉及运行时改 yml 语义，
需先加本地覆盖层，否则可能把默认设成未配置的 provider 导致全站 503）。
（已在 2026-10-19「界面里切换默认 provider」一条中完成。）

### 2026-10-19 · WorkBuddy · 设置页配置 AI 服务提供方（成本治理 6.1 #2 收尾）

**动机**：`app.llm.providers.*` 只能改 yml / 环境变量。桌面单机版用户没有运维，
注册了 provider 却配不上，等于功能不存在。

**顺手挖出一个安全问题**：`LocalSettings` 的 AES-GCM 只在键**等于字面量**
`deepseek.api-key` 时才生效，其它键一律明文写入 `settings.properties`。
也就是说，如果按最直觉的写法加一个 `llm.provider.glm.api-key`，用户的 GLM Key
会明文躺在磁盘上，而界面文案还在承诺「Key 加密保存在本机配置中」。
改为 `*-api-key` 模式匹配 + AAD 绑定真实键名 + 启动时补加密历史明文项。

**做了什么**：
1. `LlmProviderSettings`：本地设置覆盖 yml（字段级），优先级「界面 > 配置文件」
2. 热生效：`version()` 指纹变化即重建动态客户端，不重启
3. `/api/ai/providers` GET/PUT/DELETE，权限同 `/ai/config`，只回掩码 Key
4. 设置页 `LlmProviderSettings.tsx`：表格 + 表单 + 四个预设一键填

**验证**：
- 新增 21 项测试，**全量 209/209 绿**
- 加密做了**变异验证**：退回「只认字面量键」，3 个用例立刻失败
- **真机端到端**（standalone jar + H2 + 静态代理 + Chromium）：
  空白页 → 点「智谱 GLM」预设 → 填 Key → 保存 → 表格出现 `glm / 可用 / 界面配置`，
  绿色提示「当前可用: glm」；`settings.properties` 里 Key 是 `ENCv1:` 密文，
  明文 grep 计数为 0。截图存 `docs/assets/llm-provider-settings.png`
- 真机还验了：只改模型名时 Key 保留、非法地址/非法 id/deepseek 三种 400、删除后回退

**踩到的两个坑（已记入 3.7）**：
- `LlmClientRegistry` 新增 `LlmProviderSettings` 硬依赖 → 12 个精简测试上下文全挂，
  一次 **81 个用例**失败。上次 `LlmUsageRecorder` 已经踩过一次，这次又踩了。
  **结论：注册表这类被测试 `@Import` 的组件，新依赖一律用 `ObjectProvider`。**
- 修的时候改错了一次方向：为了避开 `List.copyOf(null)` 的 NPE，我一开始直接
  `continue` 跳过 `providerId()` 为 null 的 client，结果把 `@MockBean` 的 client
  整个丢了，AI 变成「未配置」，又挂 57 个。**正确做法是给稳定占位 id 继续用，
  而不是丢弃 client**——丢掉等于功能突然不可用，比 id 难看严重得多。

**未做**：「设为默认 provider」按钮（要改 `active-provider`，涉及运行时改 yml 语义，
需先加本地覆盖层，否则可能把默认设成未配置的 provider 导致全站 503）。

### 2026-10-19 · WorkBuddy · 计划生成失败重试退避 + 并发去重（成本治理 6.1 #6 收尾）

**动机**：`#6 降级与重试` 此前只做了「provider 挂了切备用」，缺的是另一半——**provider 正常但模型这次没排好**。而后者恰恰是高频路径：模型输出漏课、时间格式错、忘排休息都会被服务端校验拦下抛 502，用户点一次「生成」失败一次，看起来像 AI 坏了。

**改动（`DailyPlanServiceImpl`）**：

1. **失败分类重试**：抽出 `generateWithRetry(...)`，只重试 502/503/504；500（模板缺失）、未配置 provider 抛的 503、写库失败一律直接抛。退避 = `initial × 2^(attempt-1)` 封顶 `max` + 抖动。默认 3 次 / 800ms→1600ms / 封顶 4000ms / 抖动 ≤300ms，全部走 `app.llm.plan-retry.*` 环境变量可调，`enabled=false` 退回 V1.0。
2. **并发去重**：按 `apiKey@planDate` 加 `ReentrantLock`，把「查缓存 → 调模型 → 落库」整段纳入临界区；锁后重查缓存，其余并发请求直接命中。
3. **旧计划保留**：先删后插改先插后删（`replaceCached`），重算失败不再把用户手里的旧计划一起弄没。
4. **顺手修的 NPE**：原 `items.sort((a,b) -> a.getStart().compareTo(b.getStart()))` 比较的是解析出的 `LocalTime`，模型给畸形时间时 `start` 为 null → 排序 NPE → 500。改为按 `HH:mm` 字符串比较（定宽，字典序即时间序）。

**验证**：
- 新增 `AiCampusAgentDailyPlanRetryTest` 6 项，**全量 188/188 绿**（171 原有 + 11 上轮路由 + 6 本轮）。
- **做了变异验证**，确认并发用例不是假绿：把 `GENEATION_LOCKS.computeIfAbsent` 换成 `new ReentrantLock()`（等价于不加锁）后，该用例立刻失败，报 `DuplicateKeyException: uk_daily_plan_date` —— 这正好实证了「无锁并发会撞唯一键，用户看到 500」。
- 注意：`mvn -q` 下变异体的失败不打印到 stdout，要看 `target/surefire-reports/*.txt`（是第一眼看漏的原因，记一笔）。

**未做**：界面配置 provider（#2 仍缺）；计划采纳率埋点（#1 仍缺，需要先给 `daily_plan` 补决定时刻字段）。

### 2026-10-19 · WorkBuddy · GitHub 推送打通（SSH 公钥注册生效），36 个提交全部上远端

**凭据链终态（本轮实测）**：用户把 SSH 公钥加到了 `github.com/settings/keys`，`ssh -T git@github.com`
返回 `Hi 2552555!`——**只读凭据的时代结束**。

**踩坑（值得记住）**：`ssh -T` 认证成功，但 `git push` 仍然 `Permission denied (publickey)`。
原因是 git 的 ssh 只默认加载 `id_ed25519` / `id_rsa`，**不认非默认命名的密钥**
（本项目是 `id_ed25519_github`）。解决：`git config core.sshCommand "ssh -i /root/.ssh/id_ed25519_github"`，
已写入仓库配置，`/workspace/push-to-github.sh` 的 SSH 分支也会兜底设置。

**推送结果**：
- `feature/duolingo-style-ui` → 新分支推送成功，**36 个提交**（HEAD `c110ac9`），含 UI 明亮化全量、
  信息处理中心、桌面封装修复、PWA 化、多 LLM provider 基建
- `main` 本地无独有提交（此前那 9 个已由 PR #1 合入远端），已 `branch -f main origin/main` 对齐到 `129e721`
- `origin` 已切到 SSH URL；HTTPS 通道的只读凭据（IDE 助手 token = metadata:read）不再用于推送
- 远端现存分支：`main` / `feature/duolingo-style-ui` / `fix/memory-order-and-version-docs`

**遗留**：feature 尚未合并回 main（产品决策，见 PR 链接）。标签 v1.0 本地前移、远端停在旧值，未强推。

### 2026-10-19 · WorkBuddy · 多 LLM provider + 场景分级路由 + 故障降级（6.1 #2/#3/#6），182/182 绿

沿用「先把页面做完」之后的基建推进。用户一句「继续」，取 HANDOVER 6.1 里剩余且能独立交付的一条链：
多 provider（#2）+ 分级路由（#3）+ 降级重试（#6）。动机是现实的——DeepSeek Key 待轮换，单点故障风险摆在那。

**抽象层重构**：`DeepSeekLlmClient` 的 430 行里只有「模型名 / Key / 超时」是 DeepSeek 特有的，其余
（请求构造、流式解析、超时看门狗、token 埋点）对所有 OpenAI 兼容服务都通用。上提为
`AbstractOpenAiLlmClient`，DeepSeek 退化为薄子类，行为不变（171 个既有测试原地保护）。

**新增**：
- `OpenAiCompatibleLlmClient` + `LlmProviderConfig`：智谱 GLM / 通义 / 豆包 / Moonshot / 自建网关
  都是同一套 chat/completions，填配置即可挂载，**不需要为每家写一个类**
- `app.llm.providers.<id>` / `routes.<SCENE>` / `fallback`：默认全空，行为与 V1.0 完全等价
- `FallbackLlmClient`：主 provider 失败按顺序切备用各试一次

**两条自己立的约束**（写进测试钉住）：
1. **流式一旦吐过正文就不再切换 provider**——否则用户会看到两份内容拼在一起。宁可失败
2. **499（客户端已断开）不重试**——用户都走了，重试纯属浪费上游配额

**踩坑**：registry 构造新增 `ObjectMapper` / `LlmUsageRecorder` 依赖后，12 个测试容器起不来
（`NoSuchBeanDefinitionException: LlmUsageRecorder`）——精简测试上下文没有 `LlmUsageMapper`。
改为 `ObjectProvider` 按需获取：没配 provider 的上下文根本不会去取这两个 bean。

**验收**：182/182 全绿（171 原有 + 11 新增 `LlmRoutingTest`）；standalone jar 重启后
`/` 200、`/api/health` 401（鉴权正常）。提交 `144295c` + `db8c9b3`。

**未做（明确边界）**：provider 目前只能靠配置文件/环境变量添加，**界面里还不能填**。
桌面单机版用户不会去改 yml，所以这只能算「服务端部署可用」。要补界面配置需要连带决定
Key 存哪（复用 `LocalSettings` + `app.security.allow-local-ai-key-settings` 开关），留给下一轮。

### 2026-10-19 · WorkBuddy · PWA 化：可安装 Web App（manifest + SW + 安装提示），含 manifest MIME 坑

**背景**：用户要求「做成 webapp」。落地为 PWA（渐进增强，不动任何业务逻辑）：

- `public/manifest.json`：standalone / theme #58CC02 / 三尺寸图标（含 maskable 安全区版 + apple-touch + favicon）
- `public/sw.js`：静态资源 stale-while-revalidate（秒开 + 后台更新）、导航 network-first 失败回退缓存 index.html（`/info` 等深链离线可开）、`/api` 一律走网络**不伪造数据**、activate 清旧版本缓存（升级靠 bump `CACHE` 常量）
- `PwaInstallPrompt`：拦截 `beforeinstallprompt` 统一走应用内安装卡（b 风格 3D 按钮），iOS 无该事件改文字指引，dismiss 记 7 天、standalone 模式不出现；刻意不做自动弹窗
- `main.tsx` 仅生产注册 SW；`index.html` 补 manifest/theme-color/apple meta

**踩坑记录（续写前必读）**：
1. **manifest 必须用 `.json` 扩展名**。`.webmanifest` 在 Spring Boot 3.2 静态托管下返回 `application/octet-stream`——`MediaTypeFactory` 不认识该扩展且显式设置了 octet-stream，`server.tomcat.mime-mappings` 与 `spring.web.resources.media-types` 两条配置通道都无效（前者被 Spring 显式 content-type 绕过，后者对默认静态处理器不生效）。Chrome 严格校验 manifest MIME，octet-stream 直接拒绝安装。改 `manifest.json` 后全链路零配置返回 `application/json`（nginx 等所有服务器同理适用）。
2. **jar 不同步 = 白改**：sync 脚本更新 static 后**必须重新 `mvnw clean package -Pstandalone`**（且必须带 `clean`——不带会残留旧 hash chunk，jar 里出现双份 assets）。
3. `pkill -f` 与 `java -jar` 写进同一条复合命令会自杀（shell cmdline 含 jar 名被自己匹配），杀进程和启动必须分成两条命令。

**验证**（standalone jar 17817 + Playwright）：SW activated/scope 正确；manifest application/json 全字段；壳资源全入缓存；**离线 reload 后 root 正常渲染**，应用诚实展示「设备连接-暂时无法连接」+ 重试按钮（离线无法验证设备会话，不伪造界面），无 Chrome 恐龙页、无 JS 崩溃。tsc/lint/build 全过。

### 2026-10-18 · WorkBuddy · 桌面封装链路修复（既有 C# 壳 + jar 托管前端）+ 撤销重复 Electron 壳

**背景**：用户要求「跑在本地看看，封装到桌面」。排查发现项目 baseline 里**早已有完整的 Windows 桌面壳**（`src/desktop/`：.NET Framework 4.8 + WebView2，577 行 Program.cs + 157 行 DesktopSecurity.cs，DPAPI 账号、Job Object 回收、端口所有权校验、`build-desktop.ps1` 锁版本流水线 + 隔离冒烟 + 发布清单）。曾新建 Electron 壳，识别出重复造轮子后**已删除**，路线改回既有 C# 壳。

**核心发现与修复（提交 `d0c5537` + `6dc9db9`）**：既有 `build-desktop.ps1` 流水线**漏了把前端 dist 同步进后端 static**——它跑 `npm run build` 产出 dist，但 `mvnw verify` 打出的 jar 里没有 `static/index.html`，壳打开 `http://127.0.0.1:17817/` 只会得到空白页。即：**桌面包此前是不可用状态**。修复三件套：

- `SpaErrorViewResolver`（新）：GET 且非 `/api` 的 404 转发 `index.html`，`/info`、`/todos` 等前端路由直接可达；`/api` 的 404 保持 JSON 不误导前端错误处理
- `scripts/sync-frontend-dist.mjs`（新）：dist → `resources/static`，先清空再拷（防删掉的前端 chunk 残留被缓存咬住）；`build-desktop.ps1` 在 npm build 与 mvnw verify 之间插入该步骤
- static 预构建产物入库：clone 后直接 `mvnw package -Pstandalone` 即得完整 Web 服务

**沙箱验收**：standalone jar 重启后 `/`、`/info`、`/assets/*.js` 均 200、`/api/*` 401 鉴权原样；后端 **171/171** 全绿（24 个测试类，surefire 汇总实证）。

**用户本机构建**（版本不匹配会被脚本拒绝，详见 `src/desktop/README.md`）：需 Microsoft OpenJDK **21.0.7**（vendor 校验）+ Node 22.23.2 + npm 10.9.8 + .NET Framework 4.8 + WebView2 Runtime；开发包 `.\build-desktop.ps1 -AllowEvergreenRuntime` → `src\desktop\app-image\TangentTimetable\` 双击 `TangentTimetable.exe`。数据落 `%LOCALAPPDATA%\TangentTimetable`。**Shell 编译与冒烟只能在 Windows 验证**（WebView2/DPAPI/Win32），沙箱侧能验证的 jar 托管部分已全绿。

### 2026-10-18 · WorkBuddy · 信息处理中心落地（`/info`，两处边界适配已向用户说明）+ 端到端截图验收

**背景**：用户发来《AI校园助手 · 信息处理页产品与UI设计方案》：新增「信息处理中心」二级页——左侧「信息收纳盒」（超大拖拽上传卡 + 快捷粘贴解析）、右侧「AI 主动查询中心」（四分类 + 一键获取最新动态 + 订阅）、底部「最近解析」预览栏，要求全链路联动首页今日必做/待阅/专业速览与三级提醒。

**落地内容**（提交 `39c419f` 后端 + `e57ab26` 前端，分支 `feature/duolingo-style-ui`）：

- **后端**：`POST /api/ai/query-plan`（四分类结构化查询计划，prompt 模板 `resources/prompts/query-plan.md` version 1，`LlmUsage.SCENE_QUERY` 计量，模板缺失/未配置降级为空计划 + note 不阻断页面）；`GET /api/notices/recent?limit=5`（全状态按创建时间倒序，`Math.max(1,Math.min(20,limit))` 夹取 + MyBatis `.last("LIMIT " + n)`）。
- **前端**：`InfoHubPage`（1.35fr/1fr 双栏网格、960px 退单列、顶栏返回/标题/`navigator.storage.estimate` 容量 pill/设置入口、底部 5 卡状态 pill：DONE 绿勾「已加入日程」/IGNORED/PENDING）；`InfoDropZone`（719 行：clamp(240px,30vh,380px) 薄荷绿虚线拖拽卡 + 拖入实色吸附高亮、截图→`aiApi.parseImageText`、PDF/DOCX→`extractImportFileText` 客户端本地提取、文本直读；Enter 解析带 isComposing 保护；NoticeDraftModal 人工核对；三动作加入日程/查看详情/忽略）；`InfoQueryPanel`（895 行：四分类 pill tabs、查询计划时间线可按锚点日 DatePicker 推算各阶段日期并「同步到待办」Promise.allSettled 部分成功处理、历史 8 条去重置顶、订阅存 `timetable.querySubs.v1` 防重复）。`App.tsx` 加 `/info` 路由、`AppLayout` 侧栏加入口。

**⚠️ 两处设计稿与项目红线的边界适配（后续续写前必读，详见 3.9）**：

1. **「AI 自动检索官方渠道并生成最新动态」未实现为自动抓取**——触碰登记禁区「自动爬学校系统」。落地为**结构化查询计划**：AI 只整理「去哪查/查什么/各阶段节点怎么排」（channels/watchouts/phases+leadDays），具体动态由用户按官方渠道当期公告自查；UI 显著标注「本中心不抓取教务系统、不监听群聊」「非实时检索结果」。
2. **「所有上传文件仅保存在本地浏览器缓存」部分成立**——文本类文件（PDF/DOCX/TXT/MD/CSV/JS/HTML）确实纯客户端本地提取；但截图 OCR 走服务器瞬态转发（不落盘）；解析产生的 notice 元数据落设备工作区。已把拖拽卡误导文案「自动存入本地并解析」改为「自动读取并解析」。
3. **「订阅更新」诚实化**：仅本地收藏查询条件 + 一键重新生成计划，无后台匹配推送（已去除「会提醒你回这里看」类表述）。

**验收**：tsc 0 error、lint 0 error（9 个既有 react-refresh warning）、build ✓、device-session 8/8、后端 171/171 + 新 jar 以 `-Pstandalone` 重建（h2 驱动在默认 profile 是 test 作用域，漏 profile 会启动失败）后两端点 401 鉴权正常。**Playwright 端到端截图**（预置 `timetable.onboarded=1` 绕过引导守卫）确认三区渲染：拖拽卡/查询面板/最近解析栏/侧栏入口均在，无控制台错误（仅存量 antd `destroyOnClose` 弃用提示）。

### 2026-10-18 · WorkBuddy · UI 换皮全部完成（32 个页面/组件全量明亮化，分支累计 13 提交）

**背景**：用户指令「先把页面做完再推送」。

- **第二批 3 子代理并行完成 12 文件**（设备手册组：DeviceConnectionPage/UserManualPage/WidgetPreviewPage；导入弹窗组：ScheduleCreateModal/ImportHtmlModal/QuickImportWidget/ExamManagerModal；任务通知组：TaskDraftModal/NoticeInboxPanel/NoticeDraftModal/MemoryManager/DashboardModuleSettings），+1515 行，按三分组提交。全量验收：tsc PASS、lint 0 error（9 个 warning 全是既有 react-refresh 提示）、build ✓、device-session 8/8。grep 验证零硬编码色值（剩余白字均为彩色面 on-color 前景）。
- **自查揪出两个漏网并补齐**：① **OnboardingPage**（首次启动引导页，两批都漏了，还在用裸 antd）——改 b-hero 渐变欢迎卡 + 局部作用域把 antd Card 换成白底大圆角柔影 + 功能图标按语义着色 + 步骤序号 Tag 改 3D 圆形徽章 + 操作按钮改 b-btn-3d（新增 flat 次级变体）；② **RecurringFormModal**（循环任务规则弹窗，同样漏了）——模态 content 大圆角 + sh3 柔影、头/footer 分隔线、预览/校验告警蓝/红软色、单选组选中态立体按压、脚本编辑器浅底凹陷槽 + code 标签软底。**两者正文文字均一字未改，逻辑零改动**。
- **至此 `components/` + `pages/` 全部 32 个 tsx 文件完成明亮化**（AppLayout 为壳层、样式在 index.css；RewardsBadge/RewardFloat 即奖励组件本身）。视觉原则贯穿全程：颜色全走 CSS 变量（暗色兼容）、antd 样式冲突一律局部作用域 `<style>` 解决、四层光影体系不混用。

**遗留**：① GitHub 推送仍待用户权限操作（见下一条目）；② DeepSeek Key 轮换仍待用户执行。

### 2026-10-18 · WorkBuddy · UI 明亮化改版（分支 feature/duolingo-style-ui）+ GitHub 推送凭据链完全定位

**背景**：用户喜欢多邻国 UI，原话「风格类似、不用闯关形式（抄袭太明显）、光影效果要注意、可以加奖励机制、搭好框架直接开始做」。

**概念稿先行**（`/workspace/duolingo-style-demo.html`，单文件可交互）：第一版做了闯关路径，被否（结构抄袭明显）；第二版改为常规信息架构（问候顶栏 + 渐变概览卡 + 课程/待办列表 + AI 入口），只保留视觉语言。用户确认后落地。

**框架落地（分支 `feature/duolingo-style-ui`，7 个提交，均在本地未推）**：

1. `styles/bright.css`：明亮设计系统。色板（绿 #58CC02 主色 + 蓝/黄/红/紫 + 浅底深字配对）、**四层光影 token**（--b-sh1 微浮起 / --b-sh2 卡片双层柔影 / --b-sh3 弹层 / 彩色面「上高光+下厚度」双 inset / --b-groove 凹陷槽）、3D 按钮（:active 下沉 3px）、.b-pill 药丸、.b-hero 渐变卡。**暗色模式全套降饱和适配**（`[data-theme='dark']` 作用域重定义）。
2. `theme.tsx`：亮色 AntD token 换绿主色 + 白底 + 圆角 14 + Nunito 圆体；`index.css` 同步换 CSS 变量与 body 字体。
3. `store/RewardsContext.tsx`：轻量奖励机制。完成待办 +15 / 任务 +20 / AI 对话 +5 / 打卡 +10，**每日上限 100 防刷**；streak 按「当天首次有收获 + 昨天也有」延续；6 级等级（新生→传奇）+ 7 个成就；localStorage 持久化（key `timetable.rewards.v1`），**只加分不扣分**（无生命值惩罚）。顶栏徽章（🔥/⭐ 弹跳反馈）+ 完成浮字（RewardFloat）。
4. 页面接入：Dashboard 渐变概览卡（复用既有数据源）；TodosPage toggle 挂钩 `earn('todo')`。
5. **4 个子代理并行换皮**（文件级隔离、禁 git、禁改 bright.css 等核心文件）：课表组 / 待办组 / 统计设置组 / AI 组共 16 文件，+1006 行。验收：tsc PASS、lint 0 error、build ✓、device-session 测试 8/8。代理遵守约束良好（grep 验证零硬编码色值、核心文件零改动）。

**GitHub 推送凭据链完全定位（重要，已排除所有技术疑点）**：

- 用户提供了两个 fine-grained PAT。**关键教训：fine-grained PAT 的仓库级 Administration 不隐含 Contents: Read and write**——token2 的 API 显示 `admin/push=true`（误导性），但 `POST /git/blobs` 与 git push（Basic auth）均 403。git 推送需要 Contents 写权限，与 Administration 是两套权限。
- 仓库 `2552555/timetable-ai` **确实存在且为私有**（token1 未授权时 API 404 + git 403 "Write access not granted" 的组合可区分「不存在」与「无权限」）。
- 沙箱网络对 github.com 有单 IP 故障：DNS 主 IP 20.205.243.166 不通，备用 IP（140.82.112.3 等）时通时断；**`api.github.com` 与 SSH 22 端口始终稳定**。git HTTPS 还需 `-c http.version=HTTP/1.1`（HTTP/2 多路复用不通）+ hosts 固定可用 IP（已写 `/etc/hosts` 与 `~/.user_hosts` 持久化）。
- SSH 方案已备好：沙箱密钥 `/root/.ssh/id_ed25519_github.pub`（`POST /user/keys` 需账户级 "Git SSH keys" 权限，token 未授）。
- **待用户一步操作**：编辑 token 勾选 Contents: Read and write（+ 可选 Git SSH keys: Read and write），或手动把上述公钥加到 github.com/settings/keys。完成后 `git push` 立即可执行（本地已积压 main 9 + 本分支 7 个提交）。

**2026-10-18 晚复核（凭据链终态）**：① 用户此前提供的**两个 PAT 均已失效**（API 401 Bad credentials，需重新签发）；② IDE 凭据助手自带的 token 经响应头 `x-accepted-github-permissions: metadata=read` 证实是**只有元数据读权限的 fine-grained token**——API 返回的 `push/admin=true` 是**用户本人对该仓库的权限**而非 token 权限（与 token2 同一个陷阱，这是 403 的最终根因）；③ SSH 通道就绪度确认：密钥 `/root/.ssh/id_ed25519_github` 存在、22 端口连通、服务器正确返回 `Permission denied (publickey)`（即只差注册公钥）。`/workspace/push-to-github.sh` 已重写为**双分支（main 9 + feature 14 个提交）+ 双模式（`--ssh` / `GH_TOKEN`）**，含 token 有效性预检与密钥兜底扫描，用户完成任一步操作后一条命令即可推完。

**遗留**：① 推送待 token 权限；② 概念稿与落地的视觉对齐度待用户在 dev server 实测；③ DeepSeek Key 轮换仍待用户执行。

### 2026-10-18 · WorkBuddy · 收尾：GitHub 推送受阻确认 + 网盘同步产物刷新 + 同步通道防坑

**背景**：用户指令「全部做完并推送」。代码/测试/文档已收口（171/171，4 个提交），本段做两件事：① 穷尽一切手段完成 GitHub 推送；② 把网盘同步产物（git bundle + 源码 zip + 三份文档）刷新到最终 HEAD。

**GitHub 推送：确认被凭据阻断，无法自主完成**。已尝试并排除：环境变量 / profile / git config / credential helper（`gh auth status` 未登录，`git credential fill` 无票）；MCP 网关是 GitHub App 集成 token——`get_me` 能看到账号 `2552555`，但 `list_commits(2552555/timetable-ai)` 返回 404（私有不可见与已删除不可区分）、`create_repository` 403「integration 无权建仓」、账号下 5 个公开仓库的提交记录均与本项目无关；浏览器无 github.com 网络（HTML 超时），但 `api.github.com` 与 git smart HTTP 端点可达（401 = 有票就能推）。**结论：只差一个 `ghp_` / `github_pat_` 开头的 PAT，用户提供后 `git push origin main` 即可，CI 会自动跑**。已把 `/workspace/push-to-github.sh` 更新到当前状态（一条命令推送）。

**网盘同步通道的完整真相（本次最有价值的产出，已抽象进 3.7）**：

- **上传侧一直是真的成功**：17:21 两次 PUT（bundle / zip）返回的都是 HTTP 200 + 空 body——这就是 COS 的成功响应。重传后用响应头里的 `ETag` 与本地 md5 逐一核对：bundle `7b509d01…`、zip `2f5dd920…`，**服务端对象内容哈希与本地文件逐字节一致**，比下载回传更硬的验证。
- **下载侧出过两次故障，都报 `InvalidAccessKeyId`（542 字节 XML）**：10-16 的下载 URL 带完整 presign 但 AK 无效；10-17 晚间 `file_download` 签发的 URL **连 presign 签名参数都没有**（只有裸 token）。10-17 18:05 重新签发的 URL 恢复正常，下载 → md5 一致 → `git bundle verify` 通过（`# v2 git bundle`，`refs/heads/main` 完整）。
- **由此纠出一个此前的错误结论**：10-16 文档里「已验证：下载后 md5 一致」不成立——当时下载实际返回的就是 `InvalidAccessKeyId`。并因此**误删过一次已上传成功的 bundle 条目**（对象其实已在 COS）又重传。判据纠正：**看 PUT 的 ETag，不看下载**。
- 另确认：网盘根目录 ID `MTOwZfixfiEX`；`file_upload` 的凭证小概率签发即无效，重签即可。

**最终同步状态**：bundle 与 zip 均已刷新到**收尾提交后的 HEAD**（此前网盘版本停在 `5b02473`，少 2 个文档提交）；网盘上三份陈旧的 Markdown（交接总览 / HANDOVER / Git 同步指引，停留在 10-15/16 版本）已用当前版覆盖上传。`/workspace/Git同步操作指引.md` §7 清单同步更新。

**遗留**：① 推送仍缺 PAT（见 6.5）；② 用户的 DeepSeek Key 已明文出现在对话中，**建议用完后轮换**；③ 网盘 `file_download` 的 URL 格式不稳定（偶发缺签名参数），若再遇 `InvalidAccessKeyId`，先重签下载链接，别急着判定上传失败。

### 2026-10-18 · WorkBuddy · 首次真实端到端验收 + 修复「工作线程丢失身份」P0

**范围**：拿用户提供的真实 DeepSeek Key 做**第一次真实模型调用验收**（此前全部链路只跑过 mock），顺带把刚完成的 P0-2 预算熔断在真实链路上验证。

**真实验收跑通的链路**：建课表 → AI 流式对话（thinking/text/planning/done 事件分离干净；模型正确处理「下午 3-4 节」歧义并说明假设）→ 提案确认执行落库 → 通知提炼（keyTime 精确到 10-25 23:59）→ 每日计划（含 BREAK）→ 任务抽取（「下周一交」正确推算为 10-19）→ 课表 HTML 解析。

**真实调用暴露的两个静默缺陷（都是 mock 永远测不到的那类）**

1. **CHAT / REFINE 两个场景完全不计量**：真实调用 6 次只有 4 次入账，token 从应有的约 1.1 万缩到 4910。根因是场景参数没有透传到实际调用点。已修（随 `e8dbca4` 的场景透传落地），修复后 CHAT 4621 tokens、REFINE 1623 tokens 正确入账。
2. **流式对话的工作线程丢失调用方身份（P0，`e55b477`）**：`RequestContext` 是 ThreadLocal，`streamExecutor` 的工作线程里取不到拦截器设的 apiKey → 下游 `DeepSeekLlmClient` 读到 null → **用量记不进来 + 预算检查跳过，两个后果都是静默的**。这个缺陷用 mock 测不出来——被替换掉的正是读 ThreadLocal 的那段代码。

**P0-2 熔断真实验证通过**：把 CHAT 场景额度压到 ¥0.001 后，对话返回 `429 本月「对话」的 AI 预算已用完…其它功能不受影响`，而 INBOX 通知提炼与 PARSE_HTML 课表解析照常 200——两级额度的语义在真实链路上成立。

**修复方式与测试（本轮核心交付）**

| 文件 | 说明 |
|---|---|
| `interceptor/RequestContext.java` | 新增 `callWithApiKey(apiKey, task)`：带身份执行 + try/finally **恢复调用前状态**。线程复用下不清理会让下一个请求的花费记到本账号，比丢失更危险；异步派发一律走它 |
| `controller/AiController.java`（改） | 流式任务改用 `callWithApiKey`；隐患注释收敛到助手定义处 |
| `service/LlmUsageRecorder.java`、`service/LlmBudgetService.java`（改） | 身份为空时补 `log.warn`——**此前静默丢失，正是这次排查困难的根源** |
| `controller/AiStreamIdentityIntegrationTest.java` | 防回归（2 例）。关键技巧：让 mock **在被调用时主动读一次 `RequestContext`**，复现真实客户端行为。**已验证修复前失败（断言 `seen=null`）、修复后通过** |
| `interceptor/RequestContextTest.java` | 助手契约单测（5 例）：任务内可见、结束不残留、原身份恢复、异常也恢复、嵌套按栈恢复 |

**调试过程记录（供以后查同类问题）**：测试最初 2 例全超时，现象是「mock 从未被调用 + 无 error 日志 + `emitter.onError` 未触发」。根因是测试自己漏了 `when(provider.isConfigured()).thenReturn(true)`——`active()` 抛 503 `BusinessException`，而流式链路的这个分支只 `emit("error")` + `complete()`，不调 onError 也不打日志。**这个「三无」组合就是 BusinessException 早退的指纹**，已记进 3.7。

**验收**：后端全量回归 **171/171**（164 + 2 集成 + 5 单测）；前端本轮未动，基线不变。

**遗留**：① 本地提交未推送 GitHub（数量以 `git rev-list --count origin/main..main` 为准，缺 PAT，见 6.5）；② 用户的 DeepSeek Key 已明文出现在对话中，**建议用完后轮换**。

### 2026-10-17 · WorkBuddy · 成本治理 P0-2：月度预算 + 超限熔断

**范围**：月度预算上限 + 超限熔断。**不做**预算预警邮件/站内信、按用户分组的差异化额度（单用户模型下无意义）。

**三个关键决策**

1. **两级额度，语义不同**。场景额度（如 `CHAT`）超了**只熔断该场景**——对话超限不该让课表解析一起挂，后者更紧急且不可替代；全局额度才拦全部。把额度做成单一总闸是 P0-2 明确要避免的行为。
2. **默认不限制**。两项额度都不配时 `isEnabled()` 为 false，拦截整体跳过。默认打开熔断会让没配预算的人某天突然用不了 AI 且不知道为什么——要熔断必须显式配额度。
3. **拦截点放在 `LlmClientRegistry.active()` 的装饰器里**，不在 `DeepSeekLlmClient` 内部。换 provider 不用重做；且检查在 delegate 之前，超限请求一次 token 都不花。

**新增 / 改造**

| 文件 | 说明 |
|---|---|
| `config/LlmBudgetProperties.java` | `app.llm.budget.*`。Map key 在 setter 转大写（yml 写 `chat:` 而常量是 `CHAT`） |
| `service/LlmBudgetService.java` | 两级判定 + `spentThisMonth`。查花费失败时**放行**（宁可少拦一次，也不能因统计表异常让全部 AI 功能挂掉） |
| `service/BudgetAwareLlmClient.java` | 装饰器，身份从 `RequestContext` 取，场景透传给 delegate（否则埋点全落 UNKNOWN） |
| `service/LlmClientRegistry.java`（改） | `active()` 包装饰器；新增构造依赖 |
| `dto/UsageStatsDto.java` + `UsageStatsServiceImpl`（改） | 统计接口返回 `budget`（未配时为 null） |
| `application.yml`（改） | `app.llm.budget.*`，走环境变量，默认空 |
| `service/LlmBudgetGuardTest.java` | **13 个用例**：只拦该场景、全局拦截、跨月重置、账号隔离、空身份跳过、失败调用计入、装饰器「一次 token 都不花」 |
| 8 个测试切片（改） | registry 新增构造依赖 → 同步补 `@Import` 与 import（**这是本项目改 registry 的必备动作**） |
| `StatsPage.tsx` / `types/index.ts`（改） | 本月预算卡片：已用 / 额度 / 剩余 / 状态 + 分场景进度条 |

**验收**：后端 **164/164**（151 + 13 新增）；前端 typecheck / lint（0 错误 8 存量警告）/ build 全过。

### 2026-10-17 · WorkBuddy ·《AI 校园助手产品界面与功能细化方案》第二轮：启动引导页 + 模块自定义

**范围**：方案第一、二部分（启动引导页 / 使用指引页）+ 基础交互第 1 条（模块自定义排序显隐）。**纯前端，零后端改动**。

**新增（前端）**

| 文件 | 说明 |
|---|---|
| `pages/OnboardingPage.tsx` | 3 步引导（能帮你什么 / 怎么把信息给它 / 先让它认识你）。**第 2 步的「它不会做什么」卡片是这一页的核心**，明确写不会自动翻群聊邮箱、不会替你做决定、不提供天气食堂快递、不会「学会」偏好。产品最容易在这里过度承诺 |
| `hooks/useDashboardModules.ts` | 模块排序 / 显隐，localStorage `timetable.dashboard.modules`。读时清洗：丢不认识的 key + **补齐后加的模块** |
| `components/DashboardModuleSettings.tsx` | 自定义弹窗。用上下箭头而非拖拽（不为这一个弹窗引依赖库）；当前时段不可用的模块开关禁用并标注原因 |
| `pages/UserManualPage.tsx`（改） | 顶部加「再看一次功能说明」常驻入口 → `/onboarding`；AI 学长章节补 ⑥ 今日待阅、⑦ 分时 UI + 语音 |
| `App.tsx`（改） | `useOnboarded()` + `/onboarding` 路由。未看完引导页时**裸渲染**（不带侧栏浮球） |
| `pages/DashboardPage.tsx`（改） | 8 个模块改由 `renderModule` 按配置渲染；时段栏加「自定义」按钮 |

**一个刻意的设计取舍**：模块自定义**只让用户关，不让用户强行开**。分时段可用性（`periods`）是产品行为不给改——午间把「今日必做」收缩成小条是分时 UI 的核心，让用户强行打开只会把页面撑成长条。设置弹窗里这类模块开关禁用 + 标注「仅早间、晚间」，避免用户对着勾了也不生效的开关困惑。

**踩坑**：按行号脚本往 `DashboardPage` 插 `renderModule`，定位用了 `<Row>` 那一行 → 函数被插进 JSX 内部，报 `TS1382: Unexpected token. Did you mean {'>'}?`。已记进 3.7。

**验收**：后端 **151/151** 全绿（本轮未改后端，确认基线未漂移）；前端 typecheck 通过、lint **0 错误 / 8 警告**（全存量基线，未新增）、build 通过。

### 2026-10-16 · WorkBuddy ·《AI 校园助手产品界面与功能细化方案》第一轮

**前置：范围裁定。** 方案里有四块踩既有红线或技术上不成立，**明确不做**（已写进第 6 节防回潮）：自动抓取 QQ/微信群/教务系统/校园邮箱、自学习推荐算法（点赞忽略收藏训练权重）、全国高校知识库、顶刊/校招等外部数据源。天气/食堂拥挤度/快递取件/教室导航同样不做——没有可靠数据源。「今日专业速览」行业新闻板块和「决策辅助（AI 版的我）」不做新增（后者现有档案 + 长期记忆已在承担）。

**三项已拍板的设计决策**（用户未在选项中确认，按调研结论取推荐项）：

1. **三级提醒走纯前端**。项目零通知基建，后端定时 + 轮询要新增表/实体/端点/轮询逻辑，工作量翻倍且最终仍需页面常开才能弹窗。阈值写成 `REMINDER_LEADS` 可配置常量，将来接后端推送时不用重写。**代价已在 UI 上明说：关掉页面不提醒。**
2. **今日必做的优先级以客观截止为准**。方案把「截止紧迫度」和「用户设的 priority」混在一起了。本项目的判断是：核心诉求是「怕漏事」，客观截止时间应压过主观设定——已逾期/今天截止强制置顶，卡片标注「临近截止自动置顶」避免用户误以为改了他的设置。
3. **配色走保守方案**。方案要求三套色板，但项目是双轨并行硬编码，加第三套会让 antd 组件与自定义 class 逐层脱节。实际上只做了**局部氛围**：`.dashboard-page[data-period]` 作用域内覆盖 `--accent` + 页面 tint，不动主题、不覆盖用户手动选的亮/暗模式。

**新增（后端）**

| 内容 | 说明 |
|---|---|
| `V6__notice_inbox.sql`（h2 + mysql） | `notice_card` 表。**原始材料不落库**，只存 AI 提炼后的卡片 |
| `NoticeCard` / `NoticeCardMapper` | 实体 + 空 BaseMapper |
| `notice-extract.md`（v1) | 新 prompt。明确要求模型「只做提炼不做决策」，且看不出专业/年级时 relevance 一律填 2 不准填 1 |
| `LlmUsage.SCENE_INBOX` | 新埋点场景，与 EXTRACT 分开统计 |
| `NoticeService` / `NoticeServiceImpl` | extract（草稿不落库）/ create / listToday / toTask / ignore / snooze / remove |
| `NoticeController` | 7 个端点，全部不写鉴权代码 |
| `NoticeEndpointIntegrationTest` | **9 个用例**，含跨账号 404、V6 迁移列完整性、降权排序与样本量下限 |

**新增 / 改造（前端）**

- `NoticeInboxPanel.tsx`：卡片 + 加入日程 / 忽略 / 稍后提醒 / 一键了解详情。「了解详情」复用 QuickImportWidget 的 `navigate('/ai', { state: { quickImport } })` 通道，**只填输入框不自动发送**。
- `NoticeDraftModal.tsx`：草稿确认弹窗，标题可改、默认全选。
- `QuickImportWidget.tsx`：加「存为待阅通知」出口；浮球改 `FloatButton.Group` 双按钮（导入 / AI 助手）。
- `DashboardPage.tsx`：早/午/晚三档内容权重，**同一份数据不因换时段重新拉取**。晚间额外拉一次明日数据（规则聚合不烧 token，且用 ref 防 60s 定时器重复触发）。
- `VoiceAssistantContext.tsx`：全局语音新增待办，Provider 挂在路由外层（避免在会重挂载的组件上录音被 abort）。
- `useReminders.ts`：三级提醒 hook。
- `utils/schedule.ts` 加 `timeOfDay`；`utils/task.ts` 加 `groupTasksByUrgency` / `isAutoEscalated`。

**验收**：后端 **151/151** 全绿；前端 typecheck 通过、lint **0 错误 / 8 警告**（7 个存量基线 + 1 个新增的 `react-refresh` 提示）、build 通过。

### 2026-10-16 · WorkBuddy · 成本治理 P0-1：LLM 埋点 + token 计量 + 用量看板

**范围**：只做「埋点 + token 计量」，**不做**预算上限与超限熔断（留 P0-2）。提案确认率的口径选择**加 `decided_at` 补齐数据**（接受改既有表），成本估算用**内置可配置单价表**。

**新增**

| 层 | 内容 |
|---|---|
| 迁移 | `db/migration/{h2,mysql}/V5__usage_and_events.sql`：`llm_usage`、`ai_event`、`ai_action.decided_at`（可空） |
| 实体/Mapper | `LlmUsage`（7 个 `SCENE_*` 常量）、`AiEvent`（`TYPE_PROPOSAL_CONFIRMED` / `_REJECTED`）、两个空 `BaseMapper` |
| 埋点 | `LlmUsageRecorder`、`AiEventRecorder`——**异常全部吞掉记日志**，埋点是旁路观测，抛异常会把正常 AI 响应搞挂 |
| 成本 | `LlmPricingProperties`（`app.llm.pricing`）。做成配置而非硬编码：价格会过期，硬编码会静默给出错误金额 |
| 统计 | `UsageStatsService(Impl)` + `UsageStatsController`：`GET /api/stats/usage?days=`、`GET /api/stats/proposals`。**不接受前端传 key**，身份走拦截器 |
| 前端 | `pages/StatsPage.tsx`（路由 `/stats`，侧栏「用量统计」）、`types` 加 4 个类型、`api` 加 `statsApi`。**不引图表库**，每日趋势用 div 柱状 |
| 测试 | `UsageStatsIntegrationTest` 8 个用例（401 / 聚合与成本精确值 / 账号隔离 / 窗口夹取 / 提案漏斗 / 空数据返 null / 迁移列存在性） |

**改动**

- `LlmClient` 加带 `scene` 的 `chatJson` / `chatJsonStream` 重载，旧签名保留为 `default` 方法 → 实现类零改动（**但 mock 侧要改，见 3.7**）。
- `DeepSeekLlmClient`：流式分支补 `stream_options.include_usage`——**不开这个开关，流式调用（聊天主力路径）拿不到 usage，统计会漏掉大头**；usage 在最后一个 chunk 返回（此时 `choices` 为空数组）。成功/失败都记（token 已花掉是真实成本）。
- 8 处业务调用标注场景：`AiServiceImpl` 7 处 + `DailyPlanServiceImpl` 1 处。
- `decided_at` 写入时机：`executeAction` 在 `applyAction` **成功之后**（失败整体回滚，不会留下「执行失败却已确认」的假记录）；`rejectAction` 并进同一条 CAS（不可能出现「状态变了但决定时间没写」的中间态）。

**验收**：后端 **142/142** 全绿；前端 typecheck 通过、lint 0 错误 / 7 警告（全是存量基线）、build 通过。

**两个被测试抓出来的真实 bug**（不是测试写错）：浮点金额尾巴（已 `roundMoney()`）、毫秒→秒换算重复除 10（耗时差 10 倍）。详见 3.7。

**口径提醒（写文档时别丢掉）**：`/api/stats/proposals` 的确认率是**已落库口径**。展示态 STALE 只读复核不落库，所以纯 SQL 统计会**系统性低估**失效量——看板上的确认率是上界，真实值只会更低。页面里已用 Tooltip 说明。

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

**⑤ 推送完成（2026-10-16 03:58）**：

| 项 | 值 |
|---|---|
| 仓库 | `2552555/timetable-ai`（**私有**），默认分支 `main`，标签 `v1.0` |
| 提交 | 21个，远端与本地逐个一致（README / AGENTS / HANDOVER / ci.yml / LICENSE 字节数全部吻合） |
| **CI 首跑** | ✅ **backend success + frontend success**——这是 `ci.yml` 建立以来的第一次真实运行，改名前因分支叫 `master` 而 `on.push.branches: [main]` 从不匹配，CI 一直是空转 |

**过程中的两个坑**：`gh repo create --no-init` 在当前 gh 版本不支持（改用 `POST /user/repos` API 建仓）；`git push` 标签时 GitHub 443 端口超时，改用 `POST /git/refs` API 直接建 tag 成功。

### 2026-10-16 · WorkBuddy · 复验基线发现 1 个日期翻篇失败 + 部署版核对 + git bundle 同步通道

**触发**：另一环境（Codex）报告「本地/备份/远端优化分支均为 `9bb3200`、远端查 `7612bbe` 未找到、`docs/HANDOVER.md` 未找到 → 134/134 未复验、本机 REA 缺运行文件」。逐项处理如下。

**① 134/134 实际不成立（已修）**：本沙箱跑全量测试，`TaskEndpointIntegrationTest.extractThenConfirmCreatesTasksWithAiParseSource` **1 个失败**（133/134）。根因是**又一处日期硬编码**：服务端 `AiServiceImpl.parseExtractedDeadline` 的设计就是「过去的截止时间一律清洗为 null」，而测试写死 `2026-10-15`，今天 `2026-10-16` 一起床断言必然挂。**产品行为正确，测试缺陷**。改为 `LocalDate.now().plusDays(7)`（输入文本同步改成相对日期），已单独跑该类 5/5、全量 **134/134 BUILD SUCCESS**。提交 `7b7ad63`。教训已补进 3.7。

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
- **测试踩坑 2 个**（都已修复，见第 3.7 节）：
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
| 1 | **补用户行为埋点** | ✅ **P0-1 已完成提案确认/拒绝埋点**（`ai_event` + `decided_at` + `/api/stats/proposals`）。**仍缺**：计划采纳率（生成后 24h 内完成或调整占比）/ 7 日留存 / 计划采纳率口径（`daily_plan` 没有决定时刻字段，要先补数据） |
| 2 | **多 LLM provider 注册** | ✅ **已完成**。后端 `OpenAiCompatibleLlmClient` + `app.llm.providers.<id>`（抽象层抽为 `AbstractOpenAiLlmClient`）；**界面配置也已完成**——设置页「AI 服务提供方」卡片可增删改，支持智谱/通义/豆包/Kimi 预设，Key 加密落盘，保存后**热生效不需重启**（见 3.11） |
| 3 | **按任务分级路由** | ✅ **已完成**（`app.llm.routes.<SCENE>=<providerId>`，7 处调用点改 `forScene(SCENE_*)`）。**下一步**：等真有第二个 provider 上线，按实测单价把 EXTRACT/OCR 这类轻活切过去；2026 年国产模型价格：DeepSeek-V4-Lite 0.1/0.2 元每百万 token、GLM-4-Flash 免费、V4-Pro 1.0/2.0（缓存命中 0.025） |
| 4 | **Prompt Caching** | 系统提示词 + 学生画像这类稳定前缀打 cache 标记，输入成本可降 80–90% |
| 5 | **token 计量与预算** | ✅ **P0-1 + P0-2 均已完成**（`llm_usage` + `/api/stats/usage` + 统计页用量与预算卡片 + `LlmBudgetService` 两级额度熔断，详见 3.8）。**默认不限制**，要熔断必须显式配 `app.llm.budget.*` |
| 6 | **降级与重试** | ✅ **已完成**。两半都齐了：(a) provider 故障切备用（`FallbackLlmClient` + `app.llm.fallback`，流式吐过正文不切换、499 不重试）；(b) **计划生成失败重试退避**（`app.llm.plan-retry.*`，只重试 502/503/504，指数退避 + 抖动，`enabled=false` 可回滚）+ **同账号同日并发去重**（见 3.3） |

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
| — | ~~**推送本地全部提交到 GitHub**~~ | ✅ **已完成**（2026-10-19）。SSH 公钥注册生效，`feature/duolingo-style-ui` 36 个提交全部上远端（HEAD `c110ac9`），`main` 已对齐 `129e721`。**遗留**：feature 合并回 main 的 PR 未建；标签 v1.0 未强推。注意 git 的 ssh 不认非默认命名密钥，`core.sshCommand` 已配置 |
| — | **轮换 DeepSeek API Key** | 该 Key 已在本轮对话中明文出现。验收已完成，建议用户在 DeepSeek 控制台作废旧 Key 换新，避免泄露风险 |

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

### 6.7 明确不做的事（防回潮，改动前先读这一节）

以下项目**已被否决过**，不要在后续迭代中重新引入——它们要么踩合规红线，要么技术上不成立：

| 类别 | 具体内容 | 原因 |
|---|---|---|
| 自动抓取 | QQ/微信群消息监听、教务系统绑定、校园邮箱同步 | 等价于爬虫 + 浏览器插件，用户明令禁止 |
| 自学习推荐 | 点赞/忽略/收藏训练权重、用户画像自动更新、协同过滤 | 推荐算法，用户明令禁止。降权走**显式规则**（见 3.6） |
| 外部知识库 | 全国高校知识库、保研政策库、选课指南库 | 用户明令禁止 |
| 外部数据源 | 顶刊论文摘要、国际顶会、导师课题、图书馆新书、历年真题、校招薪资 | 需要实时外部数据源，单靠 LLM API 拿不到 |
| 第三方接口 | 天气、食堂拥挤度、快递取件、教室导航 | 无可靠数据源；食堂拥挤度与快递取件没有公开的个人化 API |
| 行业新闻 | 「今日专业速览」板块 | 同上，依赖外部数据源 |
| 桌面/浏览器端 | 浏览器插件、桌面助手 | 用户明令禁止 |

**能做的替代**：信息入口用**手动喂入**（转发/粘贴/截图）替代自动抓取；个性化用**档案 + 长期记忆**（用户显式告知）替代自学习画像。这两条已经落地，见 3.6。

---

## 7. 给 Codex 接手提示

- 开工前先跑到 `docs/HANDOVER.md` 第 2 节看当前基线（现在是 **171/171**），跑一次 `cd src/backend && ./mvnw -B test -o` 确认，再动手——避免把别人引入的问题算到自己头上。
- **沙箱 Node 环境**：系统默认 `node` 是 **v22.13.1**（前端 typecheck/lint/build 均已验证通过）；另装了 nvm **v24.22.0**，需 `source ~/.nvm/nvm.sh && nvm use 24` 才能用（非交互 shell 里 `nvm` 不可直接调用）。**本项目代码两个版本都能构建**，不必主动切换；只有跑外部工具 REA 时才需要 ≥22.19。
- 本项目**不重写**：所有改动走模块化增量，保留课表/待办/循环规则的既有行为。
- 新增 AI action 类型时，必须同步 4 处：`splitToSingleActions` 的 recordField、`isValidProposal` 的 switch、`applyAction` 的执行分支、前端 `AiActionCard` 的渲染。少一处就会出现「提案被静默丢弃」这类难查的 bug。
- 涉及数据库结构：h2 与 mysql 两套迁移都要改，并补迁移测试。
- 每次收工请在本文件第 5 节追加一条会话日志，并更新第 2 节的状态快照。
- **刷新网盘同步产物时**（zip / bundle / 文档，根目录 `MTOwZfixfiEX`）：`git bundle create` 与 `git archive` 必须在**所有收尾提交之后**执行，否则网盘版本会缺提交（这次就差点漏了 2 个文档提交）；PUT 用「`file_upload` 返回 JSON 写文件 → Python 解析 → subprocess 调 curl」范式，一个字符都不要经手；**验证看响应的 `ETag` 是否等于本地 md5**，不要用下载能否成功来判定上传成败（下载通道自己出过故障，见 3.7）。流程与清单维护见 `/workspace/Git同步操作指引.md`。
- **下一步方向不要自己拍脑袋**：`/workspace/下一步方向调研报告.md` 已给出四阶段路线与理由（先降本 → 再升智 → 再扩入口 → 最后 Agent 化），第 6 节是其落地拆解。若要调整路线，先读该报告第 8.1 节的顺序论证。
- **新增 LLM provider 时**：实现 `LlmClient` 接口并在 `LlmClientRegistry` 注册，同时补 `LlmProperties` 的 providerId 说明；注意 `active()` 会先抛 503，`isConfigured()` 不是可达分支（见 3.7）。
