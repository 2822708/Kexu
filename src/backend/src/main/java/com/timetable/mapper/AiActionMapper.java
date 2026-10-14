package com.timetable.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.timetable.entity.AiAction;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface AiActionMapper extends BaseMapper<AiAction> {

    @Update("UPDATE ai_action SET action_status = 'EXECUTING' "
            + "WHERE id = #{id} AND api_key = #{apiKey} AND action_status = 'PENDING'")
    int claimPending(@Param("id") Long id, @Param("apiKey") String apiKey);
}
