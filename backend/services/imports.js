// A module bringing its OLD local projects into Science (decided 28/11/2026).
// The owner is the user the module acts for. No approval, and the "who may
// create" rule (membership.js) is not applied: it may be that person's first
// project. Safe to repeat: one Science project per module and old project id,
// recorded in science_project_imports with the module that made it.
// Science cannot tell whether a project really is old: using this only for old
// projects is the calling module's duty.
const { HttpError, cleanString } = require('./http');
const { insertProject, parseProject, loadProjectAccess, accessFlags } = require('./projects');

// { old_id, title, description? }. old_id is the module's own id, text or a whole number.
function parseImport(body) {
  const oldId = Number.isSafeInteger(body.old_id) ? String(body.old_id) : body.old_id;
  return {
    oldId: cleanString(oldId, { max: 128, required: true, field: 'old_id' }),
    ...parseProject(body)
  };
}

async function findImport(conn, moduleId, oldId) {
  const rows = await conn.query(
    `SELECT i.owner_user_id, p.id, p.number
       FROM science_project_imports i JOIN science_projects p ON p.id = i.project_id
      WHERE i.module_id = ? AND i.old_id = ?`,
    [moduleId, oldId]
  );
  return rows[0] || null;
}

// The id and number, and what the user may do in it now: it may have been
// shared on or handed over since, so nothing else about it is told.
async function importResult(conn, user, row, created) {
  if (Number(row.owner_user_id) !== Number(user.id)) {
    throw new HttpError(409, 'This old project was already imported for another user');
  }
  const { access } = await loadProjectAccess(conn, Number(row.id), user);
  return { created, project: { id: Number(row.id), number: row.number }, ...accessFlags(access) };
}

// Returns { created, project: { id, number }, access, can_read, can_write,
// can_manage }. A repeat answers with the first project and changes nothing.
// `conn` must not be in a transaction.
async function importProject(conn, coreApi, user, moduleId, body) {
  const { oldId, title, description } = parseImport(body);
  const earlier = await findImport(conn, moduleId, oldId);
  if (earlier) return importResult(conn, user, earlier, false);
  let made;
  await conn.beginTransaction();
  try {
    made = await insertProject(conn, coreApi, { title, description, ownerId: user.id, createdBy: user.id });
    await conn.query(
      'INSERT INTO science_project_imports (module_id, old_id, owner_user_id, project_id) VALUES (?, ?, ?, ?)',
      [moduleId, oldId, user.id, made.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // The same import sent twice at once: the other one got there first.
    const winner = await findImport(conn, moduleId, oldId);
    if (winner) return importResult(conn, user, winner, false);
    throw err;
  }
  console.log(`[science] module ${moduleId} imported its old project ${oldId} for user ${user.id} as ${made.number}`);
  return importResult(conn, user, { ...made, owner_user_id: user.id }, true);
}

module.exports = { parseImport, importProject };
