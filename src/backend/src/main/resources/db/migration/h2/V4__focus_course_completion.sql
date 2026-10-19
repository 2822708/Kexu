CREATE TABLE focus_course_completion (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_key VARCHAR(64) NOT NULL,
    schedule_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    occurrence_date DATE NOT NULL,
    completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_focus_course_occurrence UNIQUE (api_key, schedule_id, course_id, occurrence_date),
    INDEX idx_focus_occurrence_day (api_key, schedule_id, occurrence_date),
    FOREIGN KEY (course_id) REFERENCES course(id) ON DELETE CASCADE
);
