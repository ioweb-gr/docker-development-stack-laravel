# IOWEB Laravel stack

This repository is a reusable native-DDEV Laravel adapter. It is not a
Laravel application and must not contain consumer credentials, domains, SQL
dumps, application data, or project-specific `.env` files.

## Runtime contract

- DDEV owns the Laravel PHP-FPM/Nginx lifecycle and routing.
- Commons owns the allocated MariaDB, Redis, search, and Mailpit services.
- The consumer receives the stack as `docker/laravel`.
- The generated Laravel runtime config maps `DB_*` to the Commons allocation.
- High-churn `vendor`, `node_modules`, Laravel framework caches, and
  `bootstrap/cache` paths use DDEV-managed Docker volumes on Windows/WSL2.
- Do not add a project-local database, Redis, proxy, or Mailpit service.
- Do not start queues, scheduler work, mail delivery, or external
  synchronisation automatically.

## Consumer commands

Run wrappers from the Laravel consumer root:

```text
docker/laravel/bin/artisan.ps1 about
docker/laravel/bin/database.ps1 --execute "select 1"
docker/laravel/bin/import.ps1 --dump docker/imports/dump.sql.gz
docker/laravel/bin/benchmark.ps1 --url https://project.ddev.site/
docker/laravel/bin/audit.ps1 --url https://project.ddev.site/
```

All database imports require explicit confirmation. The wrapper is limited to
the currently allocated Commons database and cannot select another project or
run provisioning operations.

