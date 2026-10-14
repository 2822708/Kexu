# Step 7 实施报告：长期记忆系统优化（AI Campus Agent V1.0）

> 日期：2026-10-14 ｜ 范围：已批准方案 Step 7 ｜ 结论：**完成，后端 130/130 测试通过，前端三连通过（typecheck/lint/build，零新增 lint 警告）**

## 1. 本步目标与交付对照

| 方案条目 | 交付 | 状态 |
|---|---|---|
| 去重合并（UPDATE 分支 + 唯一性校验） | `memory-extract.md` v2：`memories[]` 增 `action:ADD\|UPDATE` 与 `target_id`；服务端按 action 分派，UPDATE 改写已有记忆而非新增 | ✅ |
| 服务端去重兜底 | `MemoryServiceImpl.create` 走「同 type + 归一化内容」查重：命中则不新增，只在 importance 更高时抬高 | ✅ |
| importance 治理 | 写入统一 clamp 到 1-5；重复写入只升不降；`update` 撞上已存在的同义记忆 → 409（提示合并，而不是静默产生副本） | ✅ |
| 设置页管理 UI | `MemoryManager` 卡片：列表 + 手动添加 + 行内编辑 + 归档 + 删除；`GET/POST/PATCH/DELETE /api/memories` | ✅ |
| top-N 调优 | 排序改为 `importance desc, updatedAt desc, id asc`（同重要度时最近被提及者优先）；ACTIVE 上限 50 条，超出拒绝新增 | ✅ |
| 验收：同一事实对话 3 轮后仅 1 条 ACTIVE | 三轮连续提炼+执行，`listActive` 恒为 1 条（标点/空格/大小写差异被归一化吸收） | ✅ |
| 验收：token 用量稳定 | top-N 注入恒定 ≤20 条；ACTIVE 上限 50 条封顶；提炼窗口只列前 20 条 | ✅ |
| 验收：手动编辑/删除即时生效 | 端点测试覆盖 create→patch→archive→delete 全链路；改完下一轮对话即按新内容注入 | ✅ |
| 回滚：关闭提炼开关（不影响展示） | `app.ai.memory-refine-enabled=false` 只停提炼，对话与已有记忆注入照常 | ✅ |

## 2. 架构决策记录

| 决策 | 理由 |
|---|---|
| **去重做两层：Prompt 层「走 UPDATE」+ 服务端层「归一化查重」** | 只靠 Prompt 不够——模型每轮都会把同一件事再说一遍；只靠服务端又无法表达「这条已经被推翻了，请改写」。前者让 AI 主动合并语义相同的事实，后者保证即使模型不听话也不会产生第二条 |
| **归一化只认字母/数字/汉字，忽略标点空白大小写** | 中文场景下的重复几乎都是标点与空格差异（"准备 12 月 CET-6 考试" vs "准备12月CET6考试！"）。不做子串包含判断——"准备考研" 与 "准备考研和实习" 会被误杀成同一条 |
| **UPDATE 必须带 target_id，且 target 必须是本人名下的 ACTIVE 记忆** | 提炼窗口现在把记忆 id 一起给模型（`- #7 [GOAL·5] ...`）。校验放在提案阶段而非执行阶段：用户点确认时才发现 target 不存在，是纯粹的负面体验，不如干脆不生成这张卡 |
| **重复写入只升不降 importance** | 同一件事被反复提及恰恰说明它更重要；第三轮模型给了 3 分不该把前两轮的 5 分拉回去 |
| **同重要度按 updatedAt 降序** | 被重新确认/修正过的事实更贴近当前。上下文被 top-N 截断时，淘汰的是最久没被提及的那条，而不是最早创建的那条 |
| **ACTIVE 上限 50 条，到顶 409 而非静默丢弃** | 记忆条数直接进入每次对话的 system prompt，必须封顶。409 让用户去设置页清理（归档即可腾位），比悄悄不记录更诚实 |
| **归档（SUPERSEDED）与删除并存** | 归档保留审计痕迹、不再进上下文；删除彻底移除。两者在设置页是两个按钮，语义不混 |
| **提炼开关做成配置项** | 出问题可以一键退回 Step 6 的行为：对话、课表提案、已有记忆注入都不受影响，只停新的 SAVE_MEMORY 提案，不需要回滚数据 |

