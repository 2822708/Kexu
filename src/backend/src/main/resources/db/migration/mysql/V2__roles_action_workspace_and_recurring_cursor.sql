ALTER TABLE api_key ADD COLUMN account_role VARCHAR(16) NOT NULL DEFAULT 'USER';
ALTER TABLE ai_action ADD COLUMN schedule_id BIGINT NULL;
ALTER TABLE recurring_todo ADD COLUMN last_evaluated_at DATETIME NULL;

UPDATE api_key SET account_role = 'ADMIN' WHERE label = 'Tangent0712';

UPDATE ai_action
SET schedule_id = (
    SELECT c.schedule_id
    FROM ai_message m
    JOIN ai_conversation c ON c.id = m.conversation_id
    WHERE m.id = ai_action.message_id
)
WHERE scope = 'COURSE' AND schedule_id IS NULL;

CREATE INDEX idx_ai_action_workspace
    ON ai_action (api_key, scope, schedule_id, action_status);
