package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.entity.Memory;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.MemoryMapper;
import com.timetable.service.MemoryService;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

@Service
public class MemoryServiceImpl implements MemoryService {

    private static final Set<String> ALLOWED_TYPES = Set.of(
            Memory.TYPE_GOAL, Memory.TYPE_INTEREST, Memory.TYPE_ABILITY,
            Memory.TYPE_HABIT, Memory.TYPE_PREFERENCE);
    private static final int MAX_CONTENT_CHARS = 200;

    private final MemoryMapper mapper;

    public MemoryServiceImpl(MemoryMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public List<Memory> listActive(String apiKey) {
        return mapper.selectList(new LambdaQueryWrapper<Memory>()
                .eq(Memory::getApiKey, apiKey)
                .eq(Memory::getStatus, Memory.STATUS_ACTIVE)
                .orderByDesc(Memory::getImportance)
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
        if (!ALLOWED_TYPES.contains(type)) {
            throw new BusinessException(400, "不支持的记忆类型: " + type);
        }
        String text = content == null ? "" : content.trim();
        if (text.isEmpty()) {
            throw new BusinessException(400, "记忆内容不能为空");
        }
        if (text.length() > MAX_CONTENT_CHARS) {
            throw new BusinessException(400, "记忆内容过长（最多 " + MAX_CONTENT_CHARS + " 字）");
        }
        int level = Math.max(1, Math.min(5, importance));
        Memory memory = new Memory();
        memory.setApiKey(apiKey);
        memory.setType(type);
        memory.setContent(text);
        memory.setImportance(level);
        memory.setStatus(Memory.STATUS_ACTIVE);
        memory.setSource(source);
        memory.setSourceRef(sourceRef);
        memory.setCreatedAt(LocalDateTime.now());
        memory.setUpdatedAt(LocalDateTime.now());
        mapper.insert(memory);
        return memory;
    }
}
