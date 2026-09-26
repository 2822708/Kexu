-- H2 专用建表脚本（standalone / 桌面版使用；MySQL 版见 schema.sql）
--
-- 与 schema.sql 的三处差异，全部因为 H2 与 MySQL 的语义不同：
--   1) H2 的索引名是「全库唯一」，MySQL 只在表内唯一 → schedule 与 todo 的 idx_api_key 分别改名
--   2) H2 的 JSON 列会把字符串参数存成 JSON 字符串标量，读回带外层引号，
--      导致 MyBatis-Plus 的 JacksonTypeHandler 解析失败 → weeks / action_data 改用文本列
--   3) UNIQUE KEY 是 MySQL 语法 → 改用标准 CONSTRAINT ... UNIQUE
-- 修改 schema.sql 时请同步本文件。
CREATE TABLE IF NOT EXISTS api_key (
    api_key VARCHAR(64) PRIMARY KEY,
    label VARCHAR(50) NOT NULL,
    avatar_url VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_schedule_api_key (api_key)
);

CREATE TABLE IF NOT EXISTS period_config (
    period_number TINYINT PRIMARY KEY,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    category VARCHAR(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS course (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    schedule_id BIGINT NOT NULL,
    name VARCHAR(200) NOT NULL,
    location VARCHAR(200),
    teacher VARCHAR(100),
    day_of_week TINYINT NOT NULL,
    start_period TINYINT NOT NULL,
    end_period TINYINT NOT NULL,
    weeks VARCHAR(1000) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE CASCADE,
    INDEX idx_schedule_day (schedule_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS exam (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    schedule_id BIGINT NOT NULL,
    name VARCHAR(200) NOT NULL,
    location VARCHAR(200),
    exam_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE CASCADE,
    INDEX idx_exam_schedule (schedule_id)
);

CREATE TABLE IF NOT EXISTS todo (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    title VARCHAR(500) NOT NULL,
    ddl DATETIME NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    recurring_id BIGINT,
    exam_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_todo_api_key (api_key),
    INDEX idx_ddl (ddl),
    INDEX idx_completed (completed),
    INDEX idx_todo_recurring (recurring_id),
    INDEX idx_todo_exam (exam_id),
    -- 同一循环规则同一次触发只能有一条待办。应用层已用条件更新原子占位，
    -- 这条唯一键是多实例/异常路径下的兜底（recurring_id 为 NULL 的手工待办不受影响）。
    CONSTRAINT uk_todo_recurring_ddl UNIQUE (recurring_id, ddl)
);

CREATE TABLE IF NOT EXISTS ai_conversation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    schedule_id BIGINT,
    title VARCHAR(200),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_ai_conv_api_key (api_key)
);

CREATE TABLE IF NOT EXISTS ai_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE,
    INDEX idx_ai_msg_conv (conversation_id)
);

CREATE TABLE IF NOT EXISTS ai_action (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id BIGINT NOT NULL,
    api_key VARCHAR(64) NOT NULL,
    scope VARCHAR(16) NOT NULL,
    action_type VARCHAR(32) NOT NULL,
    action_status VARCHAR(16) NOT NULL,
    action_data TEXT,
    data_fingerprint VARCHAR(64),
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES ai_message(id) ON DELETE CASCADE,
    INDEX idx_ai_action_msg (message_id),
    INDEX idx_ai_action_pending (api_key, scope, action_status)
);

CREATE TABLE IF NOT EXISTS recurring_todo (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    title VARCHAR(500) NOT NULL,
    frequency VARCHAR(16) NOT NULL,
    day_of_week TINYINT,
    day_of_month TINYINT,
    trigger_time TIME,
    script TEXT,
    ddl_offset_minutes INT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    chain_after_complete BOOLEAN NOT NULL DEFAULT FALSE,
    last_triggered_at DATETIME,
    next_trigger_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_recurring_api_key (api_key),
    INDEX idx_recurring_next (enabled, next_trigger_at)
);
