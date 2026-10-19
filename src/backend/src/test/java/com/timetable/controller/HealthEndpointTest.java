package com.timetable.controller;

import com.timetable.TimetableApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 存活探针。
 *
 * <p>三条断言，每一条都对应一个真实的翻车方式：
 * <ol>
 *   <li>不带 Key 也要能访问——探针不可能知道 Key，要求鉴权就等于探针永远 401，
 *       平台会一直认为服务没起来；</li>
 *   <li>数据库正常时 200 + up；</li>
 *   <li>响应体不能包含连接串、账号、版本号之类的情报——这是公开地址。</li>
 * </ol>
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:health_probe;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=",
        "app.backup.enabled=false",
        "TANGENT_SETTINGS_ENCRYPTION_KEY=unit-test-master-key",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class HealthEndpointTest {

    @Autowired MockMvc mvc;

    @Test
    void probeWorksWithoutAnyApiKey() throws Exception {
        // 不设置 X-API-Key。若被拦截器挡住会拿到 401，这里就会失败。
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("up"))
                .andExpect(jsonPath("$.db").value("up"));
    }

    @Test
    void responseDoesNotLeakInternals() throws Exception {
        String body = mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // 探针是公开地址：连接串、驱动名、库用户名都不该出现
        org.assertj.core.api.Assertions.assertThat(body)
                .doesNotContainIgnoringCase("jdbc")
                .doesNotContainIgnoringCase("h2:")
                .doesNotContain("sa")
                .doesNotContainIgnoringCase("password")
                .doesNotContainIgnoringCase("exception");
    }
}
