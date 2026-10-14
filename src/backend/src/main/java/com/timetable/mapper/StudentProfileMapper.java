package com.timetable.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.timetable.entity.StudentProfile;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface StudentProfileMapper extends BaseMapper<StudentProfile> {
}
