'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseArgs, renderRuntime, renderRuntimeConfig, renderRuntimeVolumes, renderPhpPerformance } = require('../src/cli');

test('Laravel runtime maps Commons database values without creating a local database', () => {
  const config = renderRuntimeConfig();
  assert.match(config, /DB_HOST=\$\{IOWEB_DDEV_DATABASE_HOST\}/);
  assert.match(config, /DB_DATABASE=\$\{IOWEB_DDEV_DATABASE_NAME\}/);
  assert.match(config, /IOWEB_LARAVEL_TEST_DB_DATABASE/);
  assert.doesNotMatch(config, /services:/);
});

test('Laravel runtime declares Docker volumes for Windows high-churn paths', () => {
  const config = renderRuntimeVolumes();
  for (const name of ['laravel_vendor', 'laravel_node_modules', 'laravel_storage_framework_cache', 'laravel_bootstrap_cache']) {
    assert.match(config, new RegExp(name));
  }
});

test('Laravel runtime declares the shared FPM timestamp and realpath policy', () => {
  const config = renderPhpPerformance();
  assert.match(config, /opcache\.validate_timestamps = 1/);
  assert.match(config, /opcache\.revalidate_freq = 120/);
  assert.match(config, /realpath_cache_size = 32M/);
  assert.match(config, /realpath_cache_ttl = 7200/);
});

test('Laravel runtime renderer writes the managed PHP performance file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ioweb-laravel-'));
  try {
    const first = renderRuntime(root, { quiet: true });
    assert.match(fs.readFileSync(first.php, 'utf8'), /ioweb-managed: docker-bootstrap Laravel FPM performance v1/);
    const content = fs.readFileSync(first.php, 'utf8');
    const second = renderRuntime(root, { quiet: true });
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(second.php, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Artisan arguments pass through after global options', () => {
  const options = parseArgs(['artisan', '--project-root', 'C:/project', 'migrate', '--force']);
  assert.deepEqual(options._, ['artisan', 'migrate', '--force']);
  assert.equal(options['project-root'], 'C:/project');
});
