-- AI Campus Agent：今日待阅通知箱（notice_card）
--
-- 设计要点（与现有约定对齐）：
--   1) 用户维度沿用 api_key（VARCHAR(64)）+ FOREIGN KEY ... ON DELETE CASCADE，
--      与 task / student_memory 一致。多设备不共享数据。
--   2) 信息入口是**手动喂入**（转发/粘贴/截图），不是自动抓取。本表只存
--      「已经经过 AI 提取、且用户可见」的结构化卡片；原始材料不落库，避免
--      把整段群聊记录存进数据库（既占空间又有隐私负担）。
--   3) 提取与落库分离：notice 草稿阶段不落库（human-in-the-loop），与
--      task extract 的设计一致——模型输出一律先给用户核对。
--   4) key_time 可空：很多通知根本没有明确时间（「新书到馆」「讲座预告」），
--      不能为了填满字段而让模型编一个。服务端同样不猜测时间。
--   5) relevance（关联度）由模型给出、服务端钳制到 1..3，仅作**展示排序**用。
--      它不是推荐分：不做权重训练、不更新用户画像、不跨用户统计。
--   6) snooze_until 实现「稍后提醒」：为空或已过期才出现在今日待阅列表里，
--      因此用户点了「稍后提醒」后卡片会暂时消失，到点自动回来。
--   7) 「忽略 → 降低同类信息后续注入」走**显式规则**（按 source 统计历史忽略率
--      后排序），阈值写死在应用层，不是学习模型。
--   8) 本表无 JSON 列，无需考虑 H2 的 JSON 读回引号问题。
--   9) 修改 mysql 版本时请同步本文件。

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
);
