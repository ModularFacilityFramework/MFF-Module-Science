// The pool's credentials come from coreApi.getModuleConfig(), never from a file.
const test = require('node:test');
const assert = require('node:assert/strict');

// Replace the mariadb driver with a recorder before database.js loads it.
const driverPath = require.resolve('mariadb');
let seen = null;
require.cache[driverPath] = { id: driverPath, filename: driverPath, loaded: true, exports: { createPool: (opts) => { seen = opts; return { fake: true }; } } };
const { createPool } = require('../config/database');

test('the pool is built from the module config core provides', () => {
  const pool = createPool({ getModuleConfig: () => ({ DB_HOST: 'db.example', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'mff_module_science', DB_CONNECTION_LIMIT: '8' }) });
  assert.deepEqual(pool, { fake: true });
  assert.equal(seen.host, 'db.example');
  assert.equal(seen.user, 'u');
  assert.equal(seen.password, 'p');
  assert.equal(seen.database, 'mff_module_science');
  assert.equal(seen.connectionLimit, 8);
  assert.equal(seen.bigIntAsNumber, true);
  assert.equal(seen.insertIdAsNumber, true);
});

test('defaults: local host, 5 connections', () => {
  createPool({ getModuleConfig: () => ({ DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' }) });
  assert.equal(seen.host, '127.0.0.1');
  assert.equal(seen.connectionLimit, 5);
});

test('missing credentials fail loudly at register time, not as "access denied" on every request', () => {
  assert.throws(() => createPool({ getModuleConfig: () => ({}) }), /database credentials are missing/);
});
