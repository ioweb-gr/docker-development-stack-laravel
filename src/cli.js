#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const readline = require('node:readline');
const { performance } = require('node:perf_hooks');
const zlib = require('node:zlib');

const RUNTIME_MARKER = '# ioweb-managed: docker-bootstrap Laravel Commons runtime v1';
const VOLUME_MARKER = '# ioweb-managed: docker-bootstrap Laravel runtime volumes v1';
const RUNTIME_FILE = 'config.ioweb-laravel-runtime.yaml';
const VOLUME_FILE = 'docker-compose.ioweb-laravel-runtime-volumes.yaml';
const DEFAULT_DUMP_FILE = 'docker/imports/dump.sql.gz';

function usage() {
  return [
    'Usage: node src/cli.js <command> [options]',
    '',
    'Commands:',
    '  render-runtime  Generate Commons environment and Laravel volume fragments',
    '  artisan         Run arbitrary Laravel Artisan arguments in DDEV',
    '  database        Run the Commons-scoped MariaDB client',
    '  import          Import an SQL or SQL.GZ dump into the Commons database',
    '  benchmark       Run a bounded HTTP benchmark',
    '  audit           Report PHP runtime settings and run the benchmark',
    '',
    'Options:',
    '  --project-root DIR   Laravel consumer root; defaults to the current directory',
    '  --url URL             HTTP target for benchmark/audit',
    '  --requests N          Number of requests, 1-100 (default: 10)',
    '  --concurrency N       Parallel requests, 1-10 (default: 2)',
    '  --timeout-ms N        Per-request timeout (default: 30000)',
    '  --output FILE         Write a JSON report relative to the project root',
    '  --dump FILE           SQL or SQL.GZ dump relative to the project root',
    '  --confirm             Confirm an import without an interactive prompt',
    '  --force               Replace unmanaged generated runtime fragments',
    '  --insecure            Allow invalid TLS for non-local benchmark targets',
    '  --quiet               Suppress human-readable output',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { _: [] };
  const valueOptions = new Set(['project-root', 'url', 'requests', 'concurrency', 'timeout-ms', 'output', 'dump']);
  let passThrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (passThrough || (options._[0] === 'artisan' && token.startsWith('--') && !valueOptions.has(token.slice(2)))) {
      options._.push(token);
      continue;
    }
    if (token === '--') {
      passThrough = true;
      continue;
    }
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'help') {
      options.help = true;
      continue;
    }
    if (valueOptions.has(key)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (!['confirm', 'force', 'insecure', 'quiet'].includes(key)) throw new Error(`Unknown option: --${key}`);
    options[key] = true;
  }
  return options;
}

function projectRoot(options) {
  const root = path.resolve(options['project-root'] || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  return root;
}

function resolveProjectFile(root, requested, fallback, label) {
  const relative = String(requested || fallback).trim();
  if (!relative) throw new Error(`${label} path is required.`);
  const hostPath = path.resolve(root, relative);
  const withinRoot = path.relative(root, hostPath);
  if (!withinRoot || withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) {
    throw new Error(`${label} must be inside the consumer project root: ${relative}`);
  }
  return {
    hostPath,
    relativePath: withinRoot.replaceAll('\\', '/'),
    containerPath: `/var/www/html/${withinRoot.replaceAll('\\', '/')}`,
  };
}

function managedTextEqual(left, right) {
  return String(left).replace(/\r\n/g, '\n').replace(/\s+$/g, '')
    === String(right).replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}

function writeManagedFile(destination, content, marker, force) {
  const existing = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : '';
  if (existing && !existing.includes(marker) && !force) {
    throw new Error(`Refusing to overwrite unmanaged Laravel runtime file: ${destination}`);
  }
  if (!managedTextEqual(existing, content)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, 'utf8');
    return true;
  }
  return false;
}

function renderRuntimeConfig() {
  return [
    RUNTIME_MARKER,
    '# Generated local state. It is ignored and reconciled by docker-bootstrap.',
    'web_environment:',
    '  - DB_CONNECTION=mysql',
    '  - DB_HOST=${IOWEB_DDEV_DATABASE_HOST}',
    '  - DB_PORT=${IOWEB_DDEV_DATABASE_PORT}',
    '  - DB_DATABASE=${IOWEB_DDEV_DATABASE_NAME}',
    '  - DB_USERNAME=${IOWEB_DDEV_DATABASE_USER}',
    '  - DB_PASSWORD=${IOWEB_DDEV_DATABASE_PASSWORD}',
    '  - IOWEB_LARAVEL_TEST_DB_HOST=${IOWEB_DDEV_DATABASE_INTEGRATION_HOST}',
    '  - IOWEB_LARAVEL_TEST_DB_PORT=${IOWEB_DDEV_DATABASE_INTEGRATION_PORT}',
    '  - IOWEB_LARAVEL_TEST_DB_DATABASE=${IOWEB_DDEV_DATABASE_INTEGRATION_NAME}',
    '  - IOWEB_LARAVEL_TEST_DB_USERNAME=${IOWEB_DDEV_DATABASE_INTEGRATION_USER}',
    '  - IOWEB_LARAVEL_TEST_DB_PASSWORD=${IOWEB_DDEV_DATABASE_INTEGRATION_PASSWORD}',
    '  - MAIL_MAILER=smtp',
    '  - MAIL_HOST=ioweb-commons-mailpit',
    '  - MAIL_PORT=1025',
    '',
  ].join('\n');
}