## 3. 数据流

```
对话回复落库
  → refineMemory（开关 app.ai.memory-refine-enabled 默认开）
  → 提炼窗口（AiPromptBuilder.buildMemoryRefineWindow）：
      档案 + 已有记忆（带 id，最多 20 条）+ 最近对话
  → prompts/memory-extract.md v2（system）→ LLM
      ADD    → {"action":"ADD","type":"GOAL","content":"...","importance":5}
      UPDATE → {"action":"UPDATE","target_id":7,"type":"GOAL","content":"...","importance":4}
  → 提案校验（isValidProposal）：类型白名单 / content≤200 / importance 1-5
      + action∈{ADD,UPDATE} + UPDATE 时 target_id 必须属于本人（否则整条提案丢弃）
  → ai_action PENDING（human-in-the-loop）
  → 用户确认 → execute
      UPDATE → memoryService.update(targetId, ...)   改写，不新增
      ADD    → memoryService.create(...)            内部查重：同 type+归一化内容 → 复用旧记录
```

## 4. 测试（新增 15 个，累计 130/130）

**`AiCampusAgentMemoryTest`（11 个，Spring 集成，真实 H2 + 固定时钟）**

| 测试 | 固化行为 |
|---|---|
| sameFactRefinedThreeTimesKeepsSingleActiveMemory | **核心验收**：三轮聊同一件事（内容只有标点差异）、每轮执行提案后仍只有 1 条 ACTIVE，importance 保持 5 |
| updateProposalRewritesExistingMemoryInsteadOfAdding | UPDATE+target_id 执行后：仍是同一条记录（id 不变），内容改写为「准备 26 年考研」，importance=4，总数 1 |
| updateWithUnusableTargetProducesNoProposal | target_id 指向不存在的 id / 他人账号的记忆 → 不生成提案，双方数据均不变 |
| onlyTopMemoriesEnterContextAndRestAreReportedTruncated | 25 条记忆 → 注入 20 条（importance≥2），`contextSummary.memoriesTruncated=true` |
| sameImportancePrefersRecentlyUpdated | 重要度相同时，最近更新的那条排前 |
| manualEditArchiveAndDeleteApplyImmediately | 局部更新保持 type；归档后 listActive 为空但记录仍在；删除后彻底消失 |
| manualOperationsRejectForeignOrMissingMemory | 跨账号 get/update/delete 一律 404；不存在的 id 404 |
| duplicateManualAddIsMergedAndImportanceNeverDrops | 同义内容不产生第二行；importance 只升不降 |
| editingIntoExistingMemoryIsRejectedInsteadOfCreatingCopy | 把 A 改成与 B 相同 → 409，A 保持原值 |
| capacityGuardRejectsMemoriesBeyondLimit | 第 51 条 → 409；归档一条后可继续写入 |
| normalizeIgnoresPunctuationWhitespaceAndCase | 归一化忽略标点/空格/大小写；不同事实不被合并 |

**`AiCampusAgentMemoryRefineSwitchTest`（1）**：`app.ai.memory-refine-enabled=false` → 主回复照常、模型只被调用一次、无记忆提案，已有记忆仍注入上下文（回滚路径）。

**`MemoryEndpointIntegrationTest`（3，真实应用 + 真实鉴权）**

| 测试 | 固化行为 |
|---|---|
| manualCreateEditArchiveAndDeleteApplyImmediately | POST→GET→PATCH（type 保持）→archive（SUPERSEDED，列表消失、行仍在）→DELETE；`total/injected/limit` 正确 |
| duplicateAddIsMergedAndInvalidInputRejected | 同义重复 POST 返回同一 id；空内容/非法类型 400 |
| memoriesAreInvisibleAndUnmodifiableAcrossAccounts | 跨账号不可见、PATCH/DELETE/archive 均 404；未带 key 401 |

