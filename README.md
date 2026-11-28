# MFF-Module-Science

The `science` module of MFF (display name **Science**): research work per project.

## What it does today

- **Projects**: a number (P-0001), title, optional text, one owner (who can hand it over) and a stored folder path. The Projects tab lists the projects a user can reach and opens the project page (overview, items, materials, sharing).
- **Sharing**: share a project with a user or a group, read by default, raised to write. Access adds up (the highest grant wins). Administrators and developers see and manage every project. Access control is at the application level only; this module sets no file permissions.
- **Materials**: proteins, complexes and ligands. Each record has an owner and is private or public. Public records can be linked into anyone's projects; private ones only into projects owned by their owner. One record can be in many projects.
- **A project before project work**: someone who can write in no project (the Project template and archived projects do not count) cannot create one. Administrators and developers always can. Someone who has a project may create as many as they want: there is no limit on the number, and disk quotas, later, are the only limit planned. On core 0.1.227 or later, core's rule (this one, plus core's setting "people with a project may create more") decides who may create, in Science too. The rules are in `backend/services/membership.js`; modules ask `GET /external/project-status`.
- **Request a project**: such a person asks on the "Project requests" tab (title, a short text, optionally a group and a PI). An approver creates it, with the requester as owner, or declines, with an optional note. Approvers are administrators, developers and whoever is granted the page "Approve project requests" (Setup -> Preferences -> Access). A decision is shown inside Science until seen, and on core 0.1.227 or later the requester is also notified through core (`backend/services/coreExtras.js`). Removing or lowering a share is always allowed, with a warning when it leaves someone with no project.
- **Old local projects**: a module can import the projects it kept itself before using Science, each owned by the user it acts for (`POST /external/project-imports`). Only modules can call it, never people. No approval is needed, even for someone's first project. It is safe to repeat, and each import is recorded with the module that made it (`backend/services/imports.js`). Science cannot check that a project really is old: that is the calling module's duty.
- **Items**: every job or object another module records against a project, shown on the project page. An item from a module the viewer cannot use is greyed out.
- **Project template**: one project that Science creates itself, once, on a new or an existing installation (`backend/services/template.js`). Its owner is the first administrator or developer; everyone has read access, which the owner can change. It is the example project, and it holds the work modules did before projects existed. In it each person sees only the items they made; its owner, administrators and developers see all.
- **API for other modules** (`/external/...`, call it through `coreApi.callModule` with `"science"` in the module's `requires`): list projects, ask whether a user has a project, check a user's access to one, read, register and remove items, move older work into the Project template, and import old local projects. See `backend/routes/externalRoutes.js`.
- **Projects provider** (feeds core's shared project picker): `backend/services/projectsProvider.js` is registered with core where it serves projects itself (so a project member needs no Science grant). It also offers per-module item counts, a project's items, the same status, project requests, and the calls for core's registration approval screen, used by core 0.1.227 or later. `frontend/projectsProvider.js` is the fallback for an older core. After a change to who sees or writes a project, Science's pages tell core, so its project tabs refresh (`frontend/lib/projectsChanged.js`).

Every table sorts with core's shared helpers (two buttons per column, natural order, the choice saved per user; core 0.1.223 or later). The module has no sorting of its own for tables: use `frontend/lib/sorting.js` for any new one.

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
  routes/               # projectRoutes, requestRoutes, materialRoutes (UI), externalRoutes (other modules)
  services/             # access rules (pure, unit-tested), people, project queries, membership, requests, approval assignment, newer core features, items, the Project template, old-project imports
  tests/                # node --test unit tests
frontend/
  components/           # Dashboard, ProjectsTab, ProjectPage, SharingPanel, MaterialsTab, RequestsTab ...
  lib/                  # shared styles, page-state and table-sorting wrappers, project-tabs refresh
docs/                   # link to the shared docs repo
```

Optional setting: `MODULE_SCIENCE_DATA_BASE_DIR` in core's `.env` (an absolute path). When set, each new project gets the stored path `<base>/projects/P-0001_<short-title>`.
