#!/usr/bin/env bash
set -euo pipefail
task_db="${XICHURISK_DATABASE_NAME:?Set the explicit database name}"
[[ "$task_db" =~ ^XichuQuant(Local|Demo|PhaseBTest)_[A-Za-z0-9_]+$ ]] || { echo 'Refused: database initialization requires a dedicated database name.' >&2; exit 1; }
/opt/mssql-tools18/bin/sqlcmd -S sqlserver -U sa -C -b -Q "IF DB_ID(N'$task_db') IS NULL CREATE DATABASE [$task_db];"
echo 'Database creation checked; no reset, Seed or existing record replacement was performed.'
