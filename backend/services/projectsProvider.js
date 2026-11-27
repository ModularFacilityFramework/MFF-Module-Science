// The server-side projects provider core serves its own /api/projects routes
// from (docs/MFF-Core_module-core-api.md, "Projects"). Those routes are open to
// every signed-in user, outside this module's access grant, so that project
// membership is what counts: a member who has no Science grant can still pick
// the project in another module. Core therefore relies on every function here
// applying the same access rules as our own routes (services/access.js).
//
// `user` is core's req.user: { id, username, email, group_id, roles: [names] }.
const { loadPeople } = require('./people');
const { loadProjectAccess, listProjects, getProjectSummary, createProject } = require('./projects');
const { ensureTemplateQuietly, findTemplateId } = require('./template');
const { itemsLimitedTo } = require('./access');
const { listItems } = require('./items');
const { SCIENCE_LINK, projectStatus, requireMayCreate } = require('./membership');
const requests = require('./requests');
const { assignmentOptions, applyAssignment } = require('./assignment');

function createServerProjectsProvider(coreApi) {
  async function withConnection(fn) {
    const conn = await coreApi.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }
  const summary = async (conn, user, id) => getProjectSummary(conn, id, user, await loadPeople(coreApi));

  return {
    // Only projects this user can read.
    list: (user, { scope = 'all', search = '', includeArchived = false } = {}) =>
      withConnection(async (conn) => {
        await ensureTemplateQuietly(conn, coreApi);
        return listProjects(conn, user, await loadPeople(coreApi), { scope, search, includeArchived: includeArchived === true });
      }),
    // null when the project does not exist or this user may not read it.
    get: async (user, id) => {
      const projectId = Number(id);
      if (!Number.isInteger(projectId) || projectId <= 0) return null;
      return withConnection((conn) => summary(conn, user, projectId));
    },
    // The user becomes the owner. A bad title throws an error with status 400;
    // someone with no project yet gets 403 and asks for one instead.
    create: (user, body) =>
      withConnection(async (conn) => {
        await ensureTemplateQuietly(conn, coreApi);
        await requireMayCreate(conn, user, await loadPeople(coreApi));
        const { id } = await createProject(conn, coreApi, user, body || {});
        return summary(conn, user, id);
      }),
    canCreate: (user) =>
      withConnection(async (conn) => (await projectStatus(conn, user, await loadPeople(coreApi))).can_create),

    // The rest is beyond what core v0.1.223 calls: for its project tabs, its
    // "no project yet" state and its registration approval screen. Each throws
    // an error with a .status when refused.

    // The items of one project, or of one module in it; null when the user may
    // not read the project. The Project template's own-items rule applies.
    items: async (user, id, { moduleId = null } = {}) => {
      const projectId = Number(id);
      if (!Number.isInteger(projectId) || projectId <= 0) return null;
      return withConnection(async (conn) => {
        const loaded = await loadProjectAccess(conn, projectId, user);
        if (!loaded || loaded.access === 'none') return null;
        const isTemplate = (await findTemplateId(conn)) === projectId;
        const onlyCreatedBy = itemsLimitedTo({ isTemplate, access: loaded.access, user });
        return listItems(conn, projectId, await loadPeople(coreApi), { moduleId: moduleId || null, onlyCreatedBy });
      });
    },
    // May this user start project-based work, and if not, what can they do?
    status: (user) =>
      withConnection(async (conn) => {
        await ensureTemplateQuietly(conn, coreApi);
        const people = await loadPeople(coreApi);
        const waiting = (await requests.listMine(conn, user.id, people)).find((r) => r.status === 'pending') || null;
        return { ...(await projectStatus(conn, user, people)), pending_request: waiting, link: SCIENCE_LINK };
      }),
    // At registration approval (developers and administrators only).
    assignment: {
      options: (approver, targetUserId) =>
        withConnection(async (conn) => assignmentOptions(conn, approver, targetUserId, await loadPeople(coreApi))),
      apply: (approver, targetUserId, body) =>
        withConnection(async (conn) => applyAssignment(conn, coreApi, approver, targetUserId, body, await loadPeople(coreApi)))
    },
    // The requester's own side of "Request a project".
    requests: {
      create: (user, body) =>
        withConnection(async (conn) => requests.createRequest(conn, user, body || {}, await loadPeople(coreApi))),
      mine: (user) =>
        withConnection(async (conn) => requests.listMine(conn, user.id, await loadPeople(coreApi))),
      cancel: (user, id) =>
        withConnection((conn) => requests.cancelRequest(conn, user.id, Number(id)))
    }
  };
}

module.exports = { createServerProjectsProvider };
