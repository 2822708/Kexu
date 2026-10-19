package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 评估集的结构自检（6.2 #7）。
 *
 * <p>用例文件是手写的 JSON，最容易犯的错不是「断言写错」，而是「断言根本没跑」——
 * 场景名拼错、cases 数组为空、id 重复、期望值里用了执行器不认识的字段。
 * 这些错误会让整套评估静默变成空跑绿，比红更危险。
 *
 * <p>所以这个测试不碰业务逻辑，只保证：五份用例文件都在、每条用例的必需字段齐全、
 * id 全局唯一、且 {@code expect}/{@code expectError} 二选一。
 */
class ModelEvalFixtureTest {

    /** 用例文件名即场景名，执行器按这个清单逐个加载。 */
    private static final List<String> SCENARIOS = List.of(
            "task-extract", "notice-extract", "daily-plan", "query-plan", "memory-extract");

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void allFiveScenariosArePresentAndParseable() throws IOException {
        for (String scenario : SCENARIOS) {
            JsonNode root = load(scenario);
            assertThat(root.path("scenario").asText())
                    .as("%s 的 scenario 字段必须与文件名一致，否则执行器归错场景", scenario)
                    .isEqualTo(scenario);
            assertThat(root.path("cases").isArray() && !root.path("cases").isEmpty())
                    .as("%s 的 cases 不能为空——空数组会让该场景静默零覆盖", scenario)
                    .isTrue();
        }
    }

    @Test
    void caseIdsAreGloballyUniqueAndPrefixedByScenario() throws IOException {
        Set<String> seen = new TreeSet<>();
        for (String scenario : SCENARIOS) {
            String expectedPrefix = prefixOf(scenario);
            for (JsonNode evalCase : load(scenario).path("cases")) {
                String id = evalCase.path("id").asText("");
                assertThat(id)
                        .as("%s 里有用例缺少 id", scenario)
                        .isNotBlank();
                assertThat(id)
                        .as("%s 的用例 id 必须以 %s 开头，方便看报告时定位场景", scenario, expectedPrefix)
                        .startsWith(expectedPrefix);
                assertThat(seen.add(id))
                        .as("用例 id 重复：%s（重复会让报告只显示一条）", id)
                        .isTrue();
            }
        }
        assertThat(seen.size())
                .as("用例总数应保持在 30–50 条：太少覆盖不住场景，太多维护成本超过收益")
                .isBetween(30, 50);
    }

    @Test
    void everyCaseHasExactlyOneOutcomeDeclaration() throws IOException {
        for (String scenario : SCENARIOS) {
            for (JsonNode evalCase : load(scenario).path("cases")) {
                String id = evalCase.path("id").asText("");
                boolean hasExpect = evalCase.has("expect");
                boolean hasError = evalCase.has("expectError") || evalCase.has("expectRejected");
                assertThat(hasExpect ^ hasError)
                        .as("%s：必须且只能声明一种结果（expect 或 expectError/expectRejected），"
                                + "两者都给或都不给都会让执行器判错", id)
                        .isTrue();
                assertThat(evalCase.path("desc").asText(""))
                        .as("%s 缺少 desc：报告里只有 id 没有说明，失败时看不出这条在测什么", id)
                        .isNotBlank();
            }
        }
    }

    @Test
    void dailyPlanFixtureDeclaresItsContext() throws IOException {
        JsonNode root = load("daily-plan");
        // 契约层要真实渲染课表/任务/作息表，缺了这些执行器装配不出上下文
        assertThat(root.path("today").asText()).as("daily-plan 必须声明 today").isNotBlank();
        assertThat(root.path("periods").isArray()).as("daily-plan 必须给作息表").isTrue();
        assertThat(root.path("courses").isArray()).as("daily-plan 必须给今日课程").isTrue();
        assertThat(root.path("tasks").isArray()).as("daily-plan 必须给未完成任务").isTrue();
        for (JsonNode course : root.path("courses")) {
            assertThat(course.path("id").asLong()).as("课程必须带 id，校验要靠 ref_id 匹配").isPositive();
        }
        for (JsonNode task : root.path("tasks")) {
            assertThat(task.path("id").asLong()).as("任务必须带 id，校验要靠 ref_id 匹配").isPositive();
        }
    }

    @Test
    void memoryFixtureDeclaresExistingMemoriesWithIds() throws IOException {
        JsonNode root = load("memory-extract");
        assertThat(root.path("existingMemories").isArray())
                .as("memory-extract 必须给已有记忆，UPDATE 与去重用例都依赖它们的 id")
                .isTrue();
        List<Long> ids = new ArrayList<>();
        for (JsonNode memory : root.path("existingMemories")) {
            long id = memory.path("id").asLong();
            assertThat(id).as("已有记忆必须带 id").isPositive();
            ids.add(id);
        }
        assertThat(ids).as("已有记忆 id 不能重复").doesNotHaveDuplicates();
    }

