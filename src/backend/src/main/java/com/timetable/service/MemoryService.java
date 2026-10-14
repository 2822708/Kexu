package com.timetable.service;

import com.timetable.entity.Memory;

import java.util.List;

/**
 * 长期记忆（AI Campus Agent V1.0）。只存从对话中提炼的跨天有效事实，
 * 与 ai_message（原始聊天流水）严格分离。
 *
 * Step 7 起具备去重与治理能力：写入路径统一走「同 type + 归一化内容」查重，
 * 因此同一事实被反复提炼时也只会有一条 ACTIVE 记录。
 */
public interface MemoryService {

    /** 单条记忆上限：超出后拒绝新增，避免上下文无限膨胀（设置页可清理后继续）。 */
    int MAX_ACTIVE_MEMORIES = 50;

    /** 全部 ACTIVE 记忆，按 importance 降序、最近更新优先（稳定排序）。 */
    List<Memory> listActive(String apiKey);

    /** 上下文注入用：ACTIVE 记忆取前 limit 条。 */
    List<Memory> listTopActive(String apiKey, int limit);

    long countActive(String apiKey);

    /**
     * 写入一条记忆。type/content/importance 均做校验，非法输入抛 BusinessException。
     * source 为 AI（提炼提案执行）或 USER（设置页手动添加）。
     *
     * 与已有 ACTIVE 记忆「同 type 且内容归一化后相同」时视为同一事实：
     * 不新增记录，只在 importance 更高时抬高它并返回已有记录。
     */
    Memory create(String apiKey, String type, String content, int importance, String source, String sourceRef);

    /** 取一条记忆并校验归属；不存在或非本人时抛 404。 */
    Memory getById(Long id, String apiKey);

    /**
     * 局部更新：type/content 为空表示保持原值，importance 为 null 表示保持原值。
     * 更新后若与另一条 ACTIVE 记忆重复，抛 409（提示用户去合并，而不是静默产生副本）。
     */
    Memory update(Long id, String apiKey, String type, String content, Integer importance);

    /** 软淘汰：状态置为 SUPERSEDED，不再进入上下文，但保留审计痕迹。 */
    Memory supersede(Long id, String apiKey);

    /** 彻底删除（设置页手动清理）。 */
    void delete(Long id, String apiKey);

    /** 内容归一化：用于查重比较。空白与标点差异视为同一内容。 */
    String normalize(String content);
}
