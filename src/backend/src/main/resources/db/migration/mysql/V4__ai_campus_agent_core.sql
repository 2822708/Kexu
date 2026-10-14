-- AI Campus Agent V1.0 核心表：学生档案 / 任务 / 长期记忆 / 每日计划（MySQL 版）
--
-- 与 h2 版的差异：
--   1) 字符串拼接用 CONCAT()（MySQL 默认 PIPES_AS_CONCAT=OFF，|| 是逻辑或）；
--   2) 索引名仅表内唯一即可，命名与 h2 版保持一致便于对照；
--   3) interest/skills 同样用 TEXT（与 course.weeks 的 JSON 列策略保持一致，
--      由应用层 Jackson 序列化，避免 H2 兼容问题）。
--   4) 表名用 student_memory 而非 memory：MEMORY 在 MySQL 是保留字。
-- 修改本文件时请同步 h2 版本。

CREATE TABLE student_profile (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    name VARCHAR(50),
    school VARCHAR(100),
    major VARCHAR(100),
    grade VARCHAR(20),
    goal VARCHAR(500),
    interest TEXT NOT NULL,
    skills TEXT NOT NULL,
    learning_style VARCHAR(100),
    updated_by VARCHAR(16) NOT NULL DEFAULT 'USER',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    UNIQUE KEY uk_student_profile_api_key (api_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE task (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    title VARCHAR(500) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'OTHER',
    description VARCHAR(2000),
    deadline DATETIME,
    priority TINYINT NOT NULL DEFAULT 2,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    source_ref VARCHAR(100),
    schedule_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_task_api_key (api_key),
    INDEX idx_task_status (api_key, status),
    INDEX idx_task_deadline (deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_memory (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    type VARCHAR(20) NOT NULL,
    content VARCHAR(500) NOT NULL,
    importance TINYINT NOT NULL DEFAULT 3,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    source VARCHAR(20) NOT NULL DEFAULT 'AI',
    source_ref VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    INDEX idx_student_memory_api_key (api_key),
    INDEX idx_student_memory_type (api_key, type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE daily_plan (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    plan_date DATE NOT NULL,
    content TEXT NOT NULL,
    summary VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    UNIQUE KEY uk_daily_plan_date (api_key, plan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 历史待办一次性迁移为任务（幂等：按 source_ref=CONCAT('todo:',id) 判重）。
INSERT INTO task (api_key, title, type, deadline, priority, status, source, source_ref, created_at, updated_at)
SELECT t.api_key,
       t.title,
       'OTHER',
       t.ddl,
       CASE WHEN t.completed = FALSE AND t.ddl < CURRENT_TIMESTAMP THEN 1 ELSE 2 END,
       CASE WHEN t.completed = TRUE THEN 'DONE' ELSE 'PENDING' END,
       'LEGACY_TODO',
       CONCAT('todo:', t.id),
       t.created_at,
       CURRENT_TIMESTAMP
FROM todo t
WHERE NOT EXISTS (SELECT 1 FROM task k WHERE k.source_ref = CONCAT('todo:', t.id));
