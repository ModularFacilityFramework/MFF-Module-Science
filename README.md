# MFF-Module-Science

The `science` module of MFF (display name **Science**): research work per project.

## What it does today

- **Projects**: a number (P-0001), title, optional text, one owner (who can hand it over) and a stored folder path. The Projects tab lists the projects a user can reach and opens the project page (overview, items, materials, sharing).
- **Sharing**: share a project with a user or a group, read by default, raised to write. Access adds up (the highest grant wins). Administrators and developers see and manage every project. Access control is at the application level only; this module sets no file permissions.
- **Materials**: proteins, complexes and ligands. Each record has an owner and is private or public. Public records can be linked into anyone's projects; private ones only into projects owned by their owner. One record can be in many projects.
- **Items**: every job or object another module records against a project, shown on the project page. An item from a module the viewer cannot use is greyed out.
- **API for other modules** (`/external/...`, call it through `coreApi.callModule` with `"science"` in the module's `requires`): list projects, check a user's access to one, register and remove items. See `backend/routes/externalRoutes.js`.
- **Projects provider** (`frontend/projectsProvider.js`): registered with core through `coreApi.registerProjectsProvider` once core offers it, to feed core's shared project picker.

Not built yet: sample declarations, BAG, shipments.

## Quick start

```bash
nvm exec 20 npm install
nvm exec 20 npm run lint
nvm exec 20 npm test
```

There is no local dev harness and no `npm run dev`: to run the module, `git clone` it into a real mff-core checkout's `App_frontend/src/core/science/` (see `docs/MFF-Core_module-database-provisioning.md`).

## Structure

```
module.manifest.json    # id, label, version, tablePrefix, mountPath
backend/
  db/schema.sql         # the single source of truth for this module's tables
  routes/               # projectRoutes (UI), materialRoutes, externalRoutes (other modules)
  services/             # access rules (pure, unit-tested), people, project queries
  tests/                # node --test unit tests
frontend/
  components/           # Dashboard, ProjectsTab, ProjectPage, SharingPanel, MaterialsTab ...
  lib/                  # shared styles, page-state wrapper
docs/                   # link to the shared docs repo
```

Optional setting: `MODULE_SCIENCE_DATA_BASE_DIR` in core's `.env` (an absolute path). When set, each new project gets the stored path `<base>/projects/P-0001_<short-title>`.