function renderRuntimeVolumes() {
  return [
    VOLUME_MARKER,
    '# Docker-managed volumes keep Laravel high-churn paths off Windows bind mounts.',
    'services:',
    '  web:',
    '    volumes:',
    '      - laravel_vendor:/var/www/html/vendor',
    '      - laravel_node_modules:/var/www/html/node_modules',
    '      - laravel_storage_framework_cache:/var/www/html/storage/framework/cache',
    '      - laravel_storage_framework_sessions:/var/www/html/storage/framework/sessions',
    '      - laravel_storage_framework_views:/var/www/html/storage/framework/views',
    '      - laravel_bootstrap_cache:/var/www/html/bootstrap/cache',
    'hooks:',
    '  post-start:',
    '    - exec: "sudo chown -R $(stat -c \'%u:%g\' /var/www/html) /var/www/html/vendor /var/www/html/node_modules /var/www/html/storage/framework/cache /var/www/html/storage/framework/sessions /var/www/html/storage/framework/views /var/www/html/bootstrap/cache"',
    'volumes:',
    '  laravel_vendor:',
    '  laravel_node_modules:',
    '  laravel_storage_framework_cache:',
    '  laravel_storage_framework_sessions:',
    '  laravel_storage_framework_views:',
    '  laravel_bootstrap_cache:',
    '',
  ].join('\n');
}

function renderRuntime(root, options = {}) {
  const runtime = path.join(root, '.ddev', RUNTIME_FILE);
  const volumes = path.join(root, '.ddev', VOLUME_FILE);
  const changed = [
    writeManagedFile(runtime, renderRuntimeConfig(), RUNTIME_MARKER, options.force),
    writeManagedFile(volumes, renderRuntimeVolumes(), VOLUME_MARKER, options.force),
  ];
  if (!options.quiet) console.log(`[laravel] ${changed.some(Boolean) ? 'reconciled' : 'runtime files already current'} .ddev`);
  return { runtime, volumes, changed: changed.some(Boolean) };
}

function ddevCommand() {
  const candidates = process.platform === 'win32' ? ['ddev.exe', 'ddev.cmd', 'ddev'] : ['ddev'];
  for (const candidate of candidates) {
    const probe = childProcess.spawnSync(candidate, ['version'], { stdio: 'ignore', shell: false });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('DDEV executable is not available on PATH.');
}

function runDdev(root, args, options = {}) {
  const result = childProcess.spawnSync(ddevCommand(), args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim();
    throw new Error(`DDEV command failed${detail ? `: ${detail}` : '.'}`);
  }
  return result;
}

function confirmOperation(question, options = {}) {
  if (options.confirm) return Promise.resolve(true);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.reject(new Error(`${question} Re-run interactively or pass --confirm.`));
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    input.question(`${question} [y/N] `, (answer) => {
      input.close();
      resolve(/^(y|yes)$/i.test(String(answer || '').trim()));
    });
  }).then((confirmed) => {
    if (!confirmed) throw new Error('Operation cancelled.');
    return true;
  });
}

function runArtisan(options) {
  const root = projectRoot(options);
  const args = options._.slice(1);
  if (!args.length) throw new Error('artisan requires at least one Artisan argument.');
  runDdev(root, ['exec', '-s', 'web', 'php', 'artisan', ...args]);
}

function runDatabase(options) {
  const root = projectRoot(options);
  runDdev(root, ['ioweb-database', ...options._.slice(1)]);
}

