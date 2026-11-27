// The server-side projects provider core serves its own /api/projects routes
// from (docs/MFF-Core_module-core-api.md, "Projects"). Those routes are open to
// every signed-in user, outside this module's access grant, so that project
// membership is what counts: a member who has no Science grant can still pick
// the project in another module. Core therefore relies on every function here
// applying the same access rules as our own routes (services/access.js).
//
// `user` is core's req.user: { id, username, email, group_id, roles: [names] }.
const { loadPeople } = require('./people');
const { listProjects, getProjectSummary, createProject } = require('./projects');

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
      withConnection(async (conn) =>
        listProjects(conn, user, await loadPeople(coreApi), { scope, search, includeArchived: includeArchived === true })),
    // null when the project does not exist or this user may not read it.
    get: async (user, id) => {
      const projectId = Number(id);
      if (!Number.isInteger(projectId) || projectId <= 0) return null;
      return withConnection((conn) => summary(conn, user, projectId));
    },
    // The user becomes the owner. A bad title throws an error with status 400.
    create: (user, body) =>
      withConnection(async (conn) => {
        const { id } = await createProject(conn, coreApi, user, body || {});
        return summary(conn, user, id);
      })
  };
}

module.exports = { createServerProjectsProvider };
