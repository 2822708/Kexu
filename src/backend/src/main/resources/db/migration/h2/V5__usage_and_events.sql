-- AI Campus Agent成本治理 P0-1：LLM 用量计量 + 用户行为事件
--
-- 设计要点（与现有约定对齐）：
--   1) 用户维度沿用 api_key（VARCHAR(64)），与 schedule/todo/ai_action 一致，
--      不引入数字 user_id（多设备不共享数据，账号同步属后续版本）。
--   2) llm_usage 每次 LLM 调用一行，是「成本治理」的基础数据：没有 token 计量，
--      多provider 路由、Prompt Caching、预算熔断全都无从谈起。
--   3) status 区分 SUCCESS / ERROR：token 已经花掉但解析失败是**真实成本**，
--      只记成功会系统性低估，因此失败也要落库（token 数取已知部分）。
--   4) ai_event 是通用行为事件表，先落提案确认/拒绝，后续留存与采纳率扩展
--      不需要再改表结构。当前应用层只写两种事件，不做通用采集 SDK。
--   5) ai_action 补 decided_at：原来只有 created_at，EXECUTED / REJECTED 的
--      发生时刻完全丢失，算不出「生成 → 确认」耗时。注意 STALE 的**只读展示态**
--      复核仍不落库（既有设计不变），所以确认率是「已落库口径」而非全量口径，
--      统计页必须同时展示失效数避免误导。
--   6) 本表无 JSON 列，故无需担心 H2 的 JSON 读回引号问题。
--   7) 修改 mysql 版本时请同步本文件。

CREATE TABLE llm_usage (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    scene VARCHAR(32) NOT NULL,
    provider VARCHAR(16) NOT NULL,
    model VARCHAR(64),
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    stream BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms INT,
    status VARCHAR(16) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_llm_usage_key_time (api_key, created_at),
    INDEX idx_llm_usage_scene (api_key, scene)
);

CREATE TABLE ai_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    scene VARCHAR(32),
    action_type VARCHAR(32),
    ref_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_event_key_type (api_key, event_type, created_at)
);

ALTER TABLE ai_action ADD COLUMN decided_at DATETIME;