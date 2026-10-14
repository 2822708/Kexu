-- AI Campus Agent V1.0 核心表：学生档案 / 任务 / 长期记忆 / 每日计划
--
-- 设计要点（与现有约定对齐）：
--   1) 用户维度沿用 api_key（VARCHAR(64)），与 schedule/todo/ai_conversation 一致，
--      不引入数字 user_id；多设备不共享数据（账号同步属后续版本）。
--   2) task 与 todo 分离：todo 保持原状零回归；本迁移把历史待办一次性拷贝为
--      source='LEGACY_TODO' 的任务（幂等，重复执行不会产生重复行）。
--   3) H2 的索引名全库唯一 → 索引名统一带表名前缀；JSON 数组列改用 TEXT
--      （H2 的 JSON 列读回带外层引号，MyBatis-Plus JacksonTypeHandler 解析会失败，
--      与 V1 中 weeks/action_data 改文本列同一原因）。
--   4) 表名用 student_memory 而非 memory：MEMORY 在 MySQL 是保留字。
--   5) 修改 mysql 版本时请同步本文件。

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
    CONSTRAINT uk_student_profile_api_key UNIQUE (api_key)
);

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
);

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
);

CREATE TABLE daily_plan (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    plan_date DATE NOT NULL,
    content TEXT NOT NULL,
    summary VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key) REFERENCES api_key(api_key) ON DELETE CASCADE,
    CONSTRAINT uk_daily_plan_date UNIQUE (api_key, plan_date)
);

-- 历史待办一次性迁移为任务（幂等：按 source_ref='todo:'||id 判重）。
-- 逾期未完成 → priority=1（高）；已完成 → status=DONE；类型统一 OTHER（待办无类型信息）。
INSERT INTO task (api_key, title, type, deadline, priority, status, source, source_ref, created_at, updated_at)
SELECT t.api_key,
       t.title,
       'OTHER',
       t.ddl,
       CASE WHEN t.completed = FALSE AND t.ddl < CURRENT_TIMESTAMP THEN 1 ELSE 2 END,
       CASE WHEN t.completed = TRUE THEN 'DONE' ELSE 'PENDING' END,
       'LEGACY_TODO',
       'todo:' || t.id,
       t.created_at,
       CURRENT_TIMESTAMP
FROM todo t
WHERE NOT EXISTS (SELECT 1 FROM task k WHERE k.source_ref = 'todo:' || t.id);
