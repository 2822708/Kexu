-- AI Campus Agent 成本治理 P0-1：LLM 用量计量 + 用户行为事件（MySQL 版）
--
-- 与 h2 版的差异：
--   1) 本文件不含字符串拼接，无需 CONCAT()；
--   2) 索引名仅表内唯一即可，命名与 h2 版保持一致便于对照；
--   3) 表级补充 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4（与既有表一致）；
--   4) 本表无 JSON 列，无需考虑 H2 的 JSON 兼容策略。
-- 修改本文件时请同步 h2 版本。

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ai_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    scene VARCHAR(32),
    action_type VARCHAR(32),
    ref_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_event_key_type (api_key, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE ai_action ADD COLUMN decided_at DATETIME;