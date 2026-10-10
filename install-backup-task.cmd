@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-daily-backup-task.ps1" %*
exit /b %errorlevel%
