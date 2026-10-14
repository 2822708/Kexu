package com.timetable.dto;

import java.time.Instant;

public record BackupPreview(String name, String sha256, Instant createdAt, String schemaVersion,
                            String databaseFile, long databaseBytes, boolean integrityVerified,
                            String restoreInstructions) {}
