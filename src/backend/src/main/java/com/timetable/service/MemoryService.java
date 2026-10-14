package com.timetable.service;

import com.timetable.entity.Memory;

import java.util.List;

/**
 * 长期记忆（AI Campus Agent V1.0）。只存从对话中提炼的跨天有效事实，
 * 与 ai_message（原始聊天流水）严格分离。
 */
public interface MemoryService {

    /** 全部 ACTIVE 记忆，按 importance 降序、创建时间升序（稳定排序）。 */
    List<Memory> listActive(String apiKey);

    /** 上下文注入用：ACTIVE 记忆取前 limit 条。 */
    List<Memory> listTopActive(String apiKey, int limit);

    long countActive(String apiKey);

    /**
     * 写入一条记忆。type/content/importance 均做校验，非法输入抛 BusinessException。
     * source 为 AI（提炼提案执行）或 USER（设置页手动添加）。
     */
    Memory create(String apiKey, String type, String content, int importance, String source, String sourceRef);
}