    @Test
    void expectationFieldNamesAreAllKnown() throws IOException {
        // 期望值字段拼错时执行器会当作「没声明这条断言」直接放过，
        // 于是用例看起来是绿的、实际什么都没验。这里把字段名做成白名单。
        Set<String> allowed = Set.of(
                // 通用
                "taskCount", "cardCount", "itemCount", "createdCount", "proposalCount", "proposalTypes",
                "confidence", "skipped", "note", "goal", "summary",
                "tasks", "cards", "types", "starts", "refIds", "titlesNotEmpty",
                "firstTitle", "lastTitle",
                // 任务
                "title", "type", "deadline", "priority", "description",
                "titleLength", "descriptionLength",
                // 通知
                "source", "keyTime", "requirement", "relevance",
                "sourceLength", "summaryLength", "requirementLength",
                // 计划
                "titleLengthsAtMost", "noteLengthsAtMost", "summaryLengthAtMost",
                // 查询计划
                "channelCount", "watchoutCount", "phaseCount", "phaseNames", "leadDays",
                "channels", "watchouts",
                "goalLengthAtMost", "channelLengthsAtMost", "watchoutLengthsAtMost",
                "phaseNameLengthsAtMost", "phaseHintLengthsAtMost", "noteLengthAtMost",
                // 记忆
                "created", "content", "importance", "importanceRaisedFor", "expectedImportance",
                "updatedId", "updatedContent", "updatedImportance",
                "expectedImportanceOf");

        for (String scenario : SCENARIOS) {
            for (JsonNode evalCase : load(scenario).path("cases")) {
                collectUnknown(evalCase.path("expect"), allowed,
                        evalCase.path("id").asText(""), scenario);
            }
        }
    }

    private void collectUnknown(JsonNode node, Set<String> allowed, String caseId, String scenario) {
        if (node.isObject()) {
            node.fieldNames().forEachRemaining(name -> {
                if (!"tasks".equals(name) && !"cards".equals(name) && !"created".equals(name)) {
                    assertThat(allowed)
                            .as("%s（%s）的期望字段 %s 不在白名单里——拼错的断言会被静默跳过", caseId, scenario, name)
                            .contains(name);
                }
            });
            node.fields().forEachRemaining(entry -> {
                if (entry.getValue().isObject() || entry.getValue().isArray()) {
                    collectUnknown(entry.getValue(), allowed, caseId, scenario);
                }
            });
        } else if (node.isArray()) {
            node.forEach(child -> collectUnknown(child, allowed, caseId, scenario));
        }
    }

    @Test
    void oversizedCasesActuallyExceedTheirLimit() throws IOException {
        // 真实教训：曾经有两条「超长字段」用例的输入根本没超过上限，
        // 于是「超长必须拒绝」的断言永远为真——用例是绿的，但什么都没验。
        // 这类空断言比失败更危险，所以在这里把「输入必须真的越界」本身变成断言。
        record Limit(String scenario, String caseId, String arrayField, String textField, int limit) {
        }
        List<Limit> limits = List.of(
                new Limit("task-extract", "TE-11-oversized-fields-truncated", "tasks", "title", 50),
                new Limit("task-extract", "TE-11-oversized-fields-truncated", "tasks", "description", 200),
                new Limit("daily-plan", "DP-16-oversized-fields-truncated", "items", "title", 50),
                new Limit("daily-plan", "DP-16-oversized-fields-truncated", "items", "note", 50),
                new Limit("memory-extract", "ME-09-oversized-content-rejected", "memories", "content", 200),
                new Limit("notice-extract", "NE-06-oversized-fields-truncated", "cards", "source", 20),
                new Limit("notice-extract", "NE-06-oversized-fields-truncated", "cards", "title", 50),
                new Limit("notice-extract", "NE-06-oversized-fields-truncated", "cards", "summary", 150),
                new Limit("notice-extract", "NE-06-oversized-fields-truncated", "cards", "requirement", 200));

        for (Limit check : limits) {
            JsonNode target = findCase(check.scenario(), check.caseId()).path("raw")
                    .path(check.arrayField()).path(0).path(check.textField());
            assertThat(target.isTextual())
                    .as("%s 的 %s[0].%s 不存在", check.caseId(), check.arrayField(), check.textField())
                    .isTrue();
            assertThat(target.asText().length())
                    .as("%s 的 %s[0].%s 只有 %d 字，没超过上限 %d——这条「超长」用例是空断言",
                            check.caseId(), check.arrayField(), check.textField(),
                            target.asText().length(), check.limit())
                    .isGreaterThan(check.limit());
        }

        // 顶层标量字段同样要真越界
        assertThat(findCase("query-plan", "QP-06-oversized-fields-truncated").path("raw").path("goal").asText().length())
                .as("QP-06 的 goal 未超过 50 字，截断断言是空断言")
                .isGreaterThan(50);
        assertThat(findCase("daily-plan", "DP-16-oversized-fields-truncated").path("raw").path("summary").asText().length())
                .as("DP-16 的 summary 未超过 50 字，截断断言是空断言")
                .isGreaterThan(50);
    }

    private JsonNode findCase(String scenario, String caseId) throws IOException {
        for (JsonNode evalCase : load(scenario).path("cases")) {
            if (caseId.equals(evalCase.path("id").asText())) {
                return evalCase;
            }
        }
        throw new AssertionError("找不到用例 " + caseId + "（" + scenario + "）");
    }

    private String prefixOf(String scenario) {
        return switch (scenario) {
            case "task-extract" -> "TE-";
            case "notice-extract" -> "NE-";
            case "daily-plan" -> "DP-";
            case "query-plan" -> "QP-";
            case "memory-extract" -> "ME-";
            default -> throw new IllegalArgumentException("未知场景：" + scenario);
        };
    }

    private JsonNode load(String scenario) throws IOException {
        String path = "model-eval/contracts/" + scenario + ".json";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
            assertThat(in).as("用例文件缺失：%s", path).isNotNull();
            return mapper.readTree(in.readAllBytes());
        }
    }
}
