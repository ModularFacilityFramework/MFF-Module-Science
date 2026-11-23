// The "projects provider" core's shared ProjectPicker will read from. Plain
// data access through the module's own API; core renders the picker.
//
//   list({ scope: 'mine' | 'shared' | 'all', search, includeArchived })
//     -> [{ id, number, title, owner_label, access, can_write, archived, ... }]
//        read-only projects are included with can_write false, so a picker that
//        needs write can grey them out.
//   get(id) -> the project page data
//   create({ title, description }) -> { id, number }
export function createProjectsProvider(coreApi) {
  const { api } = coreApi;
  return {
    id: 'science',
    list: ({ scope = 'all', search = '', includeArchived = false } = {}) =>
      api.get('/science/projects', { params: { scope, search, archived: includeArchived ? 1 : 0 } }).then((r) => r.data),
    get: (id) => api.get(`/science/projects/${id}`).then((r) => r.data),
    create: (body) => api.post('/science/projects', body).then((r) => r.data)
  };
}
