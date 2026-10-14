package com.timetable.dto;

import java.time.Instant;

public record BackupStatus(boolean available, int retainedCopies, Instant lastSuccess,
                           String lastError, String message) {}
