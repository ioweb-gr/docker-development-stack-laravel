# IOWEB Laravel development stack

Project-neutral Laravel integration for the IOWEB native-DDEV and Commons
workflow.

The stack deliberately does not provide a standalone Compose runtime. DDEV
serves the Laravel application from `public/`, while the Commons handoff
provides the MariaDB connection through `IOWEB_DDEV_DATABASE_*`. The generated
runtime fragment also exposes the integration database metadata for explicit
test configuration without changing the application database.

## Consumer setup

From the Laravel project root:

```powershell
docker-bootstrap --project-type laravel
ddev start
ddev composer install
ddev exec -s web php artisan key:generate
ddev exec -s web php artisan migrate
```

The bootstrap creates `docker/laravel`, the native DDEV config, Commons
handoff files, and ignored runtime fragments. It does not run migrations,
queues, the scheduler, mail delivery, or application synchronisation.
The generated `.ddev/php/90-ioweb-fpm-performance.ini` keeps timestamp
validation enabled with a 120-second revalidation interval and sets the
realpath cache to 32M for both DDEV PHP SAPIs after `ddev restart`.

## Database operations

The consumer owns its dump and import decision:

```powershell
.\docker\laravel\bin\import.ps1 --dump docker\imports\dump.sql.gz
.\docker\laravel\bin\database.ps1 --execute "select count(*) from migrations"
```

Imports target only the active Commons allocation and require `--confirm` in
non-interactive execution. Umbrella bootstrapping also installs the shared
restore command, which supports the same replacement, table exclusion, and
post-import SQL stages:

```powershell
ddev ioweb-import --dump docker/imports/dump.sql.gz
ddev ioweb-import --dry-run
```

Keep replacement policy in the consumer and review the manifest first; Laravel
data may contain application-specific JSON or serialized values.

## Diagnostics

The benchmark is bounded and read-only:

```powershell
.\docker\laravel\bin\benchmark.ps1 --url https://project.ddev.site/ --requests 10 --concurrency 2
.\docker\laravel\bin\audit.ps1 --url https://project.ddev.site/
ddev xdebug on
ddev xdebug off
ddev ioweb-profiler status
```
