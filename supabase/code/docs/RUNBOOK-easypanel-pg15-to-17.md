# Runbook producción — api.mando (EasyPanel) · Supabase Postgres 15 → 17

**Validado** en PoC local que replica el layout EXACTO de EasyPanel (2026-07-22).
Ejecutor: **Carlos** (opera VPS/EasyPanel; Claude sin SSH). Todo con `sudo` en el VPS Linux.

## Layout real (confirmado)
- Proyecto compose: `supabase_supabase` · contenedor db: `supabase_supabase-db-1` (autogenerado, **sin `container_name`**).
- Imagen db actual: `supabase/postgres:15.8.1.085` · data dir bind: `./volumes/db/data` · db-config: named vol `supabase_supabase_db-config`.
- working_dir: `/etc/easypanel/projects/supabase/supabase/code/supabase/code`.
- Extensiones (ninguna incompatible): pg_graphql, pg_net, pg_stat_statements, pgcrypto, pgjwt, plpgsql, supabase_vault, uuid-ossp.
- Persistencia de la imagen 17: **NO se edita el compose en el server** (EasyPanel re-clona el template en cada deploy). Se logra porque EasyPanel clona el fork propio que ya trae `db: supabase/postgres:17.x`.

## Versiones efectivas
- Base PG15: `15.8.1.085` (la de api.mando). Binarios de pg_upgrade: `17.6.1.063` (hardcoded en el script). Imagen 17 final: la del fork (`17.6.1.150` en el PoC). Todas las 17.x son compatibles con el data dir convertido.

## Artefactos a subir al server
- `utils/upgrade-pg17.easypanel.sh` (script adaptado — autodetección + `--conversion-only`).
- `utils/post-upgrade-pg17-roles.sh` (migraciones post-arranque).
- `utils/regen-db-config.sh` (contingencia Gotcha A — regenera db-config preservando pgsodium key).
- La suite RLS de Mando (`crm-mando/supabase/tests/10_rls_meta_test.sql`, `20_rls_isolation_test.sql`).

## Procedimiento

### 0) Pre-flight y BACKUP (imprescindible, antes de todo)
```bash
cd /etc/easypanel/projects/supabase/supabase/code/supabase/code
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
# a) Dump lógico completo
docker exec -e PGPASSWORD="$PW" supabase_supabase-db-1 \
  pg_dumpall -U supabase_admin -h localhost > /root/mando_pre_pg17_$(date +%F).sql
# b) Auditar extensiones (confirmar que NO hay timescaledb/plv8/plcoffee/plls)
docker exec -e PGPASSWORD="$PW" supabase_supabase-db-1 \
  psql -U supabase_admin -h localhost -Atc "select string_agg(extname,', ' order by extname) from pg_extension;"
# c) Snapshot del data dir + subir a R2 / snapshot Acronis del VPS
tar czf /root/mando_datadir_pre_pg17_$(date +%F).tgz -C volumes/db data
# (subir ambos a R2; snapshot del disco del VPS en Ionos si aplica)
```

### 1) Parar la app en EasyPanel  **[UI EasyPanel]**
Detén el servicio `supabase` desde el panel (Stop). El script también puede pararlo, pero
pararlo en EasyPanel evita que su health-monitor lo reinicie a mitad del upgrade.
(El script tolera la db parada: autodetecta por `docker inspect` y salta el chequeo de extensiones en vivo.)

### 2) Conversión del data dir (script adaptado, modo solo-conversión)
```bash
cd /etc/easypanel/projects/supabase/supabase/code/supabase/code
sudo COMPOSE_PROJECT_NAME=supabase_supabase CONVERSION_ONLY=true \
  bash utils/upgrade-pg17.easypanel.sh --yes
```
Qué hace: autodetecta `supabase_supabase-db-1`, su data dir y `supabase_supabase_db-config`;
respalda la pgsodium key; corre `pg_upgrade` (15→17) en contenedores one-off; aplica `complete.sh`
(parches + vacuum); hace el **swap** `data ↔ data.bak.pg15`; chown de db-config a uid PG17; y
**termina sin arrancar**. Deja `data.bak.pg15` y `pgsodium_root.key.bak.pg15` como backup/rollback.
- En el VPS se corre con `sudo` (root) → NO uses `ALLOW_NONROOT` (eso es solo para Docker de escritorio).
- Duración esperada: minutos (build del tarball ~1.2 GB la 1ª vez; el pg_upgrade en sí, segundos).

