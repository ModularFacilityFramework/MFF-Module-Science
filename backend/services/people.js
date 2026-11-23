// Users and groups come from core only (coreApi.listUsers / listGroups), never
// from SQL on core's tables. Rule for every list of people: sorted by first
// name, then last name (case-insensitive), labelled "First Last (username)".

const norm = (s) => String(s || '').toLowerCase();

function userName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username;
}

function userLabel(u) {
  return `${userName(u)} (${u.username})`;
}

function compareUsers(a, b) {
  return (
    norm(a.first_name).localeCompare(norm(b.first_name)) ||
    norm(a.last_name).localeCompare(norm(b.last_name)) ||
    norm(a.username).localeCompare(norm(b.username))
  );
}

// A user who can own a project or be shared with: a real login account that is
// not waiting for approval.
function isSelectable(u) {
  return u.account_type !== 'no_login' && !u.registration_pending;
}

async function loadPeople(coreApi) {
  const [users, groups] = await Promise.all([coreApi.listUsers(), coreApi.listGroups()]);
  const sortedUsers = [...users].sort(compareUsers);
  return {
    users: sortedUsers,
    groups,
    usersById: new Map(users.map((u) => [Number(u.id), u])),
    groupsById: new Map(groups.map((g) => [Number(g.id), g]))
  };
}

// {id, name, username, label} for an id, tolerating a user that no longer exists.
function describeUser(people, id) {
  const u = people.usersById.get(Number(id));
  if (!u) return { id: Number(id), name: `User #${id}`, username: null, label: `User #${id}` };
  return { id: Number(u.id), name: userName(u), username: u.username, label: userLabel(u) };
}

module.exports = { userName, userLabel, compareUsers, isSelectable, loadPeople, describeUser };
