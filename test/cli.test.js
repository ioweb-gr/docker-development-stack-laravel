'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseArgs, renderRuntimeConfig, renderRuntimeVolumes } = require('../src/cli');

test('Laravel runtime maps Commons database values without creating a local database', () => {
  const config = renderRuntimeConfig();
  assert.match(config, /DB_HOST=\$\{IOWEB_DDEV_DATABASE_HOST\}/);
  assert.match(config, /DB_DATABASE=\$\{IOWEB_DDEV_DATABASE_NAME\}/);
  assert.match(config, /IOWEB_LARAVEL_TEST_DB_DATABASE/);
  assert.match(config, /post-start/);
  assert.match(config, /sudo chown -R/);
  assert.doesNotMatch(config, /services:/);
});

test('Laravel runtime declares Docker volumes for Windows high-churn paths', () => {
  const config = renderRuntimeVolumes();
  for (const name of ['laravel_vendor', 'laravel_node_modules', 'laravel_storage_framework_cache', 'laravel_bootstrap_cache']) {
    assert.match(config, new RegExp(name));
  }
  assert.doesNotMatch(config, /hooks:/);
});

test('Artisan arguments pass through after global options', () => {
  const options = parseArgs(['artisan', '--project-root', 'C:/project', 'migrate', '--force']);
  assert.deepEqual(options._, ['artisan', 'migrate', '--force']);
  assert.equal(options['project-root'], 'C:/project');
});
