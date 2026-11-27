// The browser-side "projects provider" for core's shared ProjectPicker. A core
// with server-side project routes uses backend/services/projectsProvider.js
// instead; this one is the fallback for an older core, where only users with
// access to Science can reach these routes. The contract is in
// docs/MFF-Core_module-core-api.md ("Projects"):
//
//   list({ scope: 'mine' | 'shared' | 'all', search, includeArchived }) -> Project[]
//     read-only projects are included with can_write false, so a picker that
//     needs write can grey them out.
//   get(id) -> Project, or null when it is gone or the user has no access
//   create({ title, description }) -> Project
//
//   Project = { id, number, title, owner_label, access, can_write, can_manage,
//               archived, item_count, updated_at }
//
// This file imports nothing, so backend/tests can load it directly.
const BASE = '/science/external/projects';

export function createProjectsProvider(coreApi) {
  const { api } = coreApi;
  return {
    id: 'science',
    list: ({ scope = 'all', search = '', includeArchived = false } = {}) =>
      api.get(BASE, { params: { scope, search, archived: includeArchived ? 1 : 0 } }).then((r) => r.data),
    // The picker drops a remembered project on null, so only "not found" may give
    // null: any other failure (backend restarting, no network) is passed on.
    get: (id) =>
      api.get(`${BASE}/${id}`).then(
        (r) => r.data,
        (err) => {
          if (err && err.response && err.response.status === 404) return null;
          throw err;
        }
      ),
    create: (body) => api.post(BASE, body).then((r) => r.data)
  };
}
