#!/usr/bin/env bash
set -euo pipefail
# Run from the project root on a Linux amd64 host. Never source/eval an environment file.
task_env="${1:?Usage: bash deploy/linux/certify-phase-c.sh .env.docker-local}"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'NOT_RUN: Linux amd64 is required for this SQL Server deployment.'; exit 1; }
docker info >/dev/null
task_db="$(node deploy/linux/check-environment.mjs "$task_env")"
task_project="xichuquant-accept-$(date -u +%Y%m%d%H%M%S)"
task_report="Agent/Temp/phase-c-${task_project}.log"
mkdir -p Agent/Temp
exec > >(tee -a "$task_report") 2>&1
task_compose=(docker compose -p "$task_project" --env-file "$task_env" -f docker-compose.yml -f docker-compose.local.yml)
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$task_project")" ]] || { echo 'Refused: acceptance project already exists.'; exit 1; }
"${task_compose[@]}" config --quiet
"${task_compose[@]}" build
"${task_compose[@]}" up -d --wait --wait-timeout 240 sqlserver
"${task_compose[@]}" run --rm db-init
"${task_compose[@]}" run --rm db-migrate
"${task_compose[@]}" run --rm db-seed
"${task_compose[@]}" run --rm db-seed
"${task_compose[@]}" up -d --wait --wait-timeout 240 sqlserver quant-engine broker-connector api web reverse-proxy
"${task_compose[@]}" run --rm --no-deps local-acceptance
task_sql() { "${task_compose[@]}" exec -T sqlserver bash -c 'export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"; exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -h -1 -W'; }
task_digest() { printf "SET NOCOUNT ON; SELECT 'MIGRATIONS',COUNT_BIG(*) FROM [%s].dbo._prisma_migrations WHERE finished_at IS NOT NULL; SELECT 'FILLS',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM [%s].dbo.PaperFill; SELECT 'ACCOUNT',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM [%s].dbo.Account;\nGO\n" "$task_db" "$task_db" "$task_db" | task_sql; }
task_before="$(task_digest)"
"${task_compose[@]}" restart sqlserver quant-engine broker-connector api web reverse-proxy
"${task_compose[@]}" up -d --wait --wait-timeout 240
[[ "$(task_digest)" == "$task_before" ]] || { echo 'FAILED: persistence digest changed after service restart.'; exit 1; }
task_target="${task_db}_RestoreTest"
cat <<SQL | task_sql
SET NOCOUNT ON;
IF DB_ID(N'$task_target') IS NOT NULL THROW 51001,'Restore target already exists; do not overwrite',1;
BACKUP DATABASE [$task_db] TO DISK=N'/var/opt/mssql/backup/${task_db}_phase_c.bak' WITH COPY_ONLY,CHECKSUM,INIT;
RESTORE VERIFYONLY FROM DISK=N'/var/opt/mssql/backup/${task_db}_phase_c.bak' WITH CHECKSUM;
DECLARE @data nvarchar(128)=(SELECT name FROM [$task_db].sys.database_files WHERE type=0);
DECLARE @log nvarchar(128)=(SELECT name FROM [$task_db].sys.database_files WHERE type=1);
DECLARE @sql nvarchar(max)=N'RESTORE DATABASE [$task_target] FROM DISK=N''/var/opt/mssql/backup/${task_db}_phase_c.bak'' WITH RECOVERY,CHECKSUM,MOVE N'''+REPLACE(@data,'''','''''')+N''' TO N''/var/opt/mssql/data/${task_target}.mdf'',MOVE N'''+REPLACE(@log,'''','''''')+N''' TO N''/var/opt/mssql/data/${task_target}_log.ldf''';
EXEC(@sql);
DBCC CHECKDB ([$task_target]) WITH NO_INFOMSGS,DATA_PURITY;
IF (SELECT COUNT(*) FROM [$task_target].dbo.PaperFill)<>(SELECT COUNT(*) FROM [$task_db].dbo.PaperFill) THROW 51002,'Restored fill count differs',1;
GO
SQL
for task_service in sqlserver broker-connector quant-engine api; do
  task_id="$("${task_compose[@]}" ps -q "$task_service")"
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$task_id")" == 0 ]] || { echo "FAILED: private service $task_service publishes a host port."; exit 1; }
done
task_backend="$("${task_compose[@]}" ps -q sqlserver | xargs docker inspect -f '{{range $name,$settings := .NetworkSettings.Networks}}{{$name}}{{end}}')"
[[ "$(docker network inspect -f '{{.Internal}}' "$task_backend")" == true ]] || { echo 'FAILED: database network is not internal.'; exit 1; }
"${task_compose[@]}" exec -T broker-connector node -e "fetch('http://localhost:5092/paper/capabilities').then(r=>r.json()).then(c=>{for(const k of ['canPlaceLiveOrders','canModifyLiveOrders','canCancelLiveOrders','canPlacePaperOrders','canModifyPaperOrders','canCancelPaperOrders'])if(c[k]!==false)process.exit(1);console.log('PASS: all external writes disabled')})"
echo 'PASS: build/start/health/migrations/Seed/login/backtest/internal Paper/restart/persistence/backup/isolated restore/private ports.'
echo "Retained project=$task_project, database=$task_db, restore=$task_target; evidence=$task_report"
echo 'Host reboot, actual IBKR Gateway access, public Demo abuse testing and 72h Soak remain NOT_RUN.'
echo 'Stop explicitly with the same Compose project and environment; never use down -v or global prune.'