function importDatabase(options) {
  const root = projectRoot(options);
  const dump = resolveProjectFile(root, options.dump, DEFAULT_DUMP_FILE, 'Laravel SQL dump');
  if (!fs.existsSync(dump.hostPath) || !fs.statSync(dump.hostPath).isFile()) throw new Error(`Laravel SQL dump does not exist: ${dump.relativePath}`);
  return confirmOperation(`Import ${dump.relativePath} into the current Commons database?`, options).then(() => new Promise((resolve, reject) => {
    const child = childProcess.spawn(ddevCommand(), ['ioweb-database'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], shell: false });
    const input = dump.hostPath.toLowerCase().endsWith('.gz')
      ? fs.createReadStream(dump.hostPath).pipe(zlib.createGunzip())
      : fs.createReadStream(dump.hostPath);
    input.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`DDEV database import failed with exit code ${code}.`));
      else {
        if (!options.quiet) console.log(`[laravel] imported ${dump.relativePath}`);
        resolve({ dump: dump.relativePath });
      }
    });
    input.pipe(child.stdin);
  }));
}

function requestOnce(target, timeoutMs, insecure) {
  return new Promise((resolve) => {
    const parsed = new URL(target);
    const client = parsed.protocol === 'https:' ? https : http;
    const started = performance.now();
    const request = client.request(parsed, { rejectUnauthorized: !insecure }, (response) => {
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; });
      response.on('end', () => resolve({ status: response.statusCode || null, bytes, duration_ms: Number((performance.now() - started).toFixed(3)) }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ status: null, bytes: 0, duration_ms: Number((performance.now() - started).toFixed(3)), error: error.message }));
    request.end();
  });
}

async function benchmark(options) {
  const target = String(options.url || '').trim();
  if (!target) throw new Error('--url is required for benchmark/audit.');
  const requests = Math.max(1, Math.min(100, Number(options.requests || 10)));
  const concurrency = Math.max(1, Math.min(10, Number(options.concurrency || 2)));
  const timeoutMs = Math.max(100, Number(options['timeout-ms'] || 30000));
  const results = [];
  for (let offset = 0; offset < requests; offset += concurrency) {
    results.push(...await Promise.all(Array.from({ length: Math.min(concurrency, requests - offset) }, () => requestOnce(target, timeoutMs, options.insecure))));
  }
  const durations = results.map((result) => result.duration_ms).sort((left, right) => left - right);
  const successful = results.filter((result) => result.status >= 200 && result.status < 400);
  const percentile = (fraction) => durations[Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * fraction) - 1))];
  const report = {
    schema: 'ioweb-laravel-benchmark/v1',
    target,
    requests,
    concurrency,
    successful: successful.length,
    failed: requests - successful.length,
    timings_ms: { min: durations[0], p50: percentile(0.5), p95: percentile(0.95), max: durations[durations.length - 1] },
    errors: results.filter((result) => result.error).map((result) => result.error),
  };
  if (options.output) {
    const output = resolveProjectFile(projectRoot(options), options.output, options.output, 'Report output');
    fs.mkdirSync(path.dirname(output.hostPath), { recursive: true });
    fs.writeFileSync(output.hostPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (!options.quiet) console.log(`Laravel benchmark: ${report.successful}/${report.requests} successful, p95 ${report.timings_ms.p95}ms`);
  return report;
}

function runtimeAudit(options) {
  const root = projectRoot(options);
  const code = "echo json_encode(['php_version'=>PHP_VERSION,'memory_limit'=>ini_get('memory_limit'),'opcache_enabled'=>(bool)ini_get('opcache.enable'),'opcache_revalidate_freq'=>ini_get('opcache.revalidate_freq')]);";
  const result = childProcess.spawnSync(ddevCommand(), ['exec', '-s', 'web', 'php', '-r', code], { cwd: root, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error(`DDEV PHP audit failed${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
  const match = String(result.stdout || '').match(/\{[^\r\n]*\}\s*$/);
  if (!match) throw new Error('DDEV PHP audit returned no JSON runtime data.');
  return JSON.parse(match[0]);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || options._[0] === undefined) {
    console.log(usage());
    return 0;
  }
  const command = options._[0];
  if (command === 'render-runtime') {
    renderRuntime(projectRoot(options), options);
    return 0;
  }
  if (command === 'artisan') {
    runArtisan(options);
    return 0;
  }
  if (command === 'database') {
    runDatabase(options);
    return 0;
  }
  if (command === 'import') {
    await importDatabase(options);
    return 0;
  }
  if (command === 'benchmark') {
    await benchmark(options);
    return 0;
  }
  if (command === 'audit') {
    const runtime = runtimeAudit(options);
    if (!options.quiet) console.log(`PHP: ${runtime.php_version}; OPcache: ${runtime.opcache_enabled ? 'enabled' : 'disabled'}`);
    await benchmark(options);
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  benchmark,
  importDatabase,
  parseArgs,
  renderRuntime,
  renderRuntimeConfig,
  renderRuntimeVolumes,
  runtimeAudit,
};
