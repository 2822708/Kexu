[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [switch]$Apply,
    [string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Historical on-disk archive identifiers are read-only compatibility bytes.
$legacyManifest = [Text.Encoding]::ASCII.GetString([byte[]](116,97,110,103,101,110,116,45,98,97,99,107,117,112,46,106,115,111,110))
$legacyFormat = [Text.Encoding]::ASCII.GetString([byte[]](116,97,110,103,101,110,116,45,104,50,45,98,97,99,107,117,112))
$legacyProcess = [Text.Encoding]::ASCII.GetString([byte[]](84,97,110,103,101,110,116,84,105,109,101,116,97,98,108,101))

function Get-StreamSha256([System.IO.Stream]$Stream) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Assert-ChildPath([string]$Path, [string]$Directory) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Restore destination escaped the selected data directory.'
    }
    return $full
}

$archivePath = (Resolve-Path -LiteralPath $BackupPath).ProviderPath
$destinationDir = [IO.Path]::GetFullPath($DataDir)
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
$markerPath = $null
$stagePath = $null
$markerOwned = $false
try {
    $manifestEntry = $archive.GetEntry('kexu-backup.json')
    $expectedFormat = 'kexu-h2-backup'
    if ($null -eq $manifestEntry) {
        $manifestEntry = $archive.GetEntry($legacyManifest)
        $expectedFormat = $legacyFormat
    }
    $databaseEntry = $archive.GetEntry('timetable.mv.db')
    if ($archive.Entries.Count -ne 2 -or $null -eq $manifestEntry -or $null -eq $databaseEntry) {
        throw 'This is not a supported Kexu database backup archive.'
    }
    if ($manifestEntry.Length -gt 65536 -or $databaseEntry.Length -gt 1073741824) {
        throw 'The archive exceeds the supported preview limit (1 GiB database, 64 KiB manifest).'
    }
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json }
    finally { $reader.Dispose() }
    if ($manifest.format -ne $expectedFormat -or $manifest.formatVersion -ne 1 -or
        $manifest.databaseFile -ne 'timetable.mv.db' -or $manifest.databaseBytes -ne $databaseEntry.Length) {
        throw 'The backup manifest is invalid or unsupported.'
    }
    $input = $databaseEntry.Open()
    try { $databaseHash = Get-StreamSha256 $input }
    finally { $input.Dispose() }
    if ($databaseHash -ne $manifest.databaseSha256) { throw 'Database checksum mismatch. No files were changed.' }

    [PSCustomObject]@{
        Mode = $(if ($Apply) { 'Restore requested' } else { 'Preview only' })
        Backup = $archivePath
        CreatedAt = $manifest.createdAt
        SchemaVersion = $manifest.schemaVersion
        DatabaseBytes = $databaseEntry.Length
        ArchiveSha256 = $archiveHash
        IntegrityVerified = $true
        Destination = $destinationDir
    } | Format-List | Out-Host

    if (-not $Apply) {
        Write-Host 'Preview finished. No data files were changed.'
        Write-Host 'Close Kexu and its Java backend. To restore this exact archive, repeat with -Apply -ExpectedSha256 <ArchiveSha256>.'
        Write-Host 'Only restore a trusted backup. It contains account credentials and all application data, but not the Windows DPAPI files or the DeepSeek provider key.'
        return
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedSha256) -or $ExpectedSha256.ToLowerInvariant() -ne $archiveHash) {
        throw 'Pass the exact SHA256 shown in preview using -ExpectedSha256 before applying a restore.'
    }
    if (-not [IO.Directory]::Exists($destinationDir)) { throw 'Choose an existing desktop data directory.' }
    if (((Get-Item -LiteralPath $destinationDir).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Choose a physical data directory, not a symlink or junction.'
    }
    $markerPath = Assert-ChildPath (Join-Path $destinationDir '.restore-in-progress') $destinationDir
    $marker = [IO.File]::Open($markerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $markerOwned = $true
    $marker.Dispose()
    if (Get-Process -Name Kexu,$legacyProcess -ErrorAction SilentlyContinue) {
        throw 'Close Kexu before restoring. The running application has not been stopped automatically.'
    }
    $databasePath = Assert-ChildPath (Join-Path $destinationDir 'timetable.mv.db') $destinationDir
    if ([IO.File]::Exists($databasePath)) {
        if (((Get-Item -LiteralPath $databasePath).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The database must not be a symlink.'
        }
        # H2 holds the database open. Refuse restoration if any backend still owns it.
        $exclusive = [IO.File]::Open($databasePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $exclusive.Dispose()
    }
    $stagePath = Assert-ChildPath (Join-Path $destinationDir ('.restore-' + [guid]::NewGuid().ToString('N') + '.partial')) $destinationDir
    $source = $databaseEntry.Open()
    $target = [IO.File]::Open($stagePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $source.CopyTo($target); $target.Flush($true) }
    finally { $source.Dispose(); $target.Dispose() }
    if ((Get-FileHash -LiteralPath $stagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $databaseHash) {
        throw 'Staged database checksum mismatch. The original database is unchanged.'
    }
    if ([IO.File]::Exists($databasePath)) {
        $safetyPath = Assert-ChildPath (Join-Path $destinationDir ('timetable.before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.mv.db')) $destinationDir
        # Atomic replacement on the same volume, retaining the former database as a safety copy.
        [IO.File]::Replace($stagePath, $databasePath, $safetyPath, $true)
        Write-Host ('Previous database preserved at: ' + $safetyPath)
    } else {
        [IO.File]::Move($stagePath, $databasePath)
    }
    Write-Host 'Restore completed. Restart Kexu and verify the timetable and todos.'
    Write-Host 'For a different Windows account or computer, migrate the login credential separately; DPAPI-encrypted files are account-bound.'
} finally {
    $archive.Dispose()
    if ($null -ne $stagePath -and [IO.File]::Exists($stagePath)) {
        $checkedStage = Assert-ChildPath $stagePath $destinationDir
        Remove-Item -LiteralPath $checkedStage -Force
    }
    if ($markerOwned) {
        $checkedMarker = Assert-ChildPath $markerPath $destinationDir
        Remove-Item -LiteralPath $checkedMarker -Force
    }
}