### 3) Apuntar EasyPanel al fork con db=17 y arrancar  **[UI EasyPanel]**
El data dir ya está en 17. Ahora EasyPanel debe arrancar con una imagen Postgres 17:
- Asegúrate de que el source del servicio apunta al **fork con `db: supabase/postgres:17.x`**
  (branch/template correcto). Redeploy/Start del servicio.
- EasyPanel recreará `supabase_supabase-db-1` con la imagen 17 sobre el data dir convertido.

### 3b) Contingencia — Gotcha A: si PG17 **no arranca** por config
Síntoma (bucle de reinicio del db):
```
FATAL: configuration file "/etc/postgresql-custom/supautils.conf" contains errors
# (o ".../postgresql.conf contains errors")
```
Causa: el volumen `db-config` (montado en `/etc/postgresql-custom`, **persiste el upgrade**) trae
config de la era PG15 que PG17 rechaza (un `supautils.*`/parámetro core retirado). El data dir ya está
en 17 y los datos están intactos — solo la config del volumen molesta.

**Fix (conserva datos y el vault): regenerar db-config desde la imagen PG17 preservando `pgsodium_root.key`.**
Con la app parada:
```bash
cd /etc/easypanel/projects/supabase/supabase/code/supabase/code
COMPOSE_PROJECT_NAME=supabase_supabase PG17_IMAGE=supabase/postgres:17.6.1.150 \
  KEY_BACKUP="$PWD/volumes/db/pgsodium_root.key.bak.pg15" \
  bash utils/regen-db-config.sh
# [UI] Arrancar de nuevo en EasyPanel (db=17)
```
> **CRÍTICO:** NO borres el volumen sin preservar `pgsodium_root.key` — sin esa clave el vault/pgsodium
> queda inservible (`invalid secret key`, los secrets no desencriptan). `regen-db-config.sh` la preserva.

Alternativa proactiva (evita el bucle de entrada): correr la conversión con `REGEN_DB_CONFIG=true`
(o `--regen-db-config`) → el script regenera el db-config al finalizar, preservando la key.
**Recomendado para api.mando** por llevar meses corriendo (db-config de contenido desconocido).

### 4) Migraciones post-arranque (roles + colación)
Un `pg_upgrade` NO arrastra ciertas migraciones que en instalación limpia corren vía initdb.
Con la db ya arriba en 17:
```bash
cd /etc/easypanel/projects/supabase/supabase/code/supabase/code
COMPOSE_PROJECT_NAME=supabase_supabase bash utils/post-upgrade-pg17-roles.sh
```
Aplica: `REFRESH COLLATION VERSION` (quita el warning glibc 2.39→2.40), crea `supabase_etl_admin`,
y corre las 4 migraciones PG17 (`predefined_role_grants`, `grant_pg_reload_conf`, `search_path_pgbouncer`, `read_only_user`).

### 5) Verificación (gate antes de dar por buena la migración)
```bash
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-); ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
qq(){ docker exec -i -e PGPASSWORD="$PW" supabase_supabase-db-1 psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
qq -Atc "show server_version;"                       # -> 17.x
qq -f - < .../crm-mando/supabase/tests/10_rls_meta_test.sql        # RLS meta
qq -f - < .../crm-mando/supabase/tests/20_rls_isolation_test.sql   # RLS isolation (ON_ERROR_STOP)
qq -Atc "select rolname,rolsuper from pg_roles where rolname in ('postgres','supabase_etl_admin','supabase_read_only_user') order by 1;"
curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" https://api.mando.../rest/v1/tenants?select=count  # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $ANON" https://api.mando.../auth/v1/health                                                  # 200
# VAULT/pgsodium sobrevive (elige un secret existente y confirma que desencripta):
qq -Atc "select id, (decrypted_secret is not null) as ok from vault.decrypted_secrets limit 3;"
```
Criterio: server_version 17.x · ambos tests RLS sin error · `postgres` rolsuper=f · `supabase_etl_admin` y `supabase_read_only_user` presentes · /rest y /auth 200 · **vault desencripta** (si algún secret da NULL/error → la pgsodium key no sobrevivió; ver 3b/rollback).

