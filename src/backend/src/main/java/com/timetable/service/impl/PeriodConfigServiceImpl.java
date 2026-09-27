package com.timetable.service.impl;

import com.timetable.dto.PeriodConfigRequest;
import com.timetable.entity.PeriodConfig;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.PeriodConfigMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.PeriodConfigService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PeriodConfigServiceImpl implements PeriodConfigService {

    private final PeriodConfigMapper periodConfigMapper;
    private final AdminAuthorizationService adminAuthorizationService;

    public PeriodConfigServiceImpl(PeriodConfigMapper periodConfigMapper,
                                   AdminAuthorizationService adminAuthorizationService) {
        this.periodConfigMapper = periodConfigMapper;
        this.adminAuthorizationService = adminAuthorizationService;
    }

    @Override
    public List<PeriodConfig> list() {
        return periodConfigMapper.selectList(null);
    }

    @Override
    @Transactional
    public List<PeriodConfig> update(PeriodConfigRequest request, String apiKey) {
        adminAuthorizationService.requireAdmin(apiKey);
        for (PeriodConfigRequest.PeriodItem item : request.getConfigs()) {
            if (!item.getEndTime().isAfter(item.getStartTime())) {
                throw new BusinessException(400,
                        "第 " + item.getPeriodNumber() + " 节的结束时间必须晚于开始时间");
            }
            PeriodConfig config = new PeriodConfig();
            config.setPeriodNumber(item.getPeriodNumber());
            config.setStartTime(item.getStartTime());
            config.setEndTime(item.getEndTime());
            config.setCategory(item.getCategory());
            periodConfigMapper.updateById(config);
        }
        return periodConfigMapper.selectList(null);
    }
}
