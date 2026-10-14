package com.timetable.service.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.dto.BackupInfo;
import com.timetable.dto.BackupPreview;
import com.timetable.dto.BackupStatus;
import com.timetable.exception.BusinessException;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.DesktopBackupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/** Uses H2's consistent BACKUP command. Archive inspection never opens or executes a backup DB. */
@Service
public class DesktopBackupServiceImpl implements DesktopBackupService {
    private static final Logger log = LoggerFactory.getLogger(DesktopBackupServiceImpl.class);
    private static final String MANIFEST = "tangent-backup.json";
    private static final String DATABASE = "timetable.mv.db";
    private static final long MAX_DATABASE_BYTES = 1024L * 1024 * 1024;
    private static final Pattern NAME = Pattern.compile("tangent-backup-[0-9]{8}-[0-9]{6}-[a-f0-9]{32}\\.zip");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private final DataSource dataSource;
    private final ObjectMapper json;
    private final AdminAuthorizationService authorization;
    private final Clock clock;
    private final Path directory;
    private final boolean enabled;
    private final int retention;
    private volatile Instant lastSuccess;
    private volatile String lastError;

    public DesktopBackupServiceImpl(DataSource dataSource, ObjectMapper json,
                                    AdminAuthorizationService authorization, Clock clock,
                                    Environment environment,
                                    @Value("${app.data-dir:~/.tangent-timetable}") String dataDir,
                                    @Value("${app.backup.enabled:true}") boolean enabled,
                                    @Value("${app.backup.retention:7}") int retention) {
        this.dataSource = dataSource;
        this.json = json;
        this.authorization = authorization;
        this.clock = clock;
        String expanded = dataDir.startsWith("~/") || dataDir.startsWith("~\\")
                ? System.getProperty("user.home") + dataDir.substring(1) : dataDir;
        this.directory = Path.of(expanded).toAbsolutePath().normalize().resolve("backups");
        this.enabled = enabled && environment.acceptsProfiles(Profiles.of("standalone"));
        this.retention = Math.max(2, Math.min(retention, 50));
    }

    @Override
    public BackupStatus status(String apiKey) {
        authorization.requireAdmin(apiKey);
        return new BackupStatus(enabled, retention, lastSuccess, lastError,
                enabled ? "本机数据库每天自动备份；恢复前须关闭桌面程序。"
                        : "数据库备份仅适用于桌面 standalone 模式；Web 部署请使用数据库运维备份。" );
    }

    @Override
    public synchronized List<BackupInfo> list(String apiKey) {
        requireAvailable(apiKey);
        try {
            return listInternal();
        } catch (IOException e) {
            throw failure("读取备份列表失败", e);
        }
    }

    @Override
    public synchronized BackupInfo create(String apiKey) {
        requireAvailable(apiKey);
        return createInternal();
    }

    @Scheduled(initialDelayString = "${app.backup.initial-delay-ms:60000}",
            fixedDelayString = "${app.backup.interval-ms:86400000}")
    public synchronized void automaticBackup() {
        if (!enabled) return;
        try {
            List<BackupInfo> existing = listInternal();
            if (!existing.isEmpty() && Duration.between(existing.get(0).createdAt(), clock.instant()).toHours() < 24) {
                lastSuccess = existing.get(0).createdAt();
                return;
            }
            createInternal();
        } catch (Exception e) {
            lastError = "自动备份失败，请检查磁盘空间和数据目录权限并手动重试。";
            log.error("Automatic database backup failed", e);
        }
    }

