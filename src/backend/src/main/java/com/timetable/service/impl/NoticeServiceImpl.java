package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.timetable.dto.NoticeDraft;
import com.timetable.dto.NoticeExtractResult;
import com.timetable.dto.TaskDraft;
import com.timetable.entity.LlmUsage;
import com.timetable.entity.NoticeCard;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.NoticeCardMapper;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.NoticeService;
import com.timetable.service.TaskService;
import com.timetable.service.impl.PromptTemplateRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class NoticeServiceImpl implements NoticeService {

    private static final Logger log = LoggerFactory.getLogger(NoticeServiceImpl.class);

    private static final String[] WEEKDAY_LABELS = {"一", "二", "三", "四", "五", "六", "日"};

    /** 一次提炼的卡片上限：群公告动辄几百条，不设上限会把列表淹掉。 */
    private static final int MAX_CARDS = 10;
    private static final int MAX_BATCH = 10;
    private static final int MAX_TITLE_CHARS = 50;
    private static final int MAX_SUMMARY_CHARS = 150;
    private static final int MAX_REQUIREMENT_CHARS = 200;
    private static final int MAX_SOURCE_CHARS = 20;

    /**
     * 来源降权阈值：某来源的历史忽略率超过这个值，它的新卡片排到待阅列表后面。
     *
     * <p><b>这是显式规则，不是学习模型。</b>没有权重训练、不更新用户画像、不跨用户统计。
     * 用户点了「忽略」就期望同类信息少打扰，用一条 SQL 聚合比养一个模型更可解释，
     * 也更容易在设置页里改成开关。
     */
    private static final double SOURCE_MUTE_IGNORE_RATE = 0.5;
    /** 样本量下限：忽略 1 次就降权太激进，至少忽略过 2 条才参与计算。 */
    private static final int SOURCE_MUTE_MIN_DECIDED = 2;

    private static final int SNOOZE_MIN_HOURS = 1;
    private static final int SNOOZE_MAX_HOURS = 72;

    private final NoticeCardMapper mapper;
    private final TaskService taskService;
    private final PromptTemplateRegistry promptTemplates;
    private final LlmClientRegistry llmClients;
    private final Clock clock;

    public NoticeServiceImpl(NoticeCardMapper mapper, TaskService taskService,
                             PromptTemplateRegistry promptTemplates,
                             LlmClientRegistry llmClients, Clock clock) {
        this.mapper = mapper;
        this.taskService = taskService;
        this.promptTemplates = promptTemplates;
        this.llmClients = llmClients;
        this.clock = clock;
    }

    @Override
    public NoticeExtractResult extract(String text, String apiKey) {
        if (text == null || text.isBlank()) {
            throw new BusinessException(400, "请提供要提炼的材料文本");
        }
        PromptTemplateRegistry.PromptTemplate template = promptTemplates.get("notice-extract");
        if (template == null || template.body().isBlank()) {
            throw new BusinessException(503, "通知提炼能力暂未配置，请稍后重试");
        }
        LlmClient client = llmClients.forScene(LlmUsage.SCENE_INBOX);
        if (!client.isConfigured()) {
            throw new BusinessException(503, "AI 尚未配置，暂时不能提炼通知");
        }

        LocalDate today = LocalDate.now(clock);
        String systemPrompt = template.body()
                + "\n\n当前日期：" + today + "（星期" + WEEKDAY_LABELS[today.getDayOfWeek().getValue() - 1] + "）";

        JsonNode root;
        try {
            List<LlmClient.Message> payload = List.of(
                    new LlmClient.Message("system", systemPrompt),
                    new LlmClient.Message("user", text.trim()));
            root = parseJson(client.chatJson(LlmUsage.SCENE_INBOX, payload));
        } catch (BusinessException e) {
            // 已知错误（未配置 / 限流 / 供应商故障）原样透传，前端展示具体原因
            throw e;
        } catch (Exception e) {
            log.warn("通知提炼失败（不影响其他功能）: {}", e.toString());
            NoticeExtractResult failed = new NoticeExtractResult();
            failed.setNote("AI 提炼失败，请稍后重试，或手动添加通知");
            return failed;
        }
        return toExtractResult(root, today);
    }

    private NoticeExtractResult toExtractResult(JsonNode root, LocalDate today) {
        NoticeExtractResult result = new NoticeExtractResult();
        List<NoticeDraft> drafts = new ArrayList<>();
        int skipped = 0;
        JsonNode cardsNode = root.path("cards");
        if (cardsNode.isArray()) {
            for (JsonNode node : cardsNode) {
                if (drafts.size() >= MAX_CARDS) {
                    skipped += cardsNode.size() - MAX_CARDS;
                    break;
                }
                NoticeDraft draft = toDraft(node, today);
                if (draft == null) {
                    skipped++;
                } else {
                    drafts.add(draft);
                }
            }
        }
        result.setCards(drafts);
        double confidence = root.path("confidence").isNumber() ? root.path("confidence").asDouble() : 0.0;
        result.setConfidence(drafts.isEmpty() ? 0.0 : Math.max(0.0, Math.min(1.0, confidence)));

        List<String> notes = new ArrayList<>();
        String modelNote = root.path("note").asText("");
        if (!modelNote.isBlank()) {
            notes.add(modelNote);
        }
        if (drafts.isEmpty()) {
            notes.add("没有从材料中提炼出值得知道的通知，可手动添加");
        }
        if (skipped > 0) {
            notes.add("已忽略 " + skipped + " 条信息不完整的提炼结果");
        }
        result.setNote(String.join("；", notes));
        return result;
    }

    /** 单条草稿清洗：空标题丢弃；relevance 钳制 1-3；超长截断。 */
    private NoticeDraft toDraft(JsonNode node, LocalDate today) {
        if (node == null || !node.isObject()) {
            return null;
        }
        String title = node.path("title").asText("").trim();
        if (title.isBlank()) {
            return null;
        }
        NoticeDraft draft = new NoticeDraft();
        draft.setTitle(truncate(title, MAX_TITLE_CHARS));
        String source = node.path("source").asText("").trim();
        draft.setSource(source.isEmpty() ? "未标注来源" : truncate(source, MAX_SOURCE_CHARS));
        draft.setSummary(truncate(node.path("summary").asText("").trim(), MAX_SUMMARY_CHARS));
        draft.setRequirement(truncate(node.path("requirement").asText("").trim(), MAX_REQUIREMENT_CHARS));
        draft.setKeyTime(parseKeyTime(node.path("keyTime"), today));
        int relevance = node.path("relevance").isInt()
                ? node.path("relevance").asInt() : NoticeCard.RELEVANCE_MEDIUM;
        draft.setRelevance(Math.max(NoticeCard.RELEVANCE_HIGH,
                Math.min(NoticeCard.RELEVANCE_LOW, relevance)));
        return draft;
    }

    /**
     * 解析模型给出的关键时间：接受 "yyyy-MM-dd HH:mm" / ISO "T" 分隔 / 纯日期（按当天 23:59）。
     * 无法解析、早于今天或模型输出 null 一律返回 null——服务端绝不猜测时间。
     *
     * <p>注意：通知的「关键时间」可能是活动时间而非截止时间，过去的活动同样没有提醒价值，
     * 所以这里沿用与任务抽取一致的「过去一律 null」规则。
     */
    private LocalDateTime parseKeyTime(JsonNode node, LocalDate today) {
        if (node == null || !node.isTextual()) {
            return null;
        }
        String raw = node.asText("").trim();
        if (raw.isEmpty()) {
            return null;
        }
        try {
            LocalDateTime dateTime;
            if (raw.length() == 10) {
                dateTime = LocalDate.parse(raw).atTime(23, 59);
            } else {
                String normalized = raw.replace(' ', 'T');
                if (normalized.length() == 16) {
                    normalized = normalized + ":00";
                }
                dateTime = LocalDateTime.parse(normalized);
            }
            return dateTime.toLocalDate().isBefore(today) ? null : dateTime;
        } catch (RuntimeException unparseable) {
            return null;
        }
    }

    private static String truncate(String value, int max) {
        return value.length() > max ? value.substring(0, max) : value;
    }

    private JsonNode parseJson(String raw) throws Exception {
        return new com.fasterxml.jackson.databind.ObjectMapper().readTree(raw);
    }

    @Override
    @Transactional
    public List<NoticeCard> create(String apiKey, List<NoticeDraft> drafts) {
        if (drafts == null || drafts.isEmpty()) {
            throw new BusinessException(400, "通知列表不能为空");
        }
        if (drafts.size() > MAX_BATCH) {
            throw new BusinessException(400, "一次最多创建 " + MAX_BATCH + " 条通知");
        }
        LocalDateTime now = LocalDateTime.now(clock);
        List<NoticeCard> created = new ArrayList<>(drafts.size());
        for (NoticeDraft draft : drafts) {
            if (draft == null || draft.getTitle() == null || draft.getTitle().isBlank()) {
                throw new BusinessException(400, "通知标题不能为空");
            }
            NoticeCard card = new NoticeCard();
            card.setApiKey(apiKey);
            card.setSource(draft.getSource() == null || draft.getSource().isBlank()
                    ? "未标注来源" : truncate(draft.getSource().trim(), MAX_SOURCE_CHARS));
            card.setTitle(truncate(draft.getTitle().trim(), MAX_TITLE_CHARS));
            card.setSummary(blankToNull(draft.getSummary()));
            card.setRequirement(blankToNull(draft.getRequirement()));
            card.setKeyTime(draft.getKeyTime());
            card.setRelevance(draft.getRelevance() == null ? NoticeCard.RELEVANCE_MEDIUM : draft.getRelevance());
            card.setStatus(NoticeCard.STATUS_PENDING);
            card.setCreatedAt(now);
            card.setUpdatedAt(now);
            mapper.insert(card);
            created.add(card);
        }
        return created;
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    @Override
    public List<NoticeCard> listToday(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return List.of();
        }
        LocalDateTime now = LocalDateTime.now(clock);
        List<NoticeCard> pending = mapper.selectList(new LambdaQueryWrapper<NoticeCard>()
                .eq(NoticeCard::getApiKey, apiKey)
                .eq(NoticeCard::getStatus, NoticeCard.STATUS_PENDING)
                // 「稍后提醒」未到期的先藏起来：snooze_until 为空表示没有设置过
                .and(w -> w.isNull(NoticeCard::getSnoozeUntil)
                        .or().le(NoticeCard::getSnoozeUntil, now))
                .orderByAsc(NoticeCard::getCreatedAt));
        return sortByRelevanceThenMutedSource(pending, apiKey);
    }

    @Override
    public List<NoticeCard> listRecent(String apiKey, int limit) {
        if (apiKey == null || apiKey.isBlank()) {
            return List.of();
        }
        int safeLimit = Math.max(1, Math.min(20, limit));
        return mapper.selectList(new LambdaQueryWrapper<NoticeCard>()
                .eq(NoticeCard::getApiKey, apiKey)
                .orderByDesc(NoticeCard::getCreatedAt)
                .orderByDesc(NoticeCard::getId)
                .last("LIMIT " + safeLimit));
    }

    /**
     * 排序：关联度升序（1 高在前）→ 来源未降权在前 → 时间早的在前 → id。
     *
     * <p>降权只影响**顺序**，不隐藏任何卡片——用户没说「别再给我看」，
     * 只是「别老推这个」。把卡片藏起来会让用户误以为信息丢了。
     */
    private List<NoticeCard> sortByRelevanceThenMutedSource(List<NoticeCard> cards, String apiKey) {
        Map<String, Boolean> muted = mutedSources(apiKey);
        List<NoticeCard> sorted = new ArrayList<>(cards);
        sorted.sort(Comparator
                .comparing((NoticeCard c) -> c.getRelevance() == null
                        ? NoticeCard.RELEVANCE_MEDIUM : c.getRelevance())
                .thenComparing(c -> Boolean.TRUE.equals(muted.get(c.getSource())) ? 1 : 0)
                .thenComparing(c -> c.getKeyTime(), Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(NoticeCard::getId, Comparator.nullsLast(Comparator.naturalOrder())));
        return sorted;
    }

    /**
     * 计算被降权的来源：历史忽略率超过阈值且样本量够。
     *
     * <p>只统计 IGNORED / DONE 两种「已决定」状态——PENDING 的卡片还没被看过，
     * 不该参与降权计算，否则用户刚导入一批通知、还没来得及看，
     * 新通知就被「降权」了，这是典型的用未决策数据去惩罚用户。
     */
    private Map<String, Boolean> mutedSources(String apiKey) {
        List<NoticeCard> decided = mapper.selectList(new LambdaQueryWrapper<NoticeCard>()
                .eq(NoticeCard::getApiKey, apiKey)
                .in(NoticeCard::getStatus, List.of(NoticeCard.STATUS_IGNORED, NoticeCard.STATUS_DONE)));
        Map<String, Integer> ignored = new HashMap<>();
        Map<String, Integer> total = new HashMap<>();
        for (NoticeCard card : decided) {
            String source = card.getSource();
            total.merge(source, 1, Integer::sum);
            if (NoticeCard.STATUS_IGNORED.equals(card.getStatus())) {
                ignored.merge(source, 1, Integer::sum);
            }
        }
        Map<String, Boolean> muted = new HashMap<>();
        total.forEach((source, count) -> {
            if (count >= SOURCE_MUTE_MIN_DECIDED) {
                int ignoredCount = ignored.getOrDefault(source, 0);
                if (ignoredCount / (double) count > SOURCE_MUTE_IGNORE_RATE) {
                    muted.put(source, true);
                }
            }
        });
        return muted;
    }

    @Override
    @Transactional
    public NoticeCard toTask(Long id, String apiKey, TaskDraft draft) {
        NoticeCard card = get(id, apiKey);
        if (NoticeCard.STATUS_DONE.equals(card.getStatus())) {
            throw new BusinessException(400, "这条通知已经加入过日程了");
        }
        if (draft == null || draft.getTitle() == null || draft.getTitle().isBlank()) {
            // 用户没改草稿就确认 → 用卡片标题兜底，避免弹出「标题不能为空」这种废话
            TaskDraft fallback = new TaskDraft();
            fallback.setTitle(card.getTitle());
            fallback.setDescription(card.getSummary());
            fallback.setDeadline(card.getKeyTime());
            fallback.setType(Task.TYPE_OTHER);
            fallback.setPriority(Task.PRIORITY_MEDIUM);
            draft = fallback;
        }
        taskService.create(apiKey, draft, Task.SOURCE_AI_PARSE, "notice:" + card.getId());
        card.setStatus(NoticeCard.STATUS_DONE);
        card.setUpdatedAt(LocalDateTime.now(clock));
        mapper.updateById(card);
        return card;
    }

    @Override
    public NoticeCard ignore(Long id, String apiKey) {
        NoticeCard card = get(id, apiKey);
        card.setStatus(NoticeCard.STATUS_IGNORED);
        card.setSnoozeUntil(null);
        card.setUpdatedAt(LocalDateTime.now(clock));
        mapper.updateById(card);
        return card;
    }

    @Override
    public NoticeCard snooze(Long id, String apiKey, int hours) {
        if (hours < SNOOZE_MIN_HOURS || hours > SNOOZE_MAX_HOURS) {
            throw new BusinessException(400,
                    "稍后提醒的时长必须在 " + SNOOZE_MIN_HOURS + " 到 " + SNOOZE_MAX_HOURS + " 小时之间");
        }
        NoticeCard card = get(id, apiKey);
        card.setSnoozeUntil(LocalDateTime.now(clock).plusHours(hours));
        card.setUpdatedAt(LocalDateTime.now(clock));
        mapper.updateById(card);
        return card;
    }

    @Override
    public NoticeCard remove(Long id, String apiKey) {
        NoticeCard card = get(id, apiKey);
        mapper.deleteById(card.getId());
        return card;
    }

    /**
     * 单条读取并校验归属。归属不符抛 <b>404 而不是 403</b>——
     * 返回 403 等于告诉对方「这条数据存在但不是你的」，会泄露存在性。
     */
    private NoticeCard get(Long id, String apiKey) {
        if (id == null) {
            throw new BusinessException(400, "通知 id 不能为空");
        }
        NoticeCard card = mapper.selectById(id);
        if (card == null || !apiKey.equals(card.getApiKey())) {
            throw new BusinessException(404, "通知不存在");
        }
        return card;
    }
}
