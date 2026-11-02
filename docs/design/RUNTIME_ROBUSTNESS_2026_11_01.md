# 运行时健壮性修正（2026-11-02）

本文件记录一次“风险清理”的技术决策。每条都标注了行业常用做法与未被采用的做法，便于后续评审。

## 背景

2026-11-01 曾出现“开发环境打开页面却被要求连接本机服务器”的问题。根因不是单点缺陷，而是运行模式判定分散、失败信息不可执行、缺少自动化护栏。此前的 Tier 0/1 修复了判定与提示；本分支继续处理剩余风险。

## 决策

### 1. 运行模式继续用单一布尔派生，不做能力化重写

- **做法**：`app-mode.ts` 是唯一判定入口，`LOCAL_MODE` / `NATIVE_SHELL` 保持原语义。
- **有争议的点**：是否把 16 个业务文件里的 98 处 `LOCAL_MODE` 分支改写成 `capabilities.*`。
- **结论**：不改。行业常见做法是区分“环境标志（isDesktop / isLocal）”与“能力开关”；只有能力彼此正交时，能力对象才值得引入。这里的 98 处判断几乎全部由同一位决定（本地 vs 服务器），能力对象只会增加一层间接。
- **替代措施**：ESLint 规则禁止在 `src/local/mode.ts` 之外读取 `import.meta.env.MODE` / `VITE_LOCAL_DATA`，防止新的重复判定出现。

### 2. 传输层统一错误分类，业务错误原样保留

- **做法**：`api/errors.ts` 提供 `classifyApiFailure`，`request()` 在唯一出口处归类：`timeout` / `network` / `auth` / `server` / `client`，并附带 `retryable`。
- **有争议的点**：是否修改全部 81 处 `message.error` 调用。
- **结论**：不改。行业做法是“传输层归因、展示层决定文案”。5xx 且响应体不是 JSON 时使用统一可读文案；4xx 业务校验错误（如“结束时间必须晚于开始时间”）保持原文。
- **收益**：新增接口自动获得分类，不会因为没人记得加提示而退化成 `请求失败 (HTTP 500)`。

### 3. 环境布尔值按常见约定解析

- **做法**：`isTruthyFlag()` 接受 `true / 1 / yes / on`，大小写不敏感。
- **理由**：CI 与本地脚本里 `TRUE`、`1` 很常见；严格 `=== 'true'` 会让配置静默失效。这与 12-Factor 的“配置显式”一致，同时保留可读性。
- **注意**：这是相对旧实现（仅小写 `true`）的行为变化，已在测试中固定。

### 4. 用 jsdom 做最小的装配级测试

- **做法**：新增 `test-accent-provider.mjs`，在 jsdom 中真实渲染 `AccentProvider`，断言样式表注入、localStorage 写入与恢复默认。
- **有争议的点**：是否引入 Vitest + Testing Library。
- **结论**：不引入整套框架。仓库现有约定是 `node:test` + 手写渲染器；只补一个 `jsdom` 开发依赖即可覆盖 Provider 层，成本最低。
- **边界**：不覆盖 Ant Design 内部渲染，也不做视觉回归。

### 5. 性能用预算而不是口号

- **做法**：`scripts/check-bundle-budget.mjs` 在 CI 构建后检查 gzip 体积：总量 ≤ 1150 KB、业务入口 ≤ 65 KB、最大单 chunk ≤ 400 KB。
- **理由**：行业做法是设预算而非追求一次性数字；阈值按当前实测值留约 7% 余量，能拦住“把大依赖打进首屏”的回归。
- **未做**：没有加入运行时性能基准（LCP/INP），因为 CI 环境噪声大，容易变成假失败。

### 6. 明确拒绝自动回落

服务器模式连不上后端时，不自动切换到本地 IndexedDB。两者是不同的数据空间，自动切换会让用户以为数据丢失。失败必须显式暴露并提供修复步骤。

## 验证

- `npm run test:mode`、`test:accent`、`test:errors`、`test:accent-provider` 全部通过。
- `npm run typecheck`、`npm run lint`（0 error）、`npm run build`、`npm run build:mobile`、`npm run build:shell` 通过。
- `npm run perf:budget`：总量 1078.5 / 1150 KB，入口 54.6 / 65 KB，最大 chunk 372.8 / 400 KB。
- 实测 `npm run dev`：本地模式直接进课表；`npm run dev:server`（无后端）显示地址、原因与三条修复步骤。
- 反向构建断言：`VITE_LOCAL_DATA=true npm run build` 被拒绝。

## 未覆盖

- 真机（Android / Windows）未复验，验证范围为浏览器与构建产物。
- 运行时性能（LCP / INP / 内存）没有基准，只有静态体积预算。
- UI 层 98 处模式分支按决策 1 保留，风险通过 lint 与测试约束，而非重构消除。
