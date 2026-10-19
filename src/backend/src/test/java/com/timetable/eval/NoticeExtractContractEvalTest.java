package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.timetable.dto.NoticeDraft;
import com.timetable.dto.NoticeExtractResult;
import com.timetable.service.LlmClient;
import com.timetable.service.NoticeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Stream;

import static com.timetable.eval.ModelEvalSupport.toJson;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 契约层：通知提炼的「模型输出 → 服务端清洗」归约（6.2 #7）。
 *
 * <p>这条路径与任务抽取的关键差别是「来源缺失要填占位符」和「相关度 1..3 钳制」——
 * 前者影响卡片可读性，后者影响排序权重。两者都容易在重构时被顺手删掉。
 */
@ActiveProfiles(ModelEvalSupport.PROFILE)
@SpringBootTest(classes = ModelEvalSupport.EvalApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:model_eval_notice;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class NoticeExtractContractEvalTest {

    private static final String OWNER = "eval-notice-owner";
    private static final JsonNode FIXTURE = loadFixture();
    private static final DateTimeFormatter DEADLINE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");

    @Autowired JdbcTemplate sql;
    @Autowired NoticeService notices;
    @MockBean LlmClient provider;

    private static JsonNode loadFixture() {
        try {
            return ModelEvalSupport.loadFixture("notice-extract");
        } catch (Exception e) {
            throw new IllegalStateException("加载 notice-extract 用例失败", e);
        }
    }

    static Stream<JsonNode> cases() {
        return ModelEvalSupport.cases(FIXTURE).stream();
    }

    @BeforeEach
    void resetDatabase() {
        for (String table : List.of("notice_card", "ai_action", "ai_message", "ai_conversation",
                "task", "course", "exam", "schedule", "api_key", "student_profile",
                "student_memory", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Eval owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    @DisplayName("模型输出 → 通知卡片清洗")
    void modelOutputIsNormalizedIntoCards(JsonNode evalCase) {
        String caseId = evalCase.path("id").asText();
        when(provider.chatJson(any(), any())).thenReturn(toJson(evalCase.path("raw")));

        NoticeExtractResult result = notices.extract("一段通知材料", OWNER);

        JsonNode expect = evalCase.path("expect");
        List<NoticeDraft> cards = result.getCards();
        assertThat(cards)
                .as(ModelEvalSupport.failMessage(caseId, "卡片条数", expect.path("cardCount").asInt(), cards.size()))
                .hasSize(expect.path("cardCount").asInt());

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
            assertThat(cards.get(0).getTitle())
                    .as(ModelEvalSupport.failMessage(caseId, "首张标题",
                            expect.path("firstTitle").asText(), cards.get(0).getTitle()))
                    .isEqualTo(expect.path("firstTitle").asText());
        }
        if (expect.has("lastTitle")) {
            NoticeDraft last = cards.get(cards.size() - 1);
            assertThat(last.getTitle())
                    .as(ModelEvalSupport.failMessage(caseId, "末张标题",
                            expect.path("lastTitle").asText(), last.getTitle()))
                    .isEqualTo(expect.path("lastTitle").asText());
        }
        if (expect.has("cards")) {
            assertPerFieldExpectations(caseId, expect.path("cards"), cards);
        }
    }

    private void assertPerFieldExpectations(String caseId, JsonNode expectations, List<NoticeDraft> cards) {
        for (int i = 0; i < expectations.size(); i++) {
            JsonNode exp = expectations.get(i);
            NoticeDraft card = cards.get(i);
            String label = "第 " + (i + 1) + " 张";

            assertText(caseId, label + " 来源", exp, "source", card.getSource());
            assertText(caseId, label + " 标题", exp, "title", card.getTitle());
            assertText(caseId, label + " 摘要", exp, "summary", card.getSummary());
            assertText(caseId, label + " 要求", exp, "requirement", card.getRequirement());

            if (exp.has("sourceLength")) {
                assertThat(card.getSource())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 来源长度",
                                exp.path("sourceLength").asInt(), card.getSource().length()))
                        .hasSize(exp.path("sourceLength").asInt());
            }
            if (exp.has("titleLength")) {
                assertThat(card.getTitle())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 标题长度",
                                exp.path("titleLength").asInt(), card.getTitle().length()))
                        .hasSize(exp.path("titleLength").asInt());
            }
            if (exp.has("summaryLength")) {
                assertThat(card.getSummary())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 摘要长度",
                                exp.path("summaryLength").asInt(), card.getSummary().length()))
                        .hasSize(exp.path("summaryLength").asInt());
            }
            if (exp.has("requirementLength")) {
                assertThat(card.getRequirement())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 要求长度",
                                exp.path("requirementLength").asInt(), card.getRequirement().length()))
                        .hasSize(exp.path("requirementLength").asInt());
            }
            if (exp.has("keyTime")) {
                assertThat(format(card.getKeyTime()))
                        .as(ModelEvalSupport.failMessage(caseId, label + " 关键时间",
                                exp.path("keyTime").isNull() ? null : exp.path("keyTime").asText(),
                                format(card.getKeyTime())))
                        .isEqualTo(exp.path("keyTime").isNull() ? null : exp.path("keyTime").asText());
            }
            if (exp.has("relevance")) {
                assertThat(card.getRelevance())
                        .as(ModelEvalSupport.failMessage(caseId, label + " 相关度",
                                exp.path("relevance").asInt(), card.getRelevance()))
                        .isEqualTo(exp.path("relevance").asInt());
            }
        }
    }

    private void assertText(String caseId, String field, JsonNode exp, String name, String actual) {
        if (exp.has(name)) {
            assertThat(actual)
                    .as(ModelEvalSupport.failMessage(caseId, field, exp.path(name).asText(), actual))
                    .isEqualTo(exp.path(name).asText());
        }
    }

    private String format(LocalDateTime value) {
        return value == null ? null : value.format(DEADLINE_FMT);
    }
}
