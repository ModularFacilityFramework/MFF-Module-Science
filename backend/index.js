// Module entry point. mff-core's auto-loader (App_backend/src/core/services/moduleLoader.js)
// requires this file and calls register(coreApi) once at startup - see docs/MFF-Core_module-core-api.md
// for the full coreApi contract. This file is the ONLY place this module talks to core.
const express = require('express');
const manifest = require('../module.manifest.json');
const { createPool } = require('./config/database');
const buildProjectRouter = require('./routes/projectRoutes');
const buildMaterialRouter = require('./routes/materialRoutes');
const buildExternalRouter = require('./routes/externalRoutes');
const { createServerProjectsProvider } = require('./services/projectsProvider');
const { ensureTemplateQuietly } = require('./services/template');

async function createTemplateAtStartup(coreApi) {
  let conn;
  try {
    conn = await coreApi.pool.getConnection();
    await ensureTemplateQuietly(conn, coreApi);
  } catch (err) {
    console.warn(`[science] could not create the Project template at startup: ${err.message}`);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = function register(coreApi) {
  // Own database, credentials from coreApi.getModuleConfig(); shadows core's pool for every route below.
  const moduleApi = { ...coreApi, pool: createPool(coreApi) };
  const router = express.Router();
  router.use(buildProjectRouter(moduleApi));
  router.use(buildMaterialRouter(moduleApi));
  router.use(buildExternalRouter(moduleApi));
  // Core serves projects to every signed-in user from this provider, so a member
  // without a Science grant can still use the picker. Older cores lack it.
  if (typeof coreApi.registerProjectsProvider === 'function') {
    coreApi.registerProjectsProvider(createServerProjectsProvider(moduleApi));
  }
  // The Project template exists from the start, on a new and an existing install.
  // If this attempt fails, the next project list or template call tries again.
  createTemplateAtStartup(moduleApi);
  return {
    router,
    moduleId: manifest.id,
    label: manifest.label,
    version: manifest.version
  };
};
