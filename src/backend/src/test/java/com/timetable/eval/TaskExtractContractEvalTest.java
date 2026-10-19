package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.timetable.dto.TaskDraft;
import com.timetable.dto.TaskExtractRequest;
import com.timetable.dto.TaskExtractResult;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static com.timetable.eval.ModelEvalSupport.MAPPER;
import static com.timetable.eval.ModelEvalSupport.toJson;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 契约层：任务抽取的「模型输出 → 服务端清洗」归约（6.2 #7）。
 *
 * <p>用例来源 {@code model-eval/contracts/task-extract.json}。这里验的不是模型准不准
 * （那是提示词层的事），而是<b>服务端把模型输出翻成草稿时有没有改坏 / 放错</b>。
 */
@ActiveProfiles(ModelEvalSupport.PROFILE)
@SpringBootTest(classes = ModelEvalSupport.EvalApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:model_eval_task;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class TaskExtractContractEvalTest {

    private static final String OWNER = "eval-task-owner";
    /** 与固定时钟 2026-10-19 对齐，用例里的「过去 / 未来」都相对这一天。 */
    private static final JsonNode FIXTURE = loadFixture();

    @Autowired JdbcTemplate sql;
    @Autowired AiService ai;
    @MockBean LlmClient provider;

    private static JsonNode loadFixture() {
        try {
            return ModelEvalSupport.loadFixture("task-extract");
        } catch (Exception e) {
            throw new IllegalStateException("加载 task-extract 用例失败", e);
        }
    }

    static Stream<JsonNode> cases() {
        return ModelEvalSupport.cases(FIXTURE).stream();
    }

    @BeforeEach
    void resetDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "task", "todo",
                "recurring_todo", "course", "exam", "schedule", "api_key", "student_profile",
                "student_memory", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Eval owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    @DisplayName("模型输出 → 任务草稿清洗")
    void modelOutputIsNormalizedIntoDrafts(JsonNode evalCase) {
        String caseId = evalCase.path("id").asText();
        when(provider.chatJson(any(), any())).thenReturn(toJson(evalCase.path("raw")));

        TaskExtractResult result = ai.extractTasks(request("材料文本"), OWNER);

        JsonNode expect = evalCase.path("expect");
        List<TaskDraft> drafts = result.getTasks();
        assertThat(drafts)
                .as(ModelEvalSupport.failMessage(caseId, "任务条数", expect.path("taskCount").asInt(), drafts.size()))
                .hasSize(expect.path("taskCount").asInt());

        if (expect.has("confidence")) {
            assertThat(result.getConfidence())
                    .as(ModelEvalSupport.failMessage(caseId, "confidence",
                            expect.path("confidence").asDouble(), result.getConfidence()))
                    .isEqualTo(expect.path("confidence").asDouble());
        }
        if (expect.has("skipped")) {
            assertThat(result.getNote())
                    .as("用例 %s 应如实报告丢弃了 %d 条", caseId, expect.path("skipped").asInt())
                    .contains("已忽略 " + expect.path("skipped").asInt() + " 条");
        }
        if (expect.has("firstTitle")) {
            assertThat(drafts.get(0).getTitle())
                    .as(ModelEvalSupport.failMessage(caseId, "首条标题", expect.path("firstTitle").asText(),
                            drafts.get(0).getTitle()))
                    .isEqualTo(expect.path("firstTitle").asText());
        }
        if (expect.has("lastTitle")) {
            TaskDraft last = drafts.get(drafts.size() - 1);
            assertThat(last.getTitle())
                    .as(ModelEvalSupport.failMessage(caseId, "末条标题", expect.path("lastTitle").asText(),
                            last.getTitle()))
                    .isEqualTo(expect.path("lastTitle").asText());
        }
        if (expect.has("tasks")) {
            assertPerFieldExpectations(caseId, expect.path("tasks"), drafts);
        }
    }

    private void assertPerFieldExpectations(String caseId, JsonNode expectations, List<TaskDraft> drafts) {
        for (int i = 0; i < expectations.size(); i++) {
            JsonNode exp = expectations.get(i);
            TaskDraft draft = drafts.get(i);
            String label = "第 " + (i + 1) + " 条";

            if (exp.has("title")) {
                assertThat(draft.getTitle())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 标题", exp.path("title").asText(), draft.getTitle()))
                        .isEqualTo(exp.path("title").asText());
            }
            if (exp.has("titleLength")) {
                assertThat(draft.getTitle())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 标题长度",
                                exp.path("titleLength").asInt(), draft.getTitle().length()))
                        .hasSize(exp.path("titleLength").asInt());
            }
            if (exp.has("type")) {
                assertThat(draft.getType())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 类型", exp.path("type").asText(), draft.getType()))
                        .isEqualTo(exp.path("type").asText());
            }
            if (exp.has("deadline")) {
                assertThat(formatDeadline(draft.getDeadline()))
                        .as(ModelEvalSupport.failMessage(caseId, label + " 截止时间",
                                exp.path("deadline").isNull() ? null : exp.path("deadline").asText(),
                                formatDeadline(draft.getDeadline())))
                        .isEqualTo(exp.path("deadline").isNull() ? null : exp.path("deadline").asText());
            }
            if (exp.has("priority")) {
                assertThat(draft.getPriority())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 优先级",
                                exp.path("priority").asInt(), draft.getPriority()))
                        .isEqualTo(exp.path("priority").asInt());
            }
            if (exp.has("description")) {
                assertThat(draft.getDescription())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 描述",
                                exp.path("description").asText(), draft.getDescription()))
                        .isEqualTo(exp.path("description").asText());
            }
            if (exp.has("descriptionLength")) {
                assertThat(draft.getDescription())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 描述长度",
                                exp.path("descriptionLength").asInt(), draft.getDescription().length()))
                        .hasSize(exp.path("descriptionLength").asInt());
            }
        }
    }

    /** null 保持 null（不能被格式化成一个假时刻）。 */
    private String formatDeadline(LocalDateTime deadline) {
        return deadline == null ? null : deadline.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"));
    }

    private TaskExtractRequest request(String text) {
        TaskExtractRequest req = new TaskExtractRequest();
        req.setText(text);
        return req;
    }

    @Test
    @DisplayName("用例里的 raw 都能被解析成合法 JSON——数据写坏了会让整条用例静默失去意义")
    void allCasePayloadsAreValidJson() throws Exception {
        List<String> broken = new ArrayList<>();
        for (JsonNode evalCase : ModelEvalSupport.cases(FIXTURE)) {
            try {
                MAPPER.readTree(toJson(evalCase.path("raw")));
            } catch (Exception e) {
                broken.add(evalCase.path("id").asText());
            }
        }
        assertThat(broken).as("这些用例的 raw 不是合法 JSON").isEmpty();
    }
}
