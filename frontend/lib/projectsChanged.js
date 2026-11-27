// Call after anything that changes who sees or writes which project (or what it
// is called), so core's project tabs and lock states read it again. Core 0.1.227
// or later; nothing to do on an older one.
export function projectsChanged(coreApi) {
  if (typeof coreApi.notifyProjectsChanged === 'function') coreApi.notifyProjectsChanged();
}
