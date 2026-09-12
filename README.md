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

## Database operations

The consumer owns its dump and import decision:

```powershell
.\docker\laravel\bin\import.ps1 --dump docker\imports\dump.sql.gz
.\docker\laravel\bin\database.ps1 --execute "select count(*) from migrations"
```

Imports target only the active Commons allocation and require `--confirm` in
non-interactive execution. Keep URL/domain replacement policy in the consumer;
Laravel data may contain application-specific JSON or serialized values and
must not receive an unsafe whole-database text substitution by default.

## Diagnostics

The benchmark is bounded and read-only:

```powershell
.\docker\laravel\bin\benchmark.ps1 --url https://project.ddev.site/ --requests 10 --concurrency 2
.\docker\laravel\bin\audit.ps1 --url https://project.ddev.site/
ddev xdebug on
ddev xdebug off
ddev ioweb-profiler status
```

