package com.timetable.config;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Runs the real SQL against disposable databases, never the desktop user's database. */
class ValidatedFlywayMigrationTest {

    @Test
    void freshInstallRunsEveryMigrationAndIsRestartSafe() {
        Fixture db = database(true);
        db.migrate();
        db.sql.update("INSERT INTO api_key(api_key,label) VALUES ('test-key','Fresh user')");
        assertThat(db.sql.queryForObject("SELECT account_role FROM api_key", String.class)).isEqualTo("USER");
        assertThat(db.sql.queryForObject("SELECT COUNT(*) FROM period_config", Integer.class)).isEqualTo(12);
        db.migrate();
        assertThat(db.sql.queryForObject("SELECT COUNT(*) FROM api_key", Integer.class)).isEqualTo(1);
        assertThat(db.flyway.info().pending()).isEmpty();
        assertThat(db.flyway.validateWithResult().validationSuccessful).isTrue();
    }

    @Test
    void legacyUpgradePreservesRecordsAndBackfillsActionWorkspace() {
        Fixture db = database(true);
        legacySchema(db);
        db.sql.update("INSERT INTO api_key(api_key,label) VALUES ('legacy','Tangent0712'), ('ordinary','Ordinary')");
        db.sql.update("INSERT INTO schedule(id,api_key,name,period_start_date,period_end_date) "
                + "VALUES (11,'legacy','Legacy semester','2026-09-01','2027-01-31')");
        db.sql.update("INSERT INTO ai_conversation(id,api_key,schedule_id,title) VALUES (21,'legacy',11,'Kept')");
        db.sql.update("INSERT INTO ai_message(id,conversation_id,role,content) VALUES (31,21,'assistant','Kept')");
        db.sql.update("INSERT INTO ai_action(id,message_id,api_key,scope,action_type,action_status) "
                + "VALUES (41,31,'legacy','COURSE','CREATE_COURSE','PENDING'), "
                + "(42,31,'legacy','TODO','CREATE_TODO','PENDING')");

        db.migrate();
        assertThat(db.sql.queryForObject("SELECT account_role FROM api_key WHERE api_key='legacy'", String.class))
                .isEqualTo("ADMIN");
        assertThat(db.sql.queryForObject("SELECT account_role FROM api_key WHERE api_key='ordinary'", String.class))
                .isEqualTo("USER");
        assertThat(db.sql.queryForObject("SELECT schedule_id FROM ai_action WHERE id=41", Long.class)).isEqualTo(11L);
        assertThat(db.sql.queryForObject("SELECT schedule_id FROM ai_action WHERE id=42", Long.class)).isNull();
        assertThat(db.sql.queryForObject("SELECT name FROM schedule WHERE id=11", String.class)).isEqualTo("Legacy semester");
        assertThat(db.flyway.info().pending()).isEmpty();
    }

    @Test
    void legacyMetadataAlsoWorksWithH2DefaultUppercaseIdentifiers() {
        Fixture db = database(false);
        legacySchema(db);
        db.migrate();
        assertThat(db.flyway.info().pending()).isEmpty();
    }

    @Test
    void unknownDatabaseIsRejectedWithoutCreatingHistoryOrChangingData() {
        Fixture db = database(true);
        db.sql.execute("CREATE TABLE unrelated (id INT PRIMARY KEY, note VARCHAR(30))");
        db.sql.update("INSERT INTO unrelated VALUES (1,'preserve me')");
        assertThatThrownBy(db::migrate).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("refusing to baseline");
        assertThat(db.sql.queryForObject("SELECT note FROM unrelated", String.class)).isEqualTo("preserve me");
        assertThat(historyCount(db)).isZero();
    }

    @Test
    void partialLegacyDatabaseIsRejectedBeforeAnyMigration() {
        Fixture db = database(true);
        db.sql.execute("CREATE TABLE api_key(api_key VARCHAR(64) PRIMARY KEY,label VARCHAR(50))");
        assertThatThrownBy(db::migrate).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("missing legacy tables");
        assertThat(historyCount(db)).isZero();
    }

    @Test
    void missingLegacyColumnIsRejectedBeforeBaselining() {
        Fixture db = database(true);
        legacySchema(db);
        db.sql.execute("ALTER TABLE ai_action DROP COLUMN data_fingerprint");
        assertThatThrownBy(db::migrate).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("data_fingerprint");
        assertThat(historyCount(db)).isZero();
    }

    private static int historyCount(Fixture db) {
        return db.sql.queryForObject("SELECT COUNT(*) FROM information_schema.tables "
                + "WHERE LOWER(table_name)='flyway_schema_history'", Integer.class);
    }

    private static void legacySchema(Fixture db) {
        new ResourceDatabasePopulator(new ClassPathResource("db/schema-h2.sql")).execute(db.source);
    }

    private static Fixture database(boolean lowerCase) {
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:migration_" + UUID.randomUUID().toString().replace("-", "")
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1" + (lowerCase ? ";DATABASE_TO_LOWER=TRUE" : ""));
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