    private BackupInfo createInternal() {
        Path raw = null;
        Path packed = null;
        try {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory)) throw new IOException("Backup directory cannot be a symbolic link");
            raw = Files.createTempFile(directory, "h2-backup-", ".partial");
            packed = Files.createTempFile(directory, "backup-", ".partial");
            String schemaVersion;
            try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
                if (!connection.getMetaData().getURL().startsWith("jdbc:h2:file:")) {
                    throw new BusinessException(409, "自动备份需要 H2 文件数据库");
                }
                // The only interpolated value is a server-generated filesystem path, escaped as an SQL literal.
                statement.execute("BACKUP TO '" + raw.toString().replace("'", "''") + "'");
                try (ResultSet result = statement.executeQuery("SELECT version FROM flyway_schema_history "
                        + "WHERE success=TRUE AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1")) {
                    schemaVersion = result.next() ? result.getString(1) : "unknown";
                }
            }
            Instant createdAt = clock.instant();
            try (ZipFile source = new ZipFile(raw.toFile());
                 ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(packed))) {
                List<? extends ZipEntry> databases = source.stream()
                        .filter(entry -> !entry.isDirectory() && entry.getName().endsWith(".mv.db")).toList();
                if (databases.size() != 1) throw new IOException("Expected exactly one H2 database file");
                output.putNextEntry(new ZipEntry(DATABASE));
                DigestResult digest;
                try (InputStream input = source.getInputStream(databases.get(0))) {
                    digest = copyAndDigest(input, output, MAX_DATABASE_BYTES);
                }
                output.closeEntry();
                output.putNextEntry(new ZipEntry(MANIFEST));
                output.write(json.writeValueAsBytes(new Manifest("tangent-h2-backup", 1, createdAt.toString(),
                        schemaVersion, DATABASE, digest.bytes(), digest.sha256())));
                output.closeEntry();
            }
            String name = "tangent-backup-" + TIME.format(clock.instant().atZone(clock.getZone()))
                    + "-" + UUID.randomUUID().toString().replace("-", "") + ".zip";
            Path finished = directory.resolve(name);
            Files.move(packed, finished, StandardCopyOption.ATOMIC_MOVE);
            lastSuccess = createdAt;
            lastError = null;
            // Failed cleanup must not discard a successful backup.
            try { prune(); } catch (IOException e) { log.warn("Unable to prune old database backups", e); }
            return new BackupInfo(name, Files.size(finished), createdAt);
        } catch (IOException | SQLException e) {
            throw failure("数据库备份失败，请检查磁盘空间与目录权限", e);
        } finally {
            removeTemporary(raw);
            removeTemporary(packed);
        }
    }

    @Override
    public synchronized BackupPreview preview(String name, String apiKey) {
        requireAvailable(apiKey);
        Path archive = checkedPath(name);
        try {
            return inspectArchive(archive, json);
        } catch (IOException | RuntimeException e) {
            if (e instanceof BusinessException business) throw business;
            throw failure("备份完整性校验失败，不能用于恢复", e);
        }
    }

    /** Pure archive preflight, shared by the regression round-trip test; does not mount the stored DB. */
    public static BackupPreview inspectArchive(Path archive, ObjectMapper json) throws IOException {
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            if (zip.size() != 2 || zip.getEntry(MANIFEST) == null || zip.getEntry(DATABASE) == null) {
                throw new IOException("Unexpected backup archive layout");
            }
            Manifest manifest;
            try (InputStream input = zip.getInputStream(zip.getEntry(MANIFEST))) {
                byte[] bytes = input.readNBytes(65_537);
                if (bytes.length > 65_536) throw new IOException("Manifest too large");
                manifest = json.readValue(bytes, Manifest.class);
            }
            if (!"tangent-h2-backup".equals(manifest.format()) || manifest.formatVersion() != 1
                    || !DATABASE.equals(manifest.databaseFile())) throw new IOException("Unsupported backup format");
            DigestResult database;
            try (InputStream input = zip.getInputStream(zip.getEntry(DATABASE))) {
                database = copyAndDigest(input, OutputStream.nullOutputStream(), MAX_DATABASE_BYTES);
            }
            if (database.bytes() != manifest.databaseBytes() || !database.sha256().equals(manifest.databaseSha256())) {
                throw new IOException("Database checksum mismatch");
            }
            String archiveHash;
            try (InputStream input = Files.newInputStream(archive)) {
                archiveHash = copyAndDigest(input, OutputStream.nullOutputStream(), MAX_DATABASE_BYTES + 1_048_576).sha256();
            }
            return new BackupPreview(archive.getFileName().toString(), archiveHash, Instant.parse(manifest.createdAt()),
                    manifest.schemaVersion(), DATABASE, database.bytes(), true,
                    "下载备份后关闭桌面程序。运行交付目录 tools/Restore-DesktopBackup.ps1 预览；核对 SHA256 后添加 -Apply -ExpectedSha256 完成离线恢复。恢复前原数据库会保留为安全副本。备份包含账号凭据，不含 Windows DPAPI 文件与 AI 服务密钥；换机需单独迁移登录保护文件。");
        }
    }

    @Override
    public synchronized Path download(String name, String apiKey) {
        requireAvailable(apiKey);
        return checkedPath(name);
    }

    private void requireAvailable(String apiKey) {
        authorization.requireAdmin(apiKey);
        if (!enabled) throw new BusinessException(404, "此部署不提供桌面数据库备份");
    }

    private Path checkedPath(String name) {
        if (name == null || !NAME.matcher(name).matches()) throw new BusinessException(400, "无效备份文件名");
        Path result = directory.resolve(name).normalize();
        if (!result.getParent().equals(directory) || !Files.isRegularFile(result, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(directory)) throw new BusinessException(404, "备份不存在");
        return result;
    }

    private List<BackupInfo> listInternal() throws IOException {
        if (!Files.exists(directory)) return List.of();
        List<BackupInfo> result = new ArrayList<>();
        try (var stream = Files.list(directory)) {
            for (Path path : stream.filter(p -> NAME.matcher(p.getFileName().toString()).matches())
                    .filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)).toList()) {
                result.add(new BackupInfo(path.getFileName().toString(), Files.size(path), Files.getLastModifiedTime(path).toInstant()));
            }
        }
        result.sort(Comparator.comparing(BackupInfo::createdAt).reversed());
        return result;
    }

    private void prune() throws IOException {
        List<BackupInfo> items = listInternal();
        for (int index = retention; index < items.size(); index++) Files.deleteIfExists(directory.resolve(items.get(index).name()));
    }

    private BusinessException failure(String message, Exception cause) {
        lastError = message;
        log.warn(message, cause);
        return new BusinessException(500, message);
    }

    private static DigestResult copyAndDigest(InputStream input, OutputStream output, long limit) throws IOException {
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        byte[] buffer = new byte[65_536];
        long total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new IOException("Backup exceeds the 1 GiB inspection limit");
            digest.update(buffer, 0, read);
            output.write(buffer, 0, read);
        }
        return new DigestResult(total, HexFormat.of().formatHex(digest.digest()));
    }

    private void removeTemporary(Path path) {
        if (path == null) return;
        try { Files.deleteIfExists(path); } catch (IOException e) { log.warn("Unable to clean partial backup", e); }
    }

    private record DigestResult(long bytes, String sha256) {}
    public record Manifest(String format, int formatVersion, String createdAt, String schemaVersion,
                           String databaseFile, long databaseBytes, String databaseSha256) {}
}
