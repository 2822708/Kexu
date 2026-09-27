package com.timetable.controller;

import com.timetable.dto.*;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.DesktopBackupService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;
import java.util.List;

@RestController
@RequestMapping("/api/backups")
public class DesktopBackupController {
    private final DesktopBackupService backups;

    public DesktopBackupController(DesktopBackupService backups) { this.backups = backups; }

    @GetMapping("/status")
    public ApiResponse<BackupStatus> status() { return ApiResponse.success(backups.status(RequestContext.getApiKey())); }

    @GetMapping
    public ApiResponse<List<BackupInfo>> list() { return ApiResponse.success(backups.list(RequestContext.getApiKey())); }

    @PostMapping
    public ApiResponse<BackupInfo> create() { return ApiResponse.success(backups.create(RequestContext.getApiKey())); }

    @GetMapping("/{name}/preview")
    public ApiResponse<BackupPreview> preview(@PathVariable String name) {
        return ApiResponse.success(backups.preview(name, RequestContext.getApiKey()));
    }

    @GetMapping("/{name}/download")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        Path path = backups.download(name, RequestContext.getApiKey());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(name).build().toString())
                .body(new FileSystemResource(path));
    }
}
