const mariadb = require('mariadb');

// This module's own database pool. The credentials come from core, never from a
// file of our own: coreApi.getModuleConfig() returns the MODULE_SCIENCE_DB_*
// values core's provisioner wrote into App_backend/.env, with the prefix
// stripped (docs/MFF-Core_env-policy.md). The pool is created inside register()
// (see ../index.js), because getModuleConfig() is bound to this module by core
// and has nothing to read at require time.
function createPool(coreApi) {
  const cfg = coreApi.getModuleConfig();
  if (!cfg.DB_USER || !cfg.DB_NAME) {
    // The loader logs this and skips the module, instead of every request failing later with "access denied".
    throw new Error('science: database credentials are missing (MODULE_SCIENCE_DB_USER / _NAME): run Install/Update for this module so core provisions its database');
  }
  return mariadb.createPool({
    host: cfg.DB_HOST || '127.0.0.1',
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    database: cfg.DB_NAME,
    connectionLimit: Number(cfg.DB_CONNECTION_LIMIT) || 5,
    bigIntAsNumber: true,
    insertIdAsNumber: true
  });
}

module.exports = { createPool };
