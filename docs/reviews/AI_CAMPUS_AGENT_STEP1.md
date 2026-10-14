# Step 1 实施报告：AI Campus Agent 核心表 + 双 Vendor 迁移（补写）

> 日期：2026-10-14（提交 d9dec02，本报告为系列完整性补写）｜ 范围：已批准方案 Step 1（4 新表 + Flyway V4 双 vendor 迁移 + 历史待办回填）｜ 结论：**完成，3 个迁移测试通过，既有功能零回归**

## 1. 交付内容

| 项 | 内容 |
|---|---|
| 新表 ×4 | `student_profile`（档案，uk 约束每账号一行）、`task`（任务，与 todo 并存）、`student_memory`（长期记忆）、`daily_plan`（每日计划，uk(api_key, plan_date) 保证一天一份缓存） |
| 迁移脚本 | `db/migration/h2/V4__ai_campus_agent_core.sql` + `db/migration/mysql/V4__ai_campus_agent_core.sql`（语法差异：`CURRENT_TIMESTAMP`/`CONCAT()` vs `\|\|`） |
| 实体/Mapper | `StudentProfile` / `Task` / `Memory` / `DailyPlan` + 对应 Mapper（MyBatis-Plus） |
| 待办回填 | 历史 `todo` 一次性拷入 `task`：source=LEGACY_TODO、source_ref='todo:{id}' 判重幂等；逾期未完成→priority=1，已完成→DONE，类型统一 OTHER |
| 测试 | `AiCampusAgentMigrationTest` ×3：新装建表、回填且重复执行幂等、档案每账号唯一 |

## 2. 关键设计决策（迁移脚本头部注释有完整版）

1. **用户维度沿用 `api_key VARCHAR(64)`**：与 schedule/todo/ai_conversation 全部一致，不引入数字 user_id。
2. **task 与 todo 分离**：todo 原样保留（既有页面/API 零回归），任务模块从回填数据起步。
3. **H2 索引名全库唯一** → 索引统一带表名前缀（`idx_task_*` 等）。
4. **JSON 数组列用 TEXT**：H2 的 JSON 列读回带外层引号，JacksonTypeHandler 解析会失败（与 V1 中 weeks/action_data 改文本列同一原因）。
5. **表名 `student_memory` 而非 `memory`**：MEMORY 在 MySQL 是保留字。

## 3. 与既有 Flyway 体系的关系

- 复用现有 `spring.flyway.locations=classpath:db/migration/{vendor}` 双链（h2/mysql），V4 排在既有 V1–V3 之后；`ValidatedFlywayMigration` 旧库基线化策略不变。
- 迁移只做 ADD TABLE + INSERT...SELECT，无破坏性操作；回填按 `source_ref` 幂等，重复启动不产生重复行。
