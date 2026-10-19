package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.timetable.entity.Memory;
import com.timetable.exception.BusinessException;
import com.timetable.service.LlmClient;
import com.timetable.service.MemoryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 契约层：记忆提炼的「模型输出 → 服务端清洗」归约（6.2 #7）。
 *
 * <p><b>这一条与其他四条不同，必须说明清楚。</b>其余四条测的是
 * 「{@code AiServiceImpl} 把模型 JSON 翻成 DTO」这一步；记忆的输出没有 DTO 往返，
 * 模型给出的 {@code type/content/importance} 会被直接交给
 * {@link MemoryService#create} / {@link MemoryService#update}。所以真正决定
 * 「这条记忆能不能落库、落成什么样」的清洗逻辑在服务层，契约断言也就落在这里。
 *
 * <p>这个差异不是实现细节，而是两条<b>不同的失败哲学</b>：
 * <ul>
 *   <li>任务/通知/计划：脏输出<b>钳制或降级</b>后照常展示——少一条、截一段都比白屏好；</li>
 *   <li>记忆：脏输出<b>直接拒绝</b>——一条类型错误或半截话的记忆会留在库里，
 *       之后每次对话都被注入，污染是长期的、复利的。</li>
 * </ul>
 * 用例里这两种行为的差异必须被锁住，否则某次「统一清洗逻辑」的重构会悄悄把
 * 记忆的拒绝改成截断，而没有任何测试报警。
 */
@ActiveProfiles(ModelEvalSupport.PROFILE)
@SpringBootTest(classes = ModelEvalSupport.EvalApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:model_eval_memory;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class MemoryExtractContractEvalTest {

    private static final String OWNER = "eval-memory-owner";
    private static final JsonNode FIXTURE = loadFixture();

    @Autowired JdbcTemplate sql;
    @Autowired MemoryService memories;
    @MockBean LlmClient provider;

    /** 已有记忆的 id，顺序与用例文件 existingMemories 一致。 */
    private final List<Long> existingIds = new java.util.ArrayList<>();

    private static JsonNode loadFixture() {
        try {
            return ModelEvalSupport.loadFixture("memory-extract");
        } catch (Exception e) {
            throw new IllegalStateException("加载 memory-extract 用例失败", e);
        }
    }

    static Stream<JsonNode> cases() {
        return ModelEvalSupport.cases(FIXTURE).stream();
    }

    @BeforeEach
    void seedExistingMemories() {
        for (String table : List.of("student_memory", "ai_action", "ai_message", "ai_conversation",
                "task", "course", "exam", "todo", "recurring_todo", "schedule", "api_key",
                "student_profile", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Eval owner");

        existingIds.clear();
        for (JsonNode node : FIXTURE.path("existingMemories")) {
            Memory memory = memories.create(OWNER, node.path("type").asText(),
                    node.path("content").asText(), node.path("importance").asInt(),
                    Memory.SOURCE_USER, "eval-seed");
            existingIds.add(memory.getId());
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    @DisplayName("模型输出 → 记忆落库清洗")
    void modelMemoryEntriesAreNormalizedOrRejected(JsonNode evalCase) {
        String caseId = evalCase.path("id").asText();
        JsonNode expect = evalCase.path("expect");

        if (evalCase.has("expectRejected")) {
            String reason = evalCase.path("expectRejected").asText();
            JsonNode entry = evalCase.path("raw").path("memories").path(0);
            assertThatThrownBy(() -> applyEntry(entry))
                    .as("用例 %s 期望被拒绝（原因含「%s」），实际却落库了", caseId, reason)
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining(reason);
            // 拒绝之后库里不能多出记录：被拒的脏数据不该占着 50 条配额
            assertThat(activeCount())
                    .as("用例 %s 被拒绝后不该新增记忆", caseId)
                    .isEqualTo(FIXTURE.path("existingMemories").size());
            return;
        }

        int before = activeCount();
        for (JsonNode entry : evalCase.path("raw").path("memories")) {
            applyEntry(entry);
        }

        int createdCount = activeCount() - before;
        if (expect.has("createdCount")) {
            assertThat(createdCount)
                    .as(ModelEvalSupport.failMessage(caseId, "新增记忆数",
                            expect.path("createdCount").asInt(), createdCount))
                    .isEqualTo(expect.path("createdCount").asInt());
        }

        if (expect.has("created")) {
            assertAppliedFields(caseId, expect.path("created"));
        }
        if (expect.has("importanceRaisedFor")) {
            // 「raise」用的是 existingMemories 里的序号（1 起）
            int index = expect.path("importanceRaisedFor").asInt() - 1;
            Memory target = memories.getById(existingIds.get(index), OWNER);
            assertThat(target.getImportance())
                    .as(ModelEvalSupport.failMessage(caseId, "第 " + (index + 1) + " 条原有记忆的重要度",
                            expect.path("expectedImportance").asInt(), target.getImportance()))
                    .isEqualTo(expect.path("expectedImportance").asInt());
        }
        if (expect.has("expectedImportanceOf")) {
            int index = expect.path("expectedImportanceOf").asInt() - 1;
            Memory target = memories.getById(existingIds.get(index), OWNER);
            assertThat(target.getImportance())
                    .as(ModelEvalSupport.failMessage(caseId, "第 " + (index + 1) + " 条原有记忆的重要度",
                            expect.path("expectedImportance").asInt(), target.getImportance()))
                    .isEqualTo(expect.path("expectedImportance").asInt());
        }
        if (expect.has("updatedId")) {
            int index = expect.path("updatedId").asInt() - 1;
            Memory target = memories.getById(existingIds.get(index), OWNER);
            if (expect.has("updatedContent")) {
                assertThat(target.getContent())
                        .as(ModelEvalSupport.failMessage(caseId, "被改写记忆的内容",
                                expect.path("updatedContent").asText(), target.getContent()))
                        .isEqualTo(expect.path("updatedContent").asText());
            }
            if (expect.has("updatedImportance")) {
                assertThat(target.getImportance())
                        .as(ModelEvalSupport.failMessage(caseId, "被改写记忆的重要度",
                                expect.path("updatedImportance").asInt(), target.getImportance()))
                        .isEqualTo(expect.path("updatedImportance").asInt());
            }
        }
    }

    private void assertAppliedFields(String caseId, JsonNode expectations) {
        List<Memory> active = memories.listActive(OWNER);
        for (int i = 0; i < expectations.size(); i++) {
            JsonNode exp = expectations.get(i);
            // 新增记忆按创建顺序追加在原有记忆之后；listActive 按重要度倒序，
            // 所以这里按内容定位而不是按下标，避免被排序干扰
            String expectedContent = exp.path("content").asText();
            Memory actual = active.stream()
                    .filter(m -> expectedContent.equals(m.getContent()))
                    .findFirst()
                    .orElseThrow(() -> new AssertionError(
                            "用例 " + caseId + " 期望落库记忆「" + expectedContent + "」，实际库里没有"));

            if (exp.has("type")) {
                assertThat(actual.getType())
                        .as(ModelEvalSupport.failMessage(caseId, expectedContent + " 的类型",
                                exp.path("type").asText(), actual.getType()))
                        .isEqualTo(exp.path("type").asText());
            }
            if (exp.has("importance")) {
                assertThat(actual.getImportance())
                        .as(ModelEvalSupport.failMessage(caseId, expectedContent + " 的重要度",
                                exp.path("importance").asInt(), actual.getImportance()))
                        .isEqualTo(exp.path("importance").asInt());
            }
            assertThat(actual.getSource())
                    .as("用例 %s 落库的记忆必须标记来源为 AI，便于审计", caseId)
                    .isEqualTo(Memory.SOURCE_AI);
        }
    }

    /**
     * 把一条模型输出当作 {@code SAVE_MEMORY} 提案来执行——与
     * {@code AiServiceImpl.applyAction} 的 SAVE_MEMORY 分支保持同样的调用形态：
     * UPDATE 且 target_id 有效走 update，其余一律走 create。
     */
    private void applyEntry(JsonNode entry) {
        String type = entry.path("type").asText("").trim().toUpperCase();
        String content = entry.path("content").asText("");
        Integer importance = entry.path("importance").isIntegralNumber()
                ? entry.path("importance").asInt() : null;
        Long targetId = null;
        if (entry.path("target_id").isIntegralNumber() && entry.path("target_id").canConvertToLong()) {
            targetId = entry.path("target_id").asLong();
        }
        if ("UPDATE".equals(entry.path("action").asText("").trim().toUpperCase())
                && targetId != null && targetId > 0) {
            memories.update(resolveTarget(targetId), OWNER, type, content, importance);
        } else {
            memories.create(OWNER, type, content, importance == null ? 3 : importance,
                    Memory.SOURCE_AI, "eval:" + entry.path("content").asText().hashCode());
        }
    }

    /** 用例里的 target_id 也是序号占位，映射成真实 id。 */
    private Long resolveTarget(Long rawId) {
        int index = (int) (rawId - 1);
        assertThat(existingIds).as("用例引用了 target_id=%d，但只预置了 %d 条", rawId, existingIds.size())
                .hasSizeGreaterThan(index);
        return existingIds.get(index);
    }

    private int activeCount() {
        return (int) memories.countActive(OWNER);
    }
}
