// The API other modules use (through coreApi.callModule / callModuleAsUser, with
// "science" in their manifest "requires"): list the projects a user may pick,
// check the user's access to one, and register or remove the items a module
// created in it. Every route authenticates the user and applies the same
// access rules as the UI; core's delegation only lifts Science's own module
// and page grants, never the project checks below.
const express = require('express');
const { route, HttpError, cleanString, cleanLink, parseId } = require('../services/http');
const { canWrite } = require('../services/access');
const { loadPeople } = require('../services/people');
const { loadProjectAccess, accessFlags, listProjects } = require('../services/projects');

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

  // GET /external/projects?scope=&search=&archived=1 - the "projects provider" list. Read-only projects are
  // included with can_write false, so a picker can grey them out when a module needs write.
  router.get('/external/projects', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const scope = ['mine', 'shared', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
    res.json(await listProjects(conn, req.user, people, { scope, search: req.query.search, includeArchived: req.query.archived === '1' }));
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

  // POST /external/projects/:id/items { item_type, item_id, title, status?, link? } - register or update an item. Needs write.
  // Calling again with the same item_type + item_id updates it (e.g. a new status).
  router.post('/external/projects/:id/items', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const loaded = await loadProjectAccess(conn, parseId(req.params.id, 'project id'), req.user);
    if (!loaded || loaded.access === 'none') throw new HttpError(404, 'Project not found');
    if (!canWrite(loaded.access)) throw new HttpError(403, 'You need write access to this project');
    if (loaded.project.archived) throw new HttpError(409, 'This project is archived');
    const itemType = cleanString(req.body.item_type, { max: 64, required: true, field: 'item_type' });
    const itemId = cleanString(req.body.item_id === undefined || req.body.item_id === null ? null : String(req.body.item_id), { max: 128, required: true, field: 'item_id' });
    const title = cleanString(req.body.title, { max: 255, required: true, field: 'title' });
    const status = cleanString(req.body.status, { max: 64, field: 'status' });
    const link = cleanLink(req.body.link);
    await conn.query(
      `INSERT INTO science_project_items (project_id, module_id, item_type, item_id, title, status, link, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), status = VALUES(status), link = VALUES(link)`,
      [loaded.project.id, moduleId, itemType, itemId, title, status, link, req.user.id]
    );
    await conn.query('UPDATE science_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [loaded.project.id]);
    res.status(201).json({ success: true });
  }));

  // DELETE /external/projects/:id/items/:itemType/:itemId - a module removes one of its own items. Needs write.
  router.delete('/external/projects/:id/items/:itemType/:itemId', auth, route(pool, async (req, res, conn) => {
    const moduleId = callerModule(req);
    const loaded = await loadProjectAccess(conn, parseId(req.params.id, 'project id'), req.user);
    if (!loaded || loaded.access === 'none') throw new HttpError(404, 'Project not found');
    if (!canWrite(loaded.access)) throw new HttpError(403, 'You need write access to this project');
    await conn.query(
      'DELETE FROM science_project_items WHERE project_id = ? AND module_id = ? AND item_type = ? AND item_id = ?',
      [loaded.project.id, moduleId, req.params.itemType, req.params.itemId]
    );
    res.json({ success: true });
  }));

  return router;
};
