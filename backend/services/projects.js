// Shared project queries used by the UI routes and the /external routes.
const path = require('path');
const { resolveAccess, isStaff, levelFromNumber, canWrite, canManage, canRead } = require('./access');
const { describeUser } = require('./people');
const { cleanString } = require('./http');

async function loadProjectAccess(conn, id, user) {
  const rows = await conn.query('SELECT * FROM science_projects WHERE id = ?', [id]);
  if (!rows.length) return null;
  const project = rows[0];
  const members = await conn.query(
    'SELECT id, project_id, member_type, member_id, access, added_by, added_at FROM science_project_members WHERE project_id = ? ORDER BY id',
    [id]
  );
  return { project, members, access: resolveAccess({ project, members, user }) };
}

function accessFlags(access) {
  return { access, can_read: canRead(access), can_write: canWrite(access), can_manage: canManage(access) };
}

function summarise(p, access, people) {
  const owner = describeUser(people, p.owner_user_id);
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    owner_user_id: p.owner_user_id,
    owner_name: owner.name,
    owner_username: owner.username,
    owner_label: owner.label,
    archived: !!p.archived,
    item_count: p.item_count === undefined ? undefined : Number(p.item_count),
    created_at: p.created_at,
    updated_at: p.updated_at,
    ...accessFlags(access)
  };
}

// scope: 'mine' (I own), 'shared' (shared with me, directly or via my group),
// 'all' (default: mine + shared; for administrators and developers, every project).
async function listProjects(conn, user, people, { scope = 'all', search = '', includeArchived = false } = {}) {
  const staff = isStaff(user);
  const rows = await conn.query(
    `SELECT p.id, p.number, p.title, p.owner_user_id, p.archived, p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM science_project_items i WHERE i.project_id = p.id) AS item_count,
            (SELECT MAX(CASE m.access WHEN 'write' THEN 2 ELSE 1 END) FROM science_project_members m
              WHERE m.project_id = p.id
                AND ((m.member_type = 'user' AND m.member_id = ?) OR (m.member_type = 'group' AND m.member_id = ?))) AS member_level
       FROM science_projects p
      ORDER BY p.updated_at DESC, p.id DESC`,
    [user.id, user.group_id == null ? -1 : user.group_id]
  );
  const needle = String(search || '').trim().toLowerCase();
  const out = [];
  for (const p of rows) {
    const mine = Number(p.owner_user_id) === Number(user.id);
    const level = mine ? 'owner' : staff ? 'admin' : levelFromNumber(Number(p.member_level) || 0);
    if (level === 'none') continue;
    if (scope === 'mine' && !mine) continue;
    if (scope === 'shared' && (mine || !p.member_level)) continue;
    if (!includeArchived && p.archived) continue;
    const s = summarise(p, level, people);
    if (needle && !`${s.number} ${s.title} ${s.owner_label}`.toLowerCase().includes(needle)) continue;
    out.push(s);
  }
  return out;
}

function slug(title) {
  const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'project';
}

// One project in the list's shape (what core's ProjectPicker calls a Project),
// or null when it does not exist or the user may not read it.
async function getProjectSummary(conn, id, user, people) {
  const loaded = await loadProjectAccess(conn, id, user);
  if (!loaded || loaded.access === 'none') return null;
  const rows = await conn.query('SELECT COUNT(*) AS item_count FROM science_project_items WHERE project_id = ?', [id]);
  return summarise({ ...loaded.project, item_count: rows[0].item_count }, loaded.access, people);
}

// Creates a project owned by `user`; used by the Science page and by the picker's
// "+ New project". Returns { id, number }.
async function createProject(conn, coreApi, user, body) {
  const title = cleanString(body.title, { max: 255, required: true, field: 'title' });
  const description = cleanString(body.description, { max: 20000, field: 'description' });
  await conn.beginTransaction();
  try {
    const r = await conn.query(
      'INSERT INTO science_projects (title, description, owner_user_id, created_by) VALUES (?, ?, ?, ?)',
      [title, description, user.id, user.id]
    );
    const number = `P-${String(r.insertId).padStart(4, '0')}`;
    await conn.query('UPDATE science_projects SET number = ?, folder_path = ? WHERE id = ?', [number, folderPathFor(coreApi, number, title), r.insertId]);
    await conn.commit();
    return { id: r.insertId, number };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// Where modules write this project's output, e.g. <base>/projects/P-0001_my-title.
// Only a stored path: this module does not create the folder or set permissions
// on it. null when the admin has not set MODULE_SCIENCE_DATA_BASE_DIR.
function folderPathFor(coreApi, number, title) {
  const base = (coreApi.getModuleConfig() || {}).DATA_BASE_DIR;
  if (!base || !path.isAbsolute(base)) return null;
  return path.join(base, 'projects', `${number}_${slug(title)}`);
}

module.exports = { loadProjectAccess, accessFlags, summarise, listProjects, getProjectSummary, createProject, slug, folderPathFor };