### 6) Rollback (si algo falla)
```bash
# [UI] Parar la app en EasyPanel
cd /etc/easypanel/projects/supabase/supabase/code/supabase/code
rm -rf volumes/db/data
mv volumes/db/data.bak.pg15 volumes/db/data
```
**db-config, según el camino usado:**
```bash
# CASO A — NO se usó REGEN_DB_CONFIG (camino limpio): el db-config sigue siendo el de PG15,
# basta restaurar el ownership al uid de PG15:
docker run --rm -v supabase_supabase_db-config:/vol supabase/postgres:15.8.1.085 \
  chown -R postgres:postgres /vol/

# CASO B — SÍ se usó REGEN_DB_CONFIG (o la contingencia 3b): el db-config quedó con los
# DEFAULTS de PG17 -> NO sirve para PG15. Regenéralo para PG15 (regen-db-config.sh acepta
# CUALQUIER imagen vía PG17_IMAGE; aquí la de PG15), preservando la pgsodium key:
COMPOSE_PROJECT_NAME=supabase_supabase PG17_IMAGE=supabase/postgres:15.8.1.085 \
  KEY_BACKUP="$PWD/volumes/db/pgsodium_root.key.bak.pg15" \
  bash utils/regen-db-config.sh
```
```bash
# [UI] Apuntar EasyPanel de nuevo al fork con db=15 y arrancar
```
(Si el data dir quedó irrecuperable, o dudas del estado del db-config: restaurar del dump/snapshot del paso 0.)

### 7) Limpieza (tras validar en producción unos días)
```bash
rm -rf volumes/db/data.bak.pg15 volumes/db/pg17_upgrade_bin_*.tar.gz volumes/db/pgsodium_root.key.bak.pg15
```

## Puntos que dependen de la UI de EasyPanel
- Paso 1: **Stop** del servicio.
- Paso 3: apuntar el source/branch/template al fork con **db=17** y **Redeploy/Start** (mecanismo de persistencia; no editar compose en el server).
- Paso 6: Stop + re-apuntar a db=15 + Start.

## Notas / riesgos
- Ventana de indisponibilidad = pasos 1→5. El pg_upgrade escala con nº de objetos, no tanto con volumen; en el PoC (esquema Mando) fueron segundos.
- Disco: ~2× tamaño de datos + 5 GB (tarball 1.2 GB).
- Si EasyPanel reinicia el contenedor db durante el paso 2, aborta y reintenta con la app bien detenida (por eso el paso 1).
- El script NO arranca nada en conversion-only: si tras el paso 2 no ves la app arriba es lo esperado — la arranca EasyPanel en el paso 3.
- **Gotcha A (validado en PoC).** El volumen `db-config` persiste el upgrade con config de PG15. En el PoC (`15.8.1.085`→`17.6.1.150`, extensiones = api.mando) PG17 **arrancó bien**: el único drift real es el GUC `supautils.privileged_extensions_custom_scripts_path` (PG15) renombrado a `supautils.extension_custom_scripts_path` (PG17), que PG17 **tolera** (GUC de un prefijo custom; no es fatal). PERO si el db-config de api.mando (meses corriendo) trae un parámetro que PG17 sí rechaza, entra en el bucle `supautils.conf contains errors` — reproducido en PoC inyectando un GUC core retirado. Por eso: para api.mando usa la vía proactiva `REGEN_DB_CONFIG=true`, o ten lista la contingencia 3b. En ambos caminos (limpio y regen) **el vault/pgsodium sobrevive** (la pgsodium key se preserva).
