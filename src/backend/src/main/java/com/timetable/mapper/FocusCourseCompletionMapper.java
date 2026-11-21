package com.timetable.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.timetable.entity.FocusCourseCompletion;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface FocusCourseCompletionMapper extends BaseMapper<FocusCourseCompletion> {
    @Insert("""
            INSERT INTO focus_course_completion (api_key, schedule_id, course_id, occurrence_date)
            VALUES (#{apiKey}, #{scheduleId}, #{courseId}, #{occurrenceDate})
            ON DUPLICATE KEY UPDATE id = id
            """)
    void ensureCompleted(FocusCourseCompletion completion);
}
