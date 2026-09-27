package com.timetable.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Safely adopts databases created by the previous CREATE TABLE IF NOT EXISTS setup.
 * A non-empty schema is baselined only after all legacy tables and columns are present.
 */
@Configuration
public class ValidatedFlywayMigration {

    private static final Logger log = LoggerFactory.getLogger(ValidatedFlywayMigration.class);

    private static final Map<String, Set<String>> LEGACY_COLUMNS = legacyColumns();

    @Bean
    FlywayMigrationStrategy validatedMigrationStrategy(DataSource dataSource) {
        return flyway -> {
            try {
                if (!tableExists(dataSource, "flyway_schema_history")) {
                    Set<String> tables = applicationTables(dataSource);
                    if (!tables.isEmpty()) {
                        validateLegacySchema(dataSource, tables);
                        flyway.baseline();
                        log.info("Validated and baselined the existing Tangent-Timetable schema at version 1");
                    } else if (hasUnknownTables(dataSource)) {
                        throw new IllegalStateException(
                                "Database is non-empty but is not a recognized Tangent-Timetable schema; "
                                        + "refusing to baseline it automatically");
                    }
                }
                flyway.migrate();
            } catch (SQLException e) {
                throw new IllegalStateException("Unable to inspect the database before Flyway migration", e);
            }
        };
    }

    private static void validateLegacySchema(DataSource dataSource, Set<String> tables) throws SQLException {
        if (!tables.containsAll(LEGACY_COLUMNS.keySet())) {
            Set<String> missing = new HashSet<>(LEGACY_COLUMNS.keySet());
            missing.removeAll(tables);
            throw new IllegalStateException("Existing database is missing legacy tables " + missing
                    + "; refusing to baseline it automatically");
        }

        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData metadata = connection.getMetaData();
            String catalog = connection.getCatalog();
            String schema = connection.getSchema();
            Map<String, String> tableNames = tableNames(connection);
            for (Map.Entry<String, Set<String>> expected : LEGACY_COLUMNS.entrySet()) {
                Set<String> columns = new HashSet<>();
                // JDBC patterns are case-sensitive on H2's default uppercase identifiers.
                // Use the physical spelling returned by metadata instead of the logical name.
                try (ResultSet result = metadata.getColumns(catalog, schema,
                        tableNames.get(expected.getKey()), null)) {
                    while (result.next()) {
                        columns.add(result.getString("COLUMN_NAME").toLowerCase(Locale.ROOT));
                    }
                }
                if (!columns.containsAll(expected.getValue())) {
                    Set<String> missing = new HashSet<>(expected.getValue());
                    missing.removeAll(columns);
                    throw new IllegalStateException("Existing table " + expected.getKey()
                            + " is missing columns " + missing + "; refusing to baseline it automatically");
                }
            }
        }
    }

    private static Set<String> applicationTables(DataSource dataSource) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            Set<String> tables = new HashSet<>(tableNames(connection).keySet());
            tables.retainAll(LEGACY_COLUMNS.keySet());
            return tables;
        }
    }

    private static boolean hasUnknownTables(DataSource dataSource) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return tableNames(connection).keySet().stream()
                    .anyMatch(table -> !"flyway_schema_history".equals(table));
        }
    }

    private static boolean tableExists(DataSource dataSource, String tableName) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return tableNames(connection).containsKey(tableName.toLowerCase(Locale.ROOT));
        }
    }

    private static Map<String, String> tableNames(Connection connection) throws SQLException {
        Map<String, String> names = new HashMap<>();
        // Inspect only the connected schema, so an unrelated schema cannot satisfy adoption checks.
        try (ResultSet result = connection.getMetaData().getTables(connection.getCatalog(),
                connection.getSchema(), "%", new String[]{"TABLE"})) {
            while (result.next()) {
                if ("INFORMATION_SCHEMA".equalsIgnoreCase(result.getString("TABLE_SCHEM"))) {
                    continue;
                }
                String physicalName = result.getString("TABLE_NAME");
                names.put(physicalName.toLowerCase(Locale.ROOT), physicalName);
            }
        }
        return names;
    }

    private static Map<String, Set<String>> legacyColumns() {
        Map<String, Set<String>> result = new HashMap<>();
        result.put("api_key", columns("api_key", "label", "avatar_url", "created_at"));
        result.put("schedule", columns("id", "api_key", "name", "period_start_date", "period_end_date", "created_at", "updated_at"));
        result.put("period_config", columns("period_number", "start_time", "end_time", "category"));
        result.put("course", columns("id", "schedule_id", "name", "location", "teacher", "day_of_week", "start_period", "end_period", "weeks", "created_at", "updated_at"));
        result.put("exam", columns("id", "schedule_id", "name", "location", "exam_date", "start_time", "end_time", "created_at", "updated_at"));
        result.put("todo", columns("id", "api_key", "title", "ddl", "completed", "recurring_id", "exam_id", "created_at", "updated_at"));
        result.put("ai_conversation", columns("id", "api_key", "schedule_id", "title", "created_at", "updated_at"));
        result.put("ai_message", columns("id", "conversation_id", "role", "content", "created_at"));
        result.put("ai_action", columns("id", "message_id", "api_key", "scope", "action_type", "action_status", "action_data", "data_fingerprint", "sort_order", "created_at"));
        result.put("recurring_todo", columns("id", "api_key", "title", "frequency", "day_of_week", "day_of_month", "trigger_time", "script", "ddl_offset_minutes", "enabled", "chain_after_complete", "last_triggered_at", "next_trigger_at", "created_at", "updated_at"));
        return Map.copyOf(result);
    }

    private static Set<String> columns(String... names) {
        return Set.copyOf(Arrays.asList(names));
    }
}
