# Step 0 源码核对报告（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 输入：`Timetable-fix-complete-optimization-plan.zip`（694,226 B，277 文件）｜ 结论：**门禁通过，可开工**

## 1. 门禁结果

| 检查项 | 结果 |
|---|---|
| 前端构建（`npm ci && npm run build`） | ✅ 成功；产物 hash 与部署站**完全一致**（`index-Cm4yYtry.js` 132.75kB / `react-BNNNFgqh.js` 162.42kB / `antd-D3xlKeEY.js` 1226.78kB / `index-BP6lxbFV.css` 22.08kB） |
| 后端测试（`./mvnw -B test`） | ✅ **51 个测试全部通过**，BUILD SUCCESS；Flyway V1→V3 迁移在 H2 正常 |
| API 清单核对 | ✅ 28 个端点与黑盒分析 100% 命中 |
| 结论 | zip 即部署版最新源码，无差异 |

额外发现（懒加载 chunk，部署站首包不可见）：`pdf.worker.min`、`mammoth.browser`、`pdf`——前端已有客户端 PDF/DOCX 解析。

## 2. 源码结构

```
src/backend   Spring Boot 3.2.5 / Java 17 / MyBatis-Plus 3.5.6 / Flyway / Rhino(循环脚本沙箱) / H2+MySQL
src/frontend  React 18 + TS + Vite 5 + AntD 5 + react-router 6 + pdfjs-dist + mammoth
src/desktop   C# WebView2 外壳（Windows 桌面版）
src/android   Kotlin 原生离线版（不在 V1.0 范围）
```

## 3. 关键约定（来自 AGENTS.md，必须遵守）

- Controller → Service → ServiceImpl → Mapper 分层；**不用 Lombok**，手写构造器/getter/setter
- 业务异常 `BusinessException(code, message)`；归属校验在 Service 层
- 课程/考试属于课表；待办/循环规则属于账号（api_key）；作息全局
- **AI 提案-确认边界必须保留**（AGENTS.md 明文）
- 验证：后端 `./mvnw -B test`；前端 `npm run typecheck && npm run lint && npm run build`
- 已有表不由 CREATE TABLE IF NOT EXISTS 升级，结构变更必须走 Flyway 迁移
- 密钥/真实配置不提交；临时输出放 `work/`（已 gitignore）

## 4. 对原改造方案的修正（以源码事实为准）

| 原方案 | 修正后 | 依据 |
|---|---|---|
| 新表用 `user_id` | **改用 `api_key VARCHAR(64)` + FK→api_key ON DELETE CASCADE** | 现有全部账号级数据（schedule/todo/ai_conversation/recurring_todo）均以 api_key 为用户维度 |
| 自建 migrations runner + schema_migrations 表 | **直接用现有 Flyway**（`db/migration/{vendor}/V4__*.sql`，h2/mysql 双份） | 项目已有完整 Flyway 体系 + ValidatedFlywayMigration 旧库基线化策略 |
| 新建 PromptEngine 模板引擎 | **扩展现有 `AiPromptBuilder`**（静态方法加参）| 现有 system prompt 已是成熟 JSON 协议，人格作为新增段落注入 |
| 服务端 PDF 解析 | **前端已具备**（`utils/importFiles.ts`：PDF≤12页/DOCX/TXT/MD/CSV/ICS/HTML，客户端提取文本）| Step 4 改为复用现有提取 + 文本送 AI 抽取 |
| 新建 AIService 五方法从零抽象 | **泛化现有 `DeepSeekClient` 接口**为 provider 注册表（协议已是 OpenAI 兼容）| 现有 client 已有同步/流式/取消/超时/ watchdog，质量很高，只做 provider 化 |
| temperature 0.3 | 沿用现有 **0.2**（`DeepSeekClientImpl.buildBody` 硬编码，改为可配置）| 源码事实 |
| 提案执行器新建注册表 | **扩展 `AiServiceImpl.applyAction` switch** + 新 scope（TASK/PROFILE/MEMORY）| 现有 execute 链路（claim→指纹校验→apply→失效兄弟提案）直接复用 |
| 首页聚合新接口 | **参照 `WidgetServiceImpl.overview` 模式**扩展 `/api/dashboard` | 现有聚合逻辑（今日课程/待办/考试/倒计时）可复用 |
| Task/Todo 分离建表 | 维持，但迁移脚本按 MySQL/H2 语法差异分别处理（`CONCAT()` vs `\|\|`）| vendor 双迁移链 |

## 5. 现有 AI 能力清点（V1.0 复用基础）

- `AiPromptBuilder.buildChatSystemPrompt`：JSON 协议 + 15 种 action + 撤销(_before) + 数据权威性约束 + 上下文截断（40k 字符/节 7k）
- `AiServiceImpl`：提案拆分（一条 DB 操作一张卡片）、指纹失效、兄弟提案续接/失效、历史动作回放、非 JSON 降级
- `DeepSeekClient(Impl)`：SSE 流式（reasoning/content 分离）、取消传播、总/空闲超时 watchdog、4MB 响应上限、499/502/504 错误码
- `JsonTextStreamExtractor`：流式中增量提取 text 字段（前端先看到文字后看到提案）
- 前端 `AiChatPage` + `AiActionCard`：三阶段展示（思考→正文→提案卡片）、图片 OCR、语音输入

## 6. V1.0 缺口确认（源码级）

| 缺口 | 源码证据 |
|---|---|
| Student 档案 | 无 student 相关表/实体/接口 |
| Task 模块 | todo 表仅 title/ddl/completed；无 type/priority/status/source |
| 文件→任务抽取 | parse-html/parse-image 存在，但无"文本→任务草稿"管线 |
| Memory | 无 memory 表/实体 |
| 每日计划 | 无 |
| AIService 多模型 | DeepSeekClient 接口已抽象但绑定单一实现与配置 |
| 学长人格 | 现有 prompt 为功能型管理助手，无 persona/建议能力 |
| AI Dashboard | App.tsx `*` → Navigate /timetable；widget/overview 为小组件数据 |

## 7. 风险登记（实施期跟踪）

1. MySQL 与 H2 迁移语法差异（字符串拼接、布尔、ON UPDATE）→ 双份迁移 + H2 MySQL 模式测试覆盖
2. api_key 维度下"当前用户"= 设备密钥，档案/记忆/任务均按 api_key 隔离，多设备不共享（与现有一致，V2 再做账号同步）
3. 待办迁移后 /todos 与 Dashboard 双入口数据不一致风险 → /todos 加引导条，V1.0 内循环待办仍写 todo
4. AI 提案新 scope 的指纹失效逻辑需与 COURSE/TODO 对齐（TASK 类指纹基于 tasks 摘要）
