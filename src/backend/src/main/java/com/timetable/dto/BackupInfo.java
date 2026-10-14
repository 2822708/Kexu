package com.timetable.dto;

import java.time.Instant;

public record BackupInfo(String name, long sizeBytes, Instant createdAt) {}
