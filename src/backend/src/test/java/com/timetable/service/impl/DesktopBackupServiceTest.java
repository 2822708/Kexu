package com.timetable.service.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.dto.BackupInfo;
import com.timetable.dto.BackupPreview;
import com.timetable.entity.ApiKey;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.ApiKeyMapper;
import com.timetable.security.AdminAuthorizationService;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.zip.ZipFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DesktopBackupServiceTest {
    @TempDir Path root;

    @Test
    void backupPreviewAndOfflineDatabaseRoundTripPreserveDataWithAuthorizationAndRetention() throws Exception {
        Path live = Files.createDirectories(root.resolve("live"));
        JdbcDataSource source = database(live);
        Flyway.configure().dataSource(source).locations("classpath:db/migration/h2").load().migrate();
        JdbcTemplate sql = new JdbcTemplate(source);
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES ('fixture-admin','Fixture','ADMIN')");
        sql.update("INSERT INTO schedule(api_key,name,period_start_date,period_end_date) "
                + "VALUES ('fixture-admin','Preserved semester','2026-09-01','2027-01-31')");
        ApiKeyMapper mapper = mock(ApiKeyMapper.class);
        ApiKey admin = new ApiKey();
        admin.setApiKey("fixture-admin");
        admin.setRole("ADMIN");
        when(mapper.selectById("fixture-admin")).thenReturn(admin);
        AdminAuthorizationService authorization = new AdminAuthorizationService(mapper, "");
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("standalone");
        DesktopBackupServiceImpl service = new DesktopBackupServiceImpl(source, new ObjectMapper(), authorization,
                Clock.fixed(Instant.now(), ZoneId.of("Asia/Shanghai")), environment, live.toString(), true, 2);

        assertThatThrownBy(() -> service.create("ordinary-account"))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(403);
        BackupInfo backup = service.create("fixture-admin");
        BackupPreview preview = service.preview(backup.name(), "fixture-admin");
        assertThat(preview.integrityVerified()).isTrue();
        assertThat(preview.sha256()).hasSize(64);
        assertThat(preview.databaseBytes()).isPositive();
        assertThat(preview.schemaVersion()).isEqualTo(Flyway.configure().dataSource(source)
                .locations("classpath:db/migration/h2").load().info().current().getVersion().toString());
        assertThatThrownBy(() -> service.download("../timetable.mv.db", "fixture-admin"))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(400);

        Path restored = Files.createDirectories(root.resolve("restored"));
        try (ZipFile archive = new ZipFile(service.download(backup.name(), "fixture-admin").toFile());
             InputStream input = archive.getInputStream(archive.getEntry("timetable.mv.db"))) {
            Files.copy(input, restored.resolve("timetable.mv.db"));
        }
        JdbcTemplate restoredSql = new JdbcTemplate(database(restored));
        assertThat(restoredSql.queryForObject("SELECT name FROM schedule", String.class)).isEqualTo("Preserved semester");
        assertThat(restoredSql.queryForObject("SELECT account_role FROM api_key", String.class)).isEqualTo("ADMIN");
        service.automaticBackup();
        assertThat(service.list("fixture-admin")).hasSize(1);
        service.create("fixture-admin");
        service.create("fixture-admin");
        assertThat(service.list("fixture-admin")).hasSize(2);
    }

    private static JdbcDataSource database(Path directory) {
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:file:" + directory.resolve("timetable").toString().replace('\\', '/')
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_ON_EXIT=FALSE");
        source.setUser("sa");
        return source;
    }
}
