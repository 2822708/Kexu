package com.timetable.config;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs the real V4 migration SQL against disposable databases, never the desktop user's database.
 */
class AiCampusAgentMigrationTest {

    @Test
    void freshInstallCreatesAgentTables() {
        Fixture db = database();
        db.migrate();

        assertThat(tableExists(db, "student_profile")).isTrue();
        assertThat(tableExists(db, "task")).isTrue();
        assertThat(tableExists(db, "student_memory")).isTrue();
        assertThat(tableExists(db, "daily_plan")).isTrue();
        // 新库没有任何待办，回填后 task 为空
        assertThat(db.sql.queryForObject("SELECT COUNT(*) FROM task", Integer.class)).isZero();
        assertThat(db.flyway.info().pending()).isEmpty();
    }

    @Test
    void legacyTodosAreBackfilledIntoTasksAndStayIdempotent() {
        Fixture db = database();
        new ResourceDatabasePopulator(new ClassPathResource("db/schema-h2.sql")).execute(db.source);
        db.sql.update("INSERT INTO api_key(api_key,label) VALUES ('legacy','Legacy user')");
        db.sql.update("INSERT INTO todo(api_key,title,ddl,completed) VALUES "
                + "('legacy','已完成的作业','2026-09-01 23:59',TRUE), "
                + "('legacy','逾期的实验报告','2026-09-10 23:59',FALSE), "
                + "('legacy','未来的网课','2027-01-01 23:59',FALSE)");

        db.migrate();

        assertThat(db.sql.queryForObject(
                "SELECT COUNT(*) FROM task WHERE source='LEGACY_TODO'", Integer.class)).isEqualTo(3);
        assertThat(db.sql.queryForObject(
                "SELECT status FROM task WHERE title='已完成的作业'", String.class)).isEqualTo("DONE");
        assertThat(db.sql.queryForObject(
                "SELECT priority FROM task WHERE title='逾期的实验报告'", Integer.class)).isEqualTo(1);
        assertThat(db.sql.queryForObject(
                "SELECT priority FROM task WHERE title='未来的网课'", Integer.class)).isEqualTo(2);
        assertThat(db.sql.queryForObject(
                "SELECT status FROM task WHERE title='未来的网课'", String.class)).isEqualTo("PENDING");
        assertThat(db.sql.queryForObject(
                "SELECT source_ref FROM task WHERE title='未来的网课'", String.class))
                .startsWith("todo:");

        // 重复执行迁移不会重复回填
        db.migrate();
        assertThat(db.sql.queryForObject(
                "SELECT COUNT(*) FROM task WHERE source='LEGACY_TODO'", Integer.class)).isEqualTo(3);
    }

    @Test
    void studentProfileIsUniquePerApiKey() {
        Fixture db = database();
        db.migrate();
        db.sql.update("INSERT INTO api_key(api_key,label) VALUES ('k1','User')");
        db.sql.update("INSERT INTO student_profile(api_key,interest,skills) VALUES ('k1','[]','[]')");
        assertThat(db.sql.queryForObject(
                "SELECT COUNT(*) FROM student_profile WHERE api_key='k1'", Integer.class)).isEqualTo(1);
        try {
            db.sql.update("INSERT INTO student_profile(api_key,interest,skills) VALUES ('k1','[]','[]')");
            throw new AssertionError("expected unique violation on student_profile.api_key");
        } catch (RuntimeException expected) {
            // 唯一约束生效：同一 api_key 只能有一条档案
        }
    }

    private static boolean tableExists(Fixture db, String table) {
        Integer count = db.sql.queryForObject("SELECT COUNT(*) FROM information_schema.tables "
                + "WHERE LOWER(table_name)=?", Integer.class, table);
        return count != null && count > 0;
    }

    private static Fixture database() {
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:agent_" + UUID.randomUUID().toString().replace("-", "")
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        source.setUser("sa");
        Flyway flyway = Flyway.configure().dataSource(source).baselineVersion("1")
                .locations("classpath:db/migration/h2").load();
        return new Fixture(source, new JdbcTemplate(source), flyway);
    }

    private record Fixture(JdbcDataSource source, JdbcTemplate sql, Flyway flyway) {
        void migrate() {
            new ValidatedFlywayMigration().validatedMigrationStrategy(source).migrate(flyway);
        }
    }
}
