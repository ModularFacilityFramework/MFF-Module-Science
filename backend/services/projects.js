// Shared project queries used by the UI routes and the /external routes.
const path = require('path');
const { resolveAccess, isStaff, higher, levelFromNumber, itemsLimitedTo, canWrite, canManage, canRead } = require('./access');
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

// Items per project and module: all of them, and those one user made.
async function itemCounts(conn, userId, projectId = null) {
  const rows = await conn.query(
    `SELECT project_id, module_id, COUNT(*) AS n, SUM(created_by = ?) AS own
       FROM science_project_items ${projectId === null ? '' : 'WHERE project_id = ? '}GROUP BY project_id, module_id`,
    projectId === null ? [userId] : [userId, projectId]
  );
  const byProject = new Map();
  for (const r of rows) {
    const key = Number(r.project_id);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(r);
  }
  return byProject;
}

// { item_count, item_counts: { moduleid: n } } for one project; ownOnly counts
// only the user's own items (the Project template rule, see access.js).
function countItems(rows, ownOnly) {
  const counts = {};
  let total = 0;
  for (const r of rows || []) {
    const n = Number(ownOnly ? r.own : r.n) || 0;
    if (!n) continue;
    counts[r.module_id] = n;
    total += n;
  }
  return { item_count: total, item_counts: counts };
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
    is_template: !!Number(p.is_template),
    item_count: p.item_count,
    item_counts: p.item_counts,
    created_at: p.created_at,
    updated_at: p.updated_at,
    ...accessFlags(access)
  };
}

// scope: 'mine' (I own), 'shared' (shared with me, directly or via my group),
// 'all' (default: mine + shared; for administrators and developers, every project).
// Order: the Project template first, then by number. It does not change when a
// project is touched, so a module's project tabs stay where they are.
async function listProjects(conn, user, people, { scope = 'all', search = '', includeArchived = false } = {}) {
  const staff = isStaff(user);
  const rows = await conn.query(
    `SELECT p.id, p.number, p.title, p.owner_user_id, p.archived, p.everyone_access, p.created_at, p.updated_at,
            EXISTS (SELECT 1 FROM science_template t WHERE t.project_id = p.id) AS is_template,
            (SELECT MAX(CASE m.access WHEN 'write' THEN 2 ELSE 1 END) FROM science_project_members m
              WHERE m.project_id = p.id
                AND ((m.member_type = 'user' AND m.member_id = ?) OR (m.member_type = 'group' AND m.member_id = ?))) AS member_level
       FROM science_projects p
      ORDER BY is_template DESC, p.id`,
    [user.id, user.group_id == null ? -1 : user.group_id]
  );
  const counts = await itemCounts(conn, user.id);
  const needle = String(search || '').trim().toLowerCase();
  const out = [];
  for (const p of rows) {
    const mine = Number(p.owner_user_id) === Number(user.id);
    const level = mine ? 'owner' : staff ? 'admin' : higher(levelFromNumber(Number(p.member_level) || 0), p.everyone_access || 'none');
    if (level === 'none') continue;
    if (scope === 'mine' && !mine) continue;
    if (scope === 'shared' && (mine || (!p.member_level && !p.everyone_access))) continue;
    if (!includeArchived && p.archived) continue;
    const limited = itemsLimitedTo({ isTemplate: !!Number(p.is_template), access: level, user }) !== null;
    const s = summarise({ ...p, ...countItems(counts.get(Number(p.id)), limited) }, level, people);
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
  const [{ n }] = await conn.query('SELECT COUNT(*) AS n FROM science_template WHERE project_id = ?', [id]);
  const isTemplate = !!Number(n);
  const limited = itemsLimitedTo({ isTemplate, access: loaded.access, user }) !== null;
  const counts = await itemCounts(conn, user.id, id);
  return summarise({ ...loaded.project, is_template: isTemplate, ...countItems(counts.get(Number(id)), limited) }, loaded.access, people);
}

// Adds a project and gives it its number. The caller owns the transaction.
async function insertProject(conn, coreApi, { title, description, ownerId, createdBy }) {
  const r = await conn.query(
    'INSERT INTO science_projects (title, description, owner_user_id, created_by) VALUES (?, ?, ?, ?)',
    [title, description, ownerId, createdBy]
  );
  const number = await assignNumber(conn, coreApi, r.insertId, title);
  return { id: Number(r.insertId), number };
}

function parseProject(body) {
  return {
    title: cleanString(body.title, { max: 255, required: true, field: 'title' }),
    description: cleanString(body.description, { max: 20000, field: 'description' })
  };
}

// Creates a project owned by `user`; used by the Science page and by the picker's
// "+ New project". Who may do that is membership.js's requireMayCreate().
// Returns { id, number }.
async function createProject(conn, coreApi, user, body) {
  const fields = parseProject(body);
  await conn.beginTransaction();
  try {
    const made = await insertProject(conn, coreApi, { ...fields, ownerId: user.id, createdBy: user.id });
    await conn.commit();
    return made;
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// Gives a new project its number (P-0001) and stored folder path.
async function assignNumber(conn, coreApi, id, title) {
  const number = `P-${String(id).padStart(4, '0')}`;
  await conn.query('UPDATE science_projects SET number = ?, folder_path = ? WHERE id = ?', [number, folderPathFor(coreApi, number, title), id]);
  return number;
}

// Where modules write this project's output, e.g. <base>/projects/P-0001_my-title.
// Only a stored path: this module does not create the folder or set permissions
// on it. null when the admin has not set MODULE_SCIENCE_DATA_BASE_DIR.
function folderPathFor(coreApi, number, title) {
  const base = (coreApi.getModuleConfig() || {}).DATA_BASE_DIR;
  if (!base || !path.isAbsolute(base)) return null;
  return path.join(base, 'projects', `${number}_${slug(title)}`);
}

module.exports = { loadProjectAccess, accessFlags, summarise, countItems, listProjects, getProjectSummary, createProject, insertProject, parseProject, assignNumber, slug, folderPathFor };
