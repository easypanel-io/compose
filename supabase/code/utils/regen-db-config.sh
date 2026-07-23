#!/usr/bin/env bash
# Regenerate the Supabase db-config volume from a PG17 image, PRESERVING pgsodium_root.key.
#
# Gotcha A: the db-config volume (mounted at /etc/postgresql-custom) persists PG15-era
# config (supautils.conf, wal-g.conf, read-replica.conf, ...). If any of it is a param PG17
# rejects, PG17 boot-loops with:  configuration file ".../postgresql.conf" contains errors.
# This replaces those files with the PG17 image's fresh copies, but KEEPS the pgsodium root
# key (losing it makes vault/pgsodium unusable: "invalid secret key" and secrets won't decrypt).
#
# Run with the db/stack STOPPED. Then start the stack on PG17.
#
# Usage:
#   COMPOSE_PROJECT_NAME=supabase_supabase PG17_IMAGE=supabase/postgres:17.6.1.150 \
#     bash regen-db-config.sh
#   # or pass the volume + key backup explicitly:
#   DB_CONFIG_VOL=supabase_supabase_db-config KEY_BACKUP=/path/pgsodium_root.key.bak.pg15 \
#     PG17_IMAGE=... bash regen-db-config.sh
set -euo pipefail

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
DB_CONTAINER="${DB_CONTAINER:-}"
DB_CONFIG_VOL="${DB_CONFIG_VOL:-}"
PG17_IMAGE="${PG17_IMAGE:-supabase/postgres:17.6.1.150}"
KEY_BACKUP="${KEY_BACKUP:-}"

# Resolve the db-config volume if not given: from the db container's mounts.
if [ -z "$DB_CONFIG_VOL" ]; then
    if [ -z "$DB_CONTAINER" ]; then
        if [ -n "$COMPOSE_PROJECT_NAME" ]; then
            ids=$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")
        else ids=$(docker ps -aq); fi
        for id in $ids; do
            img=$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null)
            case "$img" in *postgres-meta*) continue ;; *supabase/postgres:*) DB_CONTAINER=$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##'); break ;; esac
        done
    fi
    [ -n "$DB_CONTAINER" ] || { echo "Cannot resolve db container / volume" >&2; exit 1; }
    DB_CONFIG_VOL=$(docker inspect "$DB_CONTAINER" \
        --format '{{range .Mounts}}{{if eq .Destination "/etc/postgresql-custom"}}{{.Name}}{{end}}{{end}}')
fi
[ -n "$DB_CONFIG_VOL" ] || { echo "Cannot resolve db-config volume" >&2; exit 1; }
echo "==> db-config volume: $DB_CONFIG_VOL   (image: $PG17_IMAGE)"

# Mount the key backup dir read-only if provided, so the container can fall back to it.
key_mount=()
if [ -n "$KEY_BACKUP" ] && [ -f "$KEY_BACKUP" ]; then
    key_mount=(-v "$(cd "$(dirname "$KEY_BACKUP")" && pwd)/$(basename "$KEY_BACKUP"):/bak/key:ro")
fi

docker run --rm -v "${DB_CONFIG_VOL}:/vol" "${key_mount[@]}" --entrypoint sh "$PG17_IMAGE" -c '
    set -e
    # 1) Snapshot the pgsodium root key: prefer the one already in the volume, else the backup.
    if [ -f /vol/pgsodium_root.key ]; then cp -a /vol/pgsodium_root.key /tmp/pgkey;
    elif [ -f /bak/key ]; then cp /bak/key /tmp/pgkey; fi
    # 2) Wipe the volume and lay down the PG17 image defaults.
    find /vol -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a /etc/postgresql-custom/. /vol/
    mkdir -p /vol/conf.d
    # 3) Restore the pgsodium key (vault/pgsodium depend on it).
    if [ -f /tmp/pgkey ]; then cp /tmp/pgkey /vol/pgsodium_root.key; chmod 600 /vol/pgsodium_root.key; fi
    chown -R postgres:postgres /vol/
    echo "  regenerated; pgsodium_root.key present: $([ -f /vol/pgsodium_root.key ] && echo yes || echo NO)"
'
echo "==> db-config regenerated from $PG17_IMAGE (pgsodium key preserved). Start the stack on PG17."