## 5. 测试先行发现的 2 个真实缺陷（偏离记录）

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| 1 | 提炼窗口原本不输出记忆 id，模型拿不到 `target_id`，UPDATE 分支无法实现 | 设计阶段核对 `buildMemoryRefineWindow` 输出 | 窗口改为 `- #7 [GOAL·5] ...`，并提示「未列出的记忆不要凭空引用其 id」 |
| 2 | 既有断言依赖旧格式：`- [GOAL·5] ...` 与模板 `version:1` | 全量跑测 2 个失败 | 更新 `AiCampusAgentPromptTest`：断言 `- #7 [...]`、`version=2`、模板含 `target_id`/`UPDATE` |

## 6. 变更文件清单

**后端（7）**

- `service/MemoryService.java`（改）：增 `getById/update/supersede/delete/normalize` + `MAX_ACTIVE_MEMORIES=50`
- `service/impl/MemoryServiceImpl.java`（改）：归一化查重、局部更新、软淘汰、容量治理、排序调优
- `service/impl/AiPromptBuilder.java`（改）：提炼窗口带记忆 id + 未列出提示
- `resources/prompts/memory-extract.md`（改）：v1 → v2，`action`/`target_id` 与「同一事实只留一条」规则
- `service/impl/AiServiceImpl.java`（改）：SAVE_MEMORY 校验与执行按 action 分派；提炼开关 `@Value("${app.ai.memory-refine-enabled:true}")`
- `dto/MemoryListResponse.java`（新）、`dto/MemoryRequest.java`（新）
- `controller/MemoryController.java`（新）：`GET/POST /api/memories`、`PATCH /{id}`、`POST /{id}/archive`、`DELETE /{id}`

**后端测试（3）**：`AiCampusAgentMemoryTest`（新，11）、`AiCampusAgentMemoryRefineSwitchTest`（新，1）、`MemoryEndpointIntegrationTest`（新，3）；`AiCampusAgentPromptTest`（改 2 处断言）

**前端（5）**

- `types/index.ts`（改）：`MemoryType`/`Memory`/`MemoryList`/`MemoryPayload`
- `api/index.ts`（改）：`memoryApi.list/create/update/archive/remove`
- `components/MemoryManager.tsx`（新）：设置页记忆管理卡片（添加 + 行内编辑 + 归档 + 删除 + 溢出提示）
- `pages/SettingsPage.tsx`（改）：在 AI 配置卡片后插入记忆管理
- `components/AiActionCard.tsx`（改）：SAVE_MEMORY 提案区分「新增」与「修正 #id」

## 7. 验证记录

- 后端：`./mvnw -B test -o` → **Tests run: 130, Failures: 0, Errors: 0**（存量 115 全回归 + 新增 15）
- 前端：`npm run typecheck` 通过；`npm run lint` 0 错误、7 警告（与基线一致，全部位于存量文件）；`npm run build` 通过

## 8. 遗留与下一步

- **语义级去重仍靠模型**：服务端只做归一化精确匹配，"准备考研" 与 "打算考研" 需要模型走 UPDATE 才能合并。若要更强的兜底，可引入 embedding 相似度阈值（当前不在方案范围内，且会引入额外依赖）
- **提案过期与记忆写入的交互**：用户在设置页改记忆会让未执行的记忆提案变 STALE（符合预期——提案基线已变），但用户可能困惑；后续可在卡片上提示「记忆已变更，请重新询问」
- **每日计划缓存未随记忆变化失效**：与 Step 6 遗留一致，计划生成当天不变动
- **Step 7 是 V1.0 开发序列的末步**，下一步进入整体收口：按方案 §2.11「V1.0 验收标准（可演示旅程）」做端到端走查，并补齐用户手册中的 AI 功能章节与 README 说明
