// "A person must have a project before using any project-based task."
// A project counts when the person can write in it, it is not archived and it is
// not the Project template. Someone with no such project cannot make one
// themselves: they ask for one (services/requests.js). Administrators and
// developers can always create. There is no limit on how many projects a person
// may have (decided 27/11/2026): disk quotas, later, are the only limit planned.
// On core 0.1.227 or later core's own rule (this one plus its settings) decides
// who may create: coreRule below, from coreMayCreate() in
// services/coreExtras.js; null where core has none.
const { isStaff, resolveAccess, canWrite } = require('./access');
const { userLabel } = require('./people');
const { listProjects } = require('./projects');
const { HttpError } = require('./http');

// In-app path of the Science tab, where a project is asked for.
const SCIENCE_LINK = '/dashboard?tab=science';

// For a project in the list's shape (listProjects / getProjectSummary).
const isWorkProject = (p) => !!p.can_write && !p.is_template && !p.archived;

const mayCreate = (user, projectCount) => isStaff(user) || projectCount > 0;

// { has_project, project_count, can_create, can_request }. Whoever cannot create
// asks for a project.
async function projectStatus(conn, user, people, coreRule = null) {
  const count = (await listProjects(conn, user, people)).filter(isWorkProject).length;
  const create = coreRule === null ? mayCreate(user, count) : coreRule;
  return { has_project: count > 0, project_count: count, can_create: create, can_request: !create };
}

async function requireMayCreate(conn, user, people, coreRule = null) {
  if (!(await projectStatus(conn, user, people, coreRule)).can_create) {
    throw new HttpError(403, 'You cannot create a project. Ask for one in Science with "Request a project".');
  }
}

// Whether `user` (as listUsers() gives them) has a project that counts, among
// these project rows ({ id, owner_user_id, archived, everyone_access,
// is_template }) shared as in membersByProject.
function hasWorkProject(user, projects, membersByProject) {
  return projects.some((p) =>
    !Number(p.is_template) && !Number(p.archived) &&
    canWrite(resolveAccess({ project: p, members: membersByProject.get(Number(p.id)) || [], user })));
}

function groupByProject(members) {
  const map = new Map();
  for (const m of members) {
    const key = Number(m.project_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return map;
}

// Who is left with no project if the share `memberRowId` goes down to `access`
// ('none' = removed, or 'read'). Returns those of `candidates` who have one now
// and would not afterwards.
function strandedBy({ projects, members, candidates, memberRowId, access }) {
  const before = groupByProject(members);
  const after = groupByProject(
    members
      .map((m) => (Number(m.id) === Number(memberRowId) ? { ...m, access } : m))
      .filter((m) => m.access !== 'none')
  );
  return candidates.filter((u) => hasWorkProject(u, projects, before) && !hasWorkProject(u, projects, after));
}

// The people a share concerns: the user, or everyone in the group, who can log in.
function peopleBehind(member, people) {
  const list = member.member_type === 'group'
    ? people.users.filter((u) => Number(u.group_id) === Number(member.member_id))
    : people.users.filter((u) => Number(u.id) === Number(member.member_id));
  return list.filter((u) => u.account_type !== 'no_login' && u.status !== 'inactive');
}

// Labels of the people `member` (a science_project_members row) would leave with
// no project, for the warning shown before it is removed or lowered to read.
// Removing is always allowed.
async function removalImpact(conn, member, access, people) {
  const projects = await conn.query(
    `SELECT p.id, p.owner_user_id, p.archived, p.everyone_access,
            EXISTS (SELECT 1 FROM science_template t WHERE t.project_id = p.id) AS is_template
       FROM science_projects p`
  );
  const members = await conn.query('SELECT id, project_id, member_type, member_id, access FROM science_project_members');
  const candidates = peopleBehind(member, people);
  return strandedBy({ projects, members, candidates, memberRowId: member.id, access }).map(userLabel);
}

module.exports = {
  SCIENCE_LINK, isWorkProject, mayCreate, projectStatus, requireMayCreate,
  hasWorkProject, strandedBy, peopleBehind, removalImpact
};
