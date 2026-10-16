package com.timetable.service;

import com.timetable.entity.AiEvent;
import com.timetable.mapper.AiEventMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 用户行为事件落库入口（成本治理 P0-1）。
 *
 * <p>与 {@link LlmUsageRecorder} 同一条原则：**埋点绝不影响业务**。这里抛异常会让
 * 用户「点了确认却没反应」，代价完全不对等，所以全部吞掉记日志。
 */
@Service
public class AiEventRecorder {

    private static final Logger log = LoggerFactory.getLogger(AiEventRecorder.class);

    private final AiEventMapper eventMapper;

    public AiEventRecorder(AiEventMapper eventMapper) {
        this.eventMapper = eventMapper;
    }

    public void record(String apiKey, String eventType, String scene, String actionType, Long refId) {
        if (apiKey == null || apiKey.isBlank() || eventType == null || eventType.isBlank()) {
            return;
        }
        try {
            AiEvent event = new AiEvent();
            event.setApiKey(apiKey);
            event.setEventType(eventType);
            event.setScene(scene);
            event.setActionType(actionType);
            event.setRefId(refId);
            event.setCreatedAt(LocalDateTime.now());
            eventMapper.insert(event);
        } catch (Exception e) {
            log.warn("记录用户行为事件失败（已忽略，不影响业务）：{}", e.getClass().getSimpleName());
        }
    }
}