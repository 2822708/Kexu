-- 成本治理 6.1 #4：Prompt Caching 命中计量
--
-- 设计要点：
--   1) 两列都允许为 NULL。NULL 表示「上游没报缓存字段」，与「报了 0」是两件事：
--         · 0    = 上游报了，这次一个 token 都没命中
--         · NULL = 上游根本不支持缓存，这个 provider 不该出现在命中率的分母里
--      合成 0 会让「刚接入、还不支持缓存的 provider」被算成命中率 0%，
--      看起来像是「缓存没生效」，实际是「根本无从命中」。
--   2) prompt_tokens 语义不变，仍是输入总量；cache_hit_tokens 是其中的一部分。
--      不做「把 hit 从 prompt_tokens 里扣掉」的处理——那样历史数据与上游账单口径不一致，
--      而且上游账单本来就按 hit/miss 分别计价，总量保留才便于对账。
--   3) 不加索引：这两列只在按 api_key + 时间窗口拉出的行上做求和，
--      查询已经走 idx_llm_usage_key_time，再建索引纯属浪费写入。
--   4) 修改 mysql 版本时请同步本文件。

ALTER TABLE llm_usage ADD COLUMN cache_hit_tokens INT;
ALTER TABLE llm_usage ADD COLUMN cache_miss_tokens INT;
