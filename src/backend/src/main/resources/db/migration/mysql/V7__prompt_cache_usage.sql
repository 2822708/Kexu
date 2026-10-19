-- 成本治理 6.1 #4：Prompt Caching 命中计量（MySQL 版）
--
-- 与 h2 版的差异：本文件只有 ALTER，不涉及字符串拼接与 JSON 列，语法两边完全一致。
-- 保留独立文件是为了维持 db/migration/{vendor} 的双份约定——Flyway 只加载对应 vendor 目录，
-- 少一份就会在另一种数据库上静默不执行。
-- 修改本文件时请同步 h2 版本。

ALTER TABLE llm_usage ADD COLUMN cache_hit_tokens INT;
ALTER TABLE llm_usage ADD COLUMN cache_miss_tokens INT;
