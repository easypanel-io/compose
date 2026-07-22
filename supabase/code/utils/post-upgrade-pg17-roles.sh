#!/usr/bin/env bash
# Post-start PG17 migrations, for the conversion-only upgrade path (EasyPanel).
#
# After the lifecycle owner (EasyPanel) starts the stack on a Postgres 17 image,
# run this against the RUNNING db container. It applies the PG17 role/collation
# migrations that a pg_upgrade does NOT carry over (they normally run via initdb
# on a fresh install, and complete.sh doesn't cover them):
#   - REFRESH COLLATION VERSION (glibc drift after the upgrade)
#   - create supabase_etl_admin (absent in PG15 images)
#   - the 4 predefined-role/grant migrations shipped inside the PG17 image
#
# Usage:
#   COMPOSE_PROJECT_NAME=supabase_supabase bash post-upgrade-pg17-roles.sh
#   DB_CONTAINER=supabase_supabase-db-1    bash post-upgrade-pg17-roles.sh
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"

if [ -z "$DB_CONTAINER" ]; then
    if [ -n "$COMPOSE_PROJECT_NAME" ]; then
        ids=$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")
    else
        ids=$(docker ps -q)
    fi
    for id in $ids; do
        img=$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null)
        case "$img" in
            *postgres-meta*) continue ;;
            *supabase/postgres:*) DB_CONTAINER=$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##'); break ;;
        esac
    done
fi
[ -n "$DB_CONTAINER" ] || { echo "Could not resolve db container" >&2; exit 1; }

PW="${PGPASSWORD:-}"
if [ -z "$PW" ]; then
    PW=$(docker inspect "$DB_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | grep '^POSTGRES_PASSWORD=' | head -n1 | cut -d= -f2-)
fi
[ -n "$PW" ] || { echo "Could not resolve POSTGRES_PASSWORD" >&2; exit 1; }

echo "==> Target db container: $DB_CONTAINER"

# 1. Collation version refresh (suppresses the 2.39->2.40 warnings after upgrade).
for db in postgres template1 _supabase; do
    docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
        psql -h localhost -U supabase_admin -d "$db" \
        -c "ALTER DATABASE \"$db\" REFRESH COLLATION VERSION;" || true
done

# 2. Create supabase_etl_admin (needed before predefined_role_grants.sql).
docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
    psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_etl_admin') THEN
            CREATE USER supabase_etl_admin WITH LOGIN REPLICATION;
            GRANT pg_read_all_data TO supabase_etl_admin;
            GRANT CREATE ON DATABASE postgres TO supabase_etl_admin;
        END IF;
    END \$\$;" || true

# 3. The 4 PG17 migrations shipped inside the image (idempotent).
MIGDIR="/docker-entrypoint-initdb.d/migrations"
for m in \
    20250710151649_supabase_read_only_user_default_transaction_read_only.sql \
    20251001204436_predefined_role_grants.sql \
    20251105172723_grant_pg_reload_conf_to_postgres.sql \
    20251121132723_correct_search_path_pgbouncer.sql; do
    echo "  Running: $m"
    docker exec -i -e PGPASSWORD="$PW" "$DB_CONTAINER" \
        psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
        -f "${MIGDIR}/${m}" || echo "  $m failed (non-fatal / may not exist in this image)"
done

echo "==> Post-upgrade role/collation migrations applied."
