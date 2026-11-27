// The API for everything outside Science's own pages:
//  - core's shared ProjectPicker, from the browser (frontend/projectsProvider.js):
//    GET /external/projects, GET /external/projects/:id, POST /external/projects;
//  - other modules' backends (coreApi.callModule / callModuleAsUser, with
//    "science" in their manifest "requires"): the same, plus checking the user's
//    access to a project, reading, registering and removing the items in it, and
//    moving their older work into the Project template.
// Every route authenticates the user and applies the same access rules as the
// UI; core letting a call through to Science never skips the project checks.
const express = require('express');
const { route, HttpError, parseId } = require('../services/http');
const { canWrite, itemsLimitedTo } = require('../services/access');
const { loadPeople } = require('../services/people');
const { loadProjectAccess, accessFlags, listProjects, getProjectSummary, createProject } = require('../services/projects');
const { findTemplateId, ensureTemplate, ensureTemplateQuietly } = require('../services/template');
const { parseItem, listItems, upsertItem, removeItem, adoptItems } = require('../services/items');

module.exports = function buildRouter(coreApi) {
  const router = express.Router();
  const auth = coreApi.authenticateToken;
  const pool = coreApi.pool;

  // The module that is calling, as core vouches for it. A user's own direct call has none.
  function callerModule(req) {
    const id = req.delegatedFrom || (req.user && req.user.backgroundBy);
    if (!id) throw new HttpError(400, 'This route is for modules: call it through coreApi.callModule');
    return String(id);
  }

  async function requireProject(conn, req, need = 'read') {
    const loaded = await loadProjectAccess(conn, parseId(req.params.id, 'project id'), req.user);
    if (!loaded || loaded.access === 'none') throw new HttpError(404, 'Project not found');
    if (need === 'write' && !canWrite(loaded.access)) throw new HttpError(403, 'You need write access to this project');
    return loaded;
  }

  // The Project template's row, creating it when missing. 503 while nobody can own it.
  async function requireTemplate(conn) {
    const id = await ensureTemplate(conn, coreApi);
    if (id === null) throw new HttpError(503, 'The Project template is not ready: there is no administrator or developer to own it yet');
    const [p] = await conn.query('SELECT id, number, title, archived FROM science_projects WHERE id = ?', [id]);
    return { id: Number(p.id), number: p.number, title: p.title, archived: !!p.archived };
  }

  // GET /external/projects?scope=&search=&archived=1 - the "projects provider" list. Read-only projects are
  // included with can_write false, so a picker can grey them out when a module needs write.
  router.get('/external/projects', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const scope = ['mine', 'shared', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
    await ensureTemplateQuietly(conn, coreApi);
    res.json(await listProjects(conn, req.user, people, { scope, search: req.query.search, includeArchived: req.query.archived === '1' }));
  }));

  // GET /external/projects/:id - one project in the same flat shape as the list; 404 when the user may not read it.
  router.get('/external/projects/:id', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const project = await getProjectSummary(conn, parseId(req.params.id, 'project id'), req.user, people);
    if (!project) throw new HttpError(404, 'Project not found');
    res.json(project);
  }));

  // POST /external/projects { title, description? } - the picker's "+ New project". The user becomes the owner.
  router.post('/external/projects', auth, route(pool, async (req, res, conn) => {
    await ensureTemplateQuietly(conn, coreApi);
    const { id } = await createProject(conn, coreApi, req.user, req.body || {});
    res.status(201).json(await getProjectSummary(conn, id, req.user, await loadPeople(coreApi)));
  }));

  // GET /external/projects/:id/access - what may this user do in the project?
  router.get('/external/projects/:id/access', auth, route(pool, async (req, res, conn) => {
    const loaded = await loadProjectAccess(conn, parseId(req.params.id, 'project id'), req.user);
    if (!loaded || loaded.access === 'none') throw new HttpError(404, 'Project not found');
    const { project, access } = loaded;
    res.json({
      project: { id: project.id, number: project.number, title: project.title, archived: !!project.archived, folder_path: project.folder_path },
      ...accessFlags(access)
    });
  }));

  // GET /external/projects/:id/items?module_id= - the project's registered items. Needs read.
  // In the Project template: only the user's own, unless they own it or are staff.
  router.get('/external/projects/:id/items', auth, route(pool, async (req, res, conn) => {
    const { project, access } = await requireProject(conn, req);
    const moduleId = typeof req.query.module_id === 'string' && req.query.module_id ? req.query.module_id : null;
    const isTemplate = (await findTemplateId(conn)) === Number(project.id);
    const onlyCreatedBy = itemsLimitedTo({ isTemplate, access, user: req.user });
    res.json(await listItems(conn, project.id, await loadPeople(coreApi), { moduleId, onlyCreatedBy }));
  }));

  // POST /external/projects/:id/items { item_type, item_id, title, status?, link? } - register or update an item. Needs write.
  // Calling again with the same item_type + item_id updates it (e.g. a new status).
  router.post('/external/projects/:id/items', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const { project } = await requireProject(conn, req, 'write');
    if (project.archived) throw new HttpError(409, 'This project is archived');
    await upsertItem(conn, project.id, moduleId, parseItem(req.body || {}), req.user.id);
    await conn.query('UPDATE science_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [project.id]);
    res.status(201).json({ success: true });
  }));

  // DELETE /external/projects/:id/items/:itemType/:itemId - a module removes one of its own items. Needs write.
  router.delete('/external/projects/:id/items/:itemType/:itemId', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const { project } = await requireProject(conn, req, 'write');
    await removeItem(conn, project.id, moduleId, req.params.itemType, req.params.itemId);
    res.json({ success: true });
  }));

  // The Project template: which project it is, and a module's work from before
  // projects existed. People only have the access its sharing gives them; a
  // module manages its OWN old items there whatever that sharing says, because
  // the people whose work it is have no write access to the template.

  // GET /external/template - { id, number, title, archived }. Creates the project when it is missing.
  router.get('/external/template', auth, route(pool, async (req, res, conn) => {
    res.json(await requireTemplate(conn));
  }));

  // POST /external/template/items { items: [{ item_type, item_id, title, status?, link?, created_by?, created_at? }] }
  // - move (or later update) the calling module's project-less items. Safe to repeat.
  router.post('/external/template/items', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const project = await requireTemplate(conn);
    res.json({ project, ...(await adoptItems(conn, project.id, moduleId, (req.body || {}).items)) });
  }));

  // DELETE /external/template/items/:itemType/:itemId - the calling module removes one of its own (deleted, or moved to a real project).
  router.delete('/external/template/items/:itemType/:itemId', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const project = await requireTemplate(conn);
    await removeItem(conn, project.id, moduleId, req.params.itemType, req.params.itemId);
    res.json({ success: true });
  }));

  return router;
};
