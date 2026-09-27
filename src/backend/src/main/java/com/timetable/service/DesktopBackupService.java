package com.timetable.service;

import com.timetable.dto.BackupInfo;
import com.timetable.dto.BackupPreview;
import com.timetable.dto.BackupStatus;

import java.nio.file.Path;
import java.util.List;

public interface DesktopBackupService {
    BackupStatus status(String apiKey);
    List<BackupInfo> list(String apiKey);
    BackupInfo create(String apiKey);
    BackupPreview preview(String name, String apiKey);
    Path download(String name, String apiKey);
}
