param(
  [switch]$ValidateOnly,
  [string]$ApiUrl = "http://localhost:5089",
  [string]$EnvFile = '.env',
  [switch]$SkipApiAudit
)

. (Join-Path $PSScriptRoot "operations-common.ps1")
$rootPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$config = Get-XichuDatabaseConfig -RootPath $rootPath -EnvFile $EnvFile
$sourceDatabase = $config.Database
$targetDatabase = "${sourceDatabase}_RestoreTest"
if ($targetDatabase -eq $sourceDatabase -or $targetDatabase -notmatch '^[A-Za-z0-9_]+_RestoreTest$') {
  throw "Restore-test target name is unsafe."
}

if ($ValidateOnly) {
  if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw "sqlcmd is unavailable." }
  Write-Host "[OK] Restore test uses isolated target [$targetDatabase] and cannot overwrite [$sourceDatabase]."
  exit 0
}

$query = @"
SET NOCOUNT ON;
DECLARE @backup nvarchar(4000)=(
  SELECT TOP (1) bmf.physical_device_name
  FROM msdb.dbo.backupset bs
  JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id=bmf.media_set_id
  WHERE bs.database_name=N'$sourceDatabase' AND bs.type='D' AND bs.is_copy_only=1
  ORDER BY bs.backup_finish_date DESC
);
IF @backup IS NULL THROW 51001, 'No COPY_ONLY backup found; run backup.cmd first', 1;

CREATE TABLE #files (
 LogicalName nvarchar(128), PhysicalName nvarchar(260), [Type] char(1), FileGroupName nvarchar(128) NULL,
 Size numeric(20,0), MaxSize numeric(20,0), FileId bigint, CreateLSN numeric(25,0), DropLSN numeric(25,0) NULL,
 UniqueId uniqueidentifier, ReadOnlyLSN numeric(25,0) NULL, ReadWriteLSN numeric(25,0) NULL,
 BackupSizeInBytes bigint, SourceBlockSize int, FileGroupId int, LogGroupGUID uniqueidentifier NULL,
 DifferentialBaseLSN numeric(25,0) NULL, DifferentialBaseGUID uniqueidentifier NULL, IsReadOnly bit,
 IsPresent bit, TDEThumbprint varbinary(32) NULL, SnapshotUrl nvarchar(360) NULL
);
DECLARE @fileListSql nvarchar(max)=N'RESTORE FILELISTONLY FROM DISK=N'''+REPLACE(@backup,'''','''''')+N'''';
INSERT INTO #files EXEC(@fileListSql);
DECLARE @dataLogical nvarchar(128)=(SELECT TOP (1) LogicalName FROM #files WHERE [Type]='D' ORDER BY FileId);
DECLARE @logLogical nvarchar(128)=(SELECT TOP (1) LogicalName FROM #files WHERE [Type]='L' ORDER BY FileId);
IF @dataLogical IS NULL OR @logLogical IS NULL THROW 51002, 'Backup logical file names unavailable', 1;
DECLARE @dataPath nvarchar(4000)=CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultDataPath'));
DECLARE @logPath nvarchar(4000)=CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultLogPath'));
IF RIGHT(@dataPath,1) NOT IN ('\','/') SET @dataPath=@dataPath+'\';
IF RIGHT(@logPath,1) NOT IN ('\','/') SET @logPath=@logPath+'\';
IF DB_ID(N'$targetDatabase') IS NOT NULL THROW 51003, 'Restore target already exists; preserve it and choose a new isolated source/target', 1;
DECLARE @restoreSql nvarchar(max)=N'RESTORE DATABASE [$targetDatabase] FROM DISK=N'''+REPLACE(@backup,'''','''''')+
 N''' WITH RECOVERY, CHECKSUM, MOVE N'''+REPLACE(@dataLogical,'''','''''')+N''' TO N'''+REPLACE(@dataPath+N'$targetDatabase.mdf','''','''''')+
 N''', MOVE N'''+REPLACE(@logLogical,'''','''''')+N''' TO N'''+REPLACE(@logPath+N'${targetDatabase}_log.ldf','''','''''')+N'''';
EXEC(@restoreSql);
ALTER DATABASE [$targetDatabase] SET MULTI_USER;
DBCC CHECKDB ([$targetDatabase]) WITH NO_INFOMSGS, DATA_PURITY;
DECLARE @verifySql nvarchar(max)=N'SELECT ''MIGRATIONS='' + CONVERT(varchar(20),COUNT_BIG(*)) FROM [$targetDatabase].dbo._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;';
EXEC(@verifySql);
SELECT @backup;
"@

try {
  Write-Host "[XichuQuant] Restoring the latest COPY_ONLY backup into [$targetDatabase]..."
  $output = Invoke-XichuSqlcmd -Config $config -Query $query
  $reference = ($output | Where-Object { $_ -match '\.bak\s*$' } | Select-Object -Last 1).Trim()
  $migrationLine = $output | Where-Object { $_ -match '^MIGRATIONS=' } | Select-Object -Last 1
  if (-not $reference -or -not $migrationLine) { throw "Restore completed but business verification output is incomplete." }
  $verification = @{ checkdb = $true; isolatedTarget = $targetDatabase; migrationCheck = $migrationLine.Trim() } | ConvertTo-Json -Compress
  if (-not $SkipApiAudit) { Write-XichuOperationAudit -ApiUrl $ApiUrl -Operation "RESTORE_TEST" -TargetDatabase $targetDatabase -Status "VERIFIED" -Reference $reference -Verification $verification }
  Write-Host "[OK] Isolated restore, DBCC CHECKDB, and migration verification passed. $migrationLine"
  Write-Host "[INFO] Test database [$targetDatabase] is retained for review; [$sourceDatabase] was not overwritten."
} catch {
  if (-not $SkipApiAudit) { Write-XichuOperationAudit -ApiUrl $ApiUrl -Operation "RESTORE_TEST" -TargetDatabase $targetDatabase -Status "FAILED" -ErrorMessage $_.Exception.Message }
  throw
}
