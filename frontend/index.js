// Module entry point. mff-core's auto-loader (App_frontend/src/core/moduleLoader.js)
// finds this file and calls register(coreApi) once at app startup - see
// docs/MFF-Core_module-core-api.md for the full coreApi contract. This file is the ONLY place
// this module's frontend talks to core.
//
// One dashboard tab with a sidebar shortcut (see docs/MFF-Core_module-ui-guide.md).
import Dashboard from './components/Dashboard';
import { createProjectsProvider } from './projectsProvider';
import manifest from '../module.manifest.json';

export function register(coreApi) {
  coreApi.registerDashboardTab(manifest.id, {
    key: manifest.id,
    label: manifest.label,
    component: () => <Dashboard coreApi={coreApi} />,
    sidebarEntry: true
  });

  // Core's shared project picker (coreApi.ui.ProjectPicker) is fed by this provider.
  // Not in core yet: feature-detected, so this is a no-op until core offers it.
  if (typeof coreApi.registerProjectsProvider === 'function') {
    coreApi.registerProjectsProvider(createProjectsProvider(coreApi));
  }
}
