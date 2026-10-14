package com.timetable.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.timetable.entity.DailyPlan;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DailyPlanMapper extends BaseMapper<DailyPlan> {
}
