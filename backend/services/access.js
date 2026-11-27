// Application-level access control for projects. Pure functions, no I/O, so
// they are unit-tested directly (backend/tests/access.test.js).
//
// Levels, lowest to highest: none < read < write < owner < admin.
//   read   - sees the project, its items and materials.
//   write  - read, plus adds items / links materials / runs jobs in the project.
//   owner  - write, plus renames, archives, manages sharing, hands the project over.
//   admin  - administrators and developers: the same as owner, on every project.
// Grants add up: the highest one wins.

const STAFF_ROLES = ['administrator', 'developer'];
const RANK = { none: 0, read: 1, write: 2, owner: 3, admin: 4 };

function isStaff(user) {
  const roles = user && Array.isArray(user.roles) ? user.roles : [];
  return roles.some((r) => STAFF_ROLES.includes(String(r).toLowerCase()));
}

// Highest level the members list gives this user, directly or through their group.
function memberLevel(members, user) {
  if (!user) return 'none';
  let best = 'none';
  for (const m of members || []) {
    const applies =
      (m.member_type === 'user' && Number(m.member_id) === Number(user.id)) ||
      (m.member_type === 'group' && user.group_id != null && Number(m.member_id) === Number(user.group_id));
    if (applies && RANK[m.access] > RANK[best]) best = m.access;
  }
  return best;
}

const higher = (a, b) => (RANK[b] > RANK[a] ? b : a);

function resolveAccess({ project, members, user }) {
  if (!user || !project) return 'none';
  if (Number(project.owner_user_id) === Number(user.id)) return 'owner';
  if (isStaff(user)) return 'admin';
  // everyone_access: the project is shared with every signed-in user.
  return higher(memberLevel(members, user), project.everyone_access || 'none');
}

const atLeast = (access, level) => RANK[access] >= RANK[level];
const canRead = (access) => atLeast(access, 'read');
const canWrite = (access) => atLeast(access, 'write');
const canManage = (access) => atLeast(access, 'owner');

// Converts the SQL aggregate used by the project list (2 = write, 1 = read) to a level.
function levelFromNumber(n) {
  return n >= 2 ? 'write' : n === 1 ? 'read' : 'none';
}

// Whose items may this user see in a project? Everything, except in the Project
// template: it is shared with everyone, so there each person sees only the items
// they made; its owner, administrators and developers see them all. null = no
// limit, otherwise only items created by that user id.
function itemsLimitedTo({ isTemplate, access, user }) {
  return isTemplate && !canManage(access) ? Number(user.id) : null;
}

// A private material may only go into projects owned by its own owner; a
// public one into any project.
function materialLinkableTo(material, project) {
  return material.visibility === 'public' || Number(material.owner_user_id) === Number(project.owner_user_id);
}

// Who sees a material at all: its owner, anyone when public, staff always.
function materialVisibleTo(material, user) {
  return material.visibility === 'public' || Number(material.owner_user_id) === Number(user.id) || isStaff(user);
}

module.exports = {
  STAFF_ROLES,
  RANK,
  isStaff,
  higher,
  memberLevel,
  resolveAccess,
  canRead,
  canWrite,
  canManage,
  levelFromNumber,
  itemsLimitedTo,
  materialLinkableTo,
  materialVisibleTo
};
