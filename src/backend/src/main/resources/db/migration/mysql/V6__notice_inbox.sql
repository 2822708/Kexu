-- AI Campus Agent：今日待阅通知箱（notice_card，MySQL 版）
--
-- 与 h2 版的差异：
--   1) 本文件不含字符串拼接，无需 CONCAT()；
--   2) 索引名仅表内唯一即可，命名与 h2 版保持一致便于对照；
--   3) 表级补充 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4（与既有表一致）；
--   4) 本表无 JSON 列，无需考虑 H2 的 JSON 兼容策略。
-- 修改本文件时请同步 h2 版本（设计要点注释在 h2 版里，此处不重复）。

CREATE TABLE notice_card (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    source VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(500),
    key_time DATETIME,
    requirement VARCHAR(1000),
    relevance TINYINT NOT NULL DEFAULT 2,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    snooze_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_notice_card_api_key (api_key),
    INDEX idx_notice_card_status (api_key, status, created_at),
    INDEX idx_notice_card_snooze (api_key, snooze_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
