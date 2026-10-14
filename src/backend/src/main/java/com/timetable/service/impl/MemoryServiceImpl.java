package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.entity.Memory;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.MemoryMapper;
import com.timetable.service.MemoryService;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class MemoryServiceImpl implements MemoryService {

    private static final Set<String> ALLOWED_TYPES = Set.of(
            Memory.TYPE_GOAL, Memory.TYPE_INTEREST, Memory.TYPE_ABILITY,
            Memory.TYPE_HABIT, Memory.TYPE_PREFERENCE);
    private static final int MAX_CONTENT_CHARS = 200;
    /** 重要度下限/上限，AI 与手动写入共用（1=随口一提，5=核心目标）。 */
    private static final int MIN_IMPORTANCE = 1;
    private static final int MAX_IMPORTANCE = 5;

    private final MemoryMapper mapper;

    public MemoryServiceImpl(MemoryMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * importance 降序；同重要度时「最近更新」优先——被反复确认/修正的事实更贴近当前，
     * 也保证同一批记忆在上下文被截断时，淘汰的总是最久没被提及的那条。
     * id 升序作为最终 tie-breaker，保证排序稳定（与指纹、分页结果一致）。
     */
    @Override
    public List<Memory> listActive(String apiKey) {
        return mapper.selectList(new LambdaQueryWrapper<Memory>()
                .eq(Memory::getApiKey, apiKey)
                .eq(Memory::getStatus, Memory.STATUS_ACTIVE)
                .orderByDesc(Memory::getImportance)
                .orderByDesc(Memory::getUpdatedAt)
                .orderByAsc(Memory::getId));
    }

    @Override
    public List<Memory> listTopActive(String apiKey, int limit) {
        List<Memory> active = listActive(apiKey);
        return active.size() <= limit ? active : active.subList(0, Math.max(0, limit));
    }

    @Override
    public long countActive(String apiKey) {
        return mapper.selectCount(new LambdaQueryWrapper<Memory>()
                .eq(Memory::getApiKey, apiKey)
                .eq(Memory::getStatus, Memory.STATUS_ACTIVE));
    }

    @Override
    public Memory create(String apiKey, String type, String content, int importance, String source, String sourceRef) {
        String safeType = requireType(type);
        String text = requireContent(content);
        int level = normalizeImportance(importance);

        // 查重：同一事实被反复提炼时（同一件事聊三轮）不产生第二条，只抬高重要度
        Memory existing = findDuplicate(apiKey, safeType, text, null);
        if (existing != null) {
            if (level > existing.getImportance()) {
                existing.setImportance(level);
                existing.setUpdatedAt(LocalDateTime.now());
                mapper.updateById(existing);
            }
            return existing;
        }
        requireCapacity(apiKey);

        Memory memory = new Memory();
        memory.setApiKey(apiKey);
        memory.setType(safeType);
        memory.setContent(text);
        memory.setImportance(level);
        memory.setStatus(Memory.STATUS_ACTIVE);
        memory.setSource(source);
        memory.setSourceRef(sourceRef);
        LocalDateTime now = LocalDateTime.now();
        memory.setCreatedAt(now);
        memory.setUpdatedAt(now);
        mapper.insert(memory);
        return memory;
    }

    @Override
    public Memory getById(Long id, String apiKey) {
        if (id == null || id <= 0) {
            throw new BusinessException(404, "记忆不存在");
        }
        Memory memory = mapper.selectById(id);
        if (memory == null || !apiKey.equals(memory.getApiKey())) {
            throw new BusinessException(404, "记忆不存在");
        }
        return memory;
    }

    @Override
    public Memory update(Long id, String apiKey, String type, String content, Integer importance) {
        Memory memory = getById(id, apiKey);
        String safeType = type == null || type.isBlank() ? memory.getType() : requireType(type);
        String text = content == null || content.isBlank() ? memory.getContent() : requireContent(content);
        int level = importance == null ? memory.getImportance() : normalizeImportance(importance);

        Memory duplicate = findDuplicate(apiKey, safeType, text, id);
        if (duplicate != null) {
            throw new BusinessException(409, "已存在相同的记忆，请先合并或删除重复项");
        }
        memory.setType(safeType);
        memory.setContent(text);
        memory.setImportance(level);
        memory.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(memory);
        return memory;
    }

    @Override
    public Memory supersede(Long id, String apiKey) {
        Memory memory = getById(id, apiKey);
        if (!Memory.STATUS_SUPERSEDED.equals(memory.getStatus())) {
            memory.setStatus(Memory.STATUS_SUPERSEDED);
            memory.setUpdatedAt(LocalDateTime.now());
            mapper.updateById(memory);
        }
        return memory;
    }

    @Override
    public void delete(Long id, String apiKey) {
        getById(id, apiKey);
        mapper.deleteById(id);
    }

    /**
     * 归一化：去掉空白与标点、英文转小写。
     * "准备 12 月 CET-6 考试" 与 "准备12月CET6考试！" 视为同一事实。
     */
    @Override
    public String normalize(String content) {
        if (content == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < content.length(); i++) {
            char ch = content.charAt(i);
            if (Character.isLetterOrDigit(ch)) {
                sb.append(Character.toLowerCase(ch));
            }
        }
        return sb.toString();
    }

    /**
     * 在同账号的 ACTIVE 记忆里找「同 type 且归一化内容相同」的记录。
     * excludeId 用于 update 时排除自身。
     */
    private Memory findDuplicate(String apiKey, String type, String content, Long excludeId) {
        String target = normalize(content);
        if (target.isEmpty()) {
            return null;
        }
        for (Memory memory : listActive(apiKey)) {
            if (excludeId != null && excludeId.equals(memory.getId())) {
                continue;
            }
            if (type.equals(memory.getType()) && target.equals(normalize(memory.getContent()))) {
                return memory;
            }
        }
        return null;
    }

    /** 容量治理：ACTIVE 记忆过多会持续抬高每次对话的 token 消耗，到顶即拒绝新增。 */
    private void requireCapacity(String apiKey) {
        if (countActive(apiKey) >= MAX_ACTIVE_MEMORIES) {
            throw new BusinessException(409, "长期记忆已达上限 " + MAX_ACTIVE_MEMORIES
                    + " 条，请到设置页清理后再继续记录");
        }
    }

    private String requireType(String type) {
        String safe = type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_TYPES.contains(safe)) {
            throw new BusinessException(400, "不支持的记忆类型: " + type);
        }
        return safe;
    }

    private String requireContent(String content) {
        String text = content == null ? "" : content.trim();
        if (text.isEmpty()) {
            throw new BusinessException(400, "记忆内容不能为空");
        }
        if (text.length() > MAX_CONTENT_CHARS) {
            throw new BusinessException(400, "记忆内容过长（最多 " + MAX_CONTENT_CHARS + " 字）");
        }
        return text;
    }

    private int normalizeImportance(int importance) {
        return Math.max(MIN_IMPORTANCE, Math.min(MAX_IMPORTANCE, importance));
    }
}
