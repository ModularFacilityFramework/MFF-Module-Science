// Giving a new person their projects from core's registration approval screen:
// make a project they own, and/or share existing ones with them. Core reaches
// this through the server provider; developers and administrators only, the
// same people who may approve a registration. The person may still be a pending
// registration.
const { HttpError, parseId } = require('./http');
const { isStaff, resolveAccess } = require('./access');
const { describeUser } = require('./people');
const { insertProject, parseProject, getProjectSummary } = require('./projects');
const { findTemplateId } = require('./template');

const MAX_GRANTS = 200;

function requireStaff(approver) {
  if (!isStaff(approver)) throw new HttpError(403, 'Only administrators and developers can do this');
}

function requireTarget(people, targetUserId) {
  const target = people.usersById.get(parseId(targetUserId, 'user'));
  if (!target) throw new HttpError(404, 'User not found');
  if (target.account_type === 'no_login') throw new HttpError(400, 'A no-login record cannot have projects');
  return target;
}

// { projects: [{ id, number, title, owner_label, target_access }] }: every
// project that can be shared with the person. target_access is what their own
// shares give them ('owner', 'write', 'read' or 'none'), leaving out what an
// administrator or developer role would add.
async function assignmentOptions(conn, approver, targetUserId, people) {
  requireStaff(approver);
  const target = requireTarget(people, targetUserId);
  const templateId = await findTemplateId(conn);
  const projects = await conn.query('SELECT id, number, title, owner_user_id, everyone_access FROM science_projects WHERE archived = 0 ORDER BY id');
  const members = await conn.query('SELECT project_id, member_type, member_id, access FROM science_project_members');
  const asPerson = { id: Number(target.id), group_id: target.group_id, roles: [] };
  return {
    projects: projects
      .filter((p) => Number(p.id) !== templateId)
      .map((p) => ({
        id: Number(p.id),
        number: p.number,
        title: p.title,
        owner_label: describeUser(people, p.owner_user_id).label,
        target_access: resolveAccess({ project: p, members: members.filter((m) => Number(m.project_id) === Number(p.id)), user: asPerson })
      }))
  };
}

// { create: { title, description? } | null, grants: [{ project_id, access }] }
// Everything or nothing. Answers { created: Project | null, granted: n }; a
// grant on a project the person owns is skipped and not counted.
async function applyAssignment(conn, coreApi, approver, targetUserId, body, people) {
  requireStaff(approver);
  const target = requireTarget(people, targetUserId);
  const input = body || {};
  const fields = input.create ? parseProject(input.create) : null;
  const grants = input.grants === undefined || input.grants === null ? [] : input.grants;
  if (!Array.isArray(grants) || grants.length > MAX_GRANTS) throw new HttpError(400, `grants must be a list of at most ${MAX_GRANTS}`);
  const wanted = grants.map((g) => {
    const access = g && g.access === undefined ? 'read' : g && g.access;
    if (access !== 'read' && access !== 'write') throw new HttpError(400, 'access must be "read" or "write"');
    return { projectId: parseId(g.project_id, 'project_id'), access };
  });
  const templateId = await findTemplateId(conn);

  await conn.beginTransaction();
  let createdId = null;
  let granted = 0;
  try {
    for (const g of wanted) {
      const rows = await conn.query('SELECT id, owner_user_id, archived FROM science_projects WHERE id = ? FOR UPDATE', [g.projectId]);
      if (!rows.length) throw new HttpError(404, `Project ${g.projectId} not found`);
      if (g.projectId === templateId) throw new HttpError(400, 'The Project template is already shared with everyone');
      if (rows[0].archived) throw new HttpError(400, `Project ${g.projectId} is archived`);
      if (Number(rows[0].owner_user_id) === Number(target.id)) continue;
      await conn.query(
        `INSERT INTO science_project_members (project_id, member_type, member_id, access, added_by) VALUES (?, 'user', ?, ?, ?)
         ON DUPLICATE KEY UPDATE access = VALUES(access)`,
        [g.projectId, target.id, g.access, approver.id]
      );
      await conn.query('UPDATE science_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [g.projectId]);
      granted += 1;
    }
    if (fields) {
      createdId = (await insertProject(conn, coreApi, { ...fields, ownerId: Number(target.id), createdBy: approver.id })).id;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
  return { created: createdId === null ? null : await getProjectSummary(conn, createdId, approver, people), granted };
}

module.exports = { MAX_GRANTS, assignmentOptions, applyAssignment };
