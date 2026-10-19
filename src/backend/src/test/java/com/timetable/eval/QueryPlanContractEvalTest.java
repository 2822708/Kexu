package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.timetable.dto.QueryPlanRequest;
import com.timetable.dto.QueryPlanResult;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static com.timetable.eval.ModelEvalSupport.toJson;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 契约层：查询计划的「模型输出 → 服务端清洗」归约（6.2 #7）。
 *
 * <p>这条路径的产品边界最硬：<b>AI 不联网、不检索、不声称找到了任何公告</b>，
 * 只整理「怎么查」。服务端清洗必须守住这个边界——超长字段截断、阶段数封顶、
 * leadDays 钳制，任何一项失守都可能让输出看起来像「查到了具体日程」。
 */
@ActiveProfiles(ModelEvalSupport.PROFILE)
@SpringBootTest(classes = ModelEvalSupport.EvalApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:model_eval_query;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class QueryPlanContractEvalTest {

    private static final String OWNER = "eval-query-owner";
    private static final JsonNode FIXTURE = loadFixture();

    @Autowired JdbcTemplate sql;
    @Autowired AiService ai;
    @MockBean LlmClient provider;

    private static JsonNode loadFixture() {
        try {
            return ModelEvalSupport.loadFixture("query-plan");
        } catch (Exception e) {
            throw new IllegalStateException("加载 query-plan 用例失败", e);
        }
    }

    static Stream<JsonNode> cases() {
        return ModelEvalSupport.cases(FIXTURE).stream();
    }

    @BeforeEach
    void resetDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "task", "course",
                "exam", "todo", "recurring_todo", "schedule", "api_key", "student_profile",
                "student_memory", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Eval owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    @DisplayName("模型输出 → 查询计划清洗")
    void modelOutputIsNormalizedIntoQueryPlan(JsonNode evalCase) {
        String caseId = evalCase.path("id").asText();
        when(provider.chatJson(any(), any())).thenReturn(toJson(evalCase.path("raw")));

        QueryPlanResult plan = ai.queryPlan(request("COMPETITION", "电子设计竞赛"));

        JsonNode expect = evalCase.path("expect");

        if (expect.has("goal")) {
            assertThat(plan.getGoal())
                    .as(ModelEvalSupport.failMessage(caseId, "目标", expect.path("goal").asText(), plan.getGoal()))
                    .isEqualTo(expect.path("goal").asText());
        }
        if (expect.has("note")) {
            assertThat(plan.getNote())
                    .as(ModelEvalSupport.failMessage(caseId, "备注", expect.path("note").asText(), plan.getNote()))
                    .isEqualTo(expect.path("note").asText());
        }
        if (expect.has("channelCount")) {
            assertThat(plan.getChannels())
                    .as(ModelEvalSupport.failMessage(caseId, "渠道数",
                            expect.path("channelCount").asInt(), size(plan.getChannels())))
                    .hasSize(expect.path("channelCount").asInt());
        }
        if (expect.has("channels")) {
            assertThat(plan.getChannels())
                    .as("用例 %s 的渠道列表不符", caseId)
                    .containsExactlyElementsOf(textList(expect.path("channels")));
        }
        if (expect.has("watchoutCount")) {
            assertThat(plan.getWatchouts())
                    .as(ModelEvalSupport.failMessage(caseId, "注意点数",
                            expect.path("watchoutCount").asInt(), size(plan.getWatchouts())))
                    .hasSize(expect.path("watchoutCount").asInt());
        }
        if (expect.has("watchouts")) {
            assertThat(plan.getWatchouts())
                    .as("用例 %s 的注意点列表不符", caseId)
                    .containsExactlyElementsOf(textList(expect.path("watchouts")));
        }
        if (expect.has("phaseCount")) {
            assertThat(plan.getPhases())
                    .as(ModelEvalSupport.failMessage(caseId, "阶段数",
                            expect.path("phaseCount").asInt(), size(plan.getPhases())))
                    .hasSize(expect.path("phaseCount").asInt());
        }
        if (expect.has("phaseNames")) {
            assertThat(plan.getPhases())
                    .extracting(QueryPlanResult.Phase::getName)
                    .as("用例 %s 的阶段名序列不符", caseId)
                    .containsExactlyElementsOf(textList(expect.path("phaseNames")));
        }
        if (expect.has("leadDays")) {
            List<Integer> expected = new ArrayList<>();
            for (JsonNode node : expect.path("leadDays")) {
                expected.add(node.asInt());
            }
            assertThat(plan.getPhases())
                    .extracting(QueryPlanResult.Phase::getLeadDays)
                    .as("用例 %s 的 leadDays 序列不符（必须钳到 [-30,365]）", caseId)
                    .containsExactlyElementsOf(expected);
        }
        if (expect.has("goalLengthAtMost")) {
            assertThat(plan.getGoal().length())
                    .as("用例 %s 的目标超长", caseId)
                    .isLessThanOrEqualTo(expect.path("goalLengthAtMost").asInt());
        }
        if (expect.has("channelLengthsAtMost")) {
            int limit = expect.path("channelLengthsAtMost").asInt();
            assertThat(plan.getChannels())
                    .as("用例 %s 存在超长渠道名", caseId)
                    .allSatisfy(text -> assertThat(text.length()).isLessThanOrEqualTo(limit));
        }
        if (expect.has("watchoutLengthsAtMost")) {
            int limit = expect.path("watchoutLengthsAtMost").asInt();
            assertThat(plan.getWatchouts())
                    .as("用例 %s 存在超长注意点", caseId)
                    .allSatisfy(text -> assertThat(text.length()).isLessThanOrEqualTo(limit));
        }
        if (expect.has("phaseNameLengthsAtMost")) {
            int limit = expect.path("phaseNameLengthsAtMost").asInt();
            assertThat(plan.getPhases())
                    .as("用例 %s 存在超长阶段名", caseId)
                    .allSatisfy(phase -> assertThat(phase.getName().length()).isLessThanOrEqualTo(limit));
        }
        if (expect.has("phaseHintLengthsAtMost")) {
            int limit = expect.path("phaseHintLengthsAtMost").asInt();
            assertThat(plan.getPhases())
                    .as("用例 %s 存在超长阶段提示", caseId)
                    .allSatisfy(phase -> assertThat(phase.getHint().length()).isLessThanOrEqualTo(limit));
        }
        if (expect.has("noteLengthAtMost")) {
            assertThat(plan.getNote().length())
                    .as("用例 %s 的备注超长", caseId)
                    .isLessThanOrEqualTo(expect.path("noteLengthAtMost").asInt());
        }
    }

    private int size(List<?> list) {
        return list == null ? 0 : list.size();
    }

    private List<String> textList(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode node : array) {
            out.add(node.asText());
        }
        return out;
    }

    private QueryPlanRequest request(String category, String keyword) {
        QueryPlanRequest req = new QueryPlanRequest();
        req.setCategory(category);
        req.setKeyword(keyword);
        return req;
    }
}
