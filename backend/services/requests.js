// "Request a project": someone with no project asks for one; an approver creates
// it, with the requester as owner, or declines. One request can wait at a time:
// pending_user_id holds the requester only while the request is pending, and it
// is unique. The requester is told in Science: a decision stays marked as new
// until they have seen it (seen_by_requester).
const { HttpError, cleanString, parseId } = require('./http');
const { isStaff } = require('./access');
const { describeUser, userLabel } = require('./people');
const { insertProject } = require('./projects');
const { projectStatus } = require('./membership');

const STATUSES = ['pending', 'approved', 'declined', 'cancelled'];
const DESCRIPTION_MAX = 2000;
const NOTE_MAX = 1000;

// The groups and PIs the form offers. A PI is a user whose job position is "PI"
// (listUsers' is_pi), whether or not they can log in.
function requestOptions(people) {
  return {
    groups: people.groups
      .filter((g) => !g.archived_at)
      .map((g) => ({ id: Number(g.id), label: g.group_name }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase())),
    pis: people.users
      .filter((u) => u.is_pi && !u.registration_pending && u.status !== 'inactive')
      .map((u) => ({ id: Number(u.id), label: userLabel(u) }))
  };
}

function parseRequest(body, people) {
  const options = requestOptions(people);
  const optional = (value, list, field) => {
    if (value === undefined || value === null || value === '') return null;
    const id = parseId(value, field);
    if (!list.some((x) => x.id === id)) throw new HttpError(400, `${field} is not one that can be chosen`);
    return id;
  };
  return {
    title: cleanString(body.title, { max: 255, required: true, field: 'title' }),
    description: cleanString(body.description, { max: DESCRIPTION_MAX, required: true, field: 'description' }),
    groupId: optional(body.group_id, options.groups, 'group_id'),
    piUserId: optional(body.pi_user_id, options.pis, 'pi_user_id')
  };
}

function shapeRequest(r, people) {
  const group = r.group_id === null ? null : people.groupsById.get(Number(r.group_id));
  return {
    id: Number(r.id),
    requester_user_id: Number(r.requester_user_id),
    requester_label: describeUser(people, r.requester_user_id).label,
    title: r.title,
    description: r.description,
    group_id: r.group_id === null ? null : Number(r.group_id),
    group_label: r.group_id === null ? null : group ? group.group_name : `Group #${r.group_id}`,
    pi_user_id: r.pi_user_id === null ? null : Number(r.pi_user_id),
    pi_label: r.pi_user_id === null ? null : describeUser(people, r.pi_user_id).label,
    status: r.status,
    decided_by_label: r.decided_by === null ? null : describeUser(people, r.decided_by).label,
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    project_id: r.project_id === null ? null : Number(r.project_id),
    unseen: !Number(r.seen_by_requester) && (r.status === 'approved' || r.status === 'declined'),
    created_at: r.created_at
  };
}

async function getRequest(conn, id, people) {
  const rows = await conn.query('SELECT * FROM science_project_requests WHERE id = ?', [id]);
  return rows.length ? shapeRequest(rows[0], people) : null;
}

async function listMine(conn, userId, people) {
  const rows = await conn.query('SELECT * FROM science_project_requests WHERE requester_user_id = ? ORDER BY id DESC', [userId]);
  return rows.map((r) => shapeRequest(r, people));
}

// For approvers. status null = every status.
async function listAll(conn, people, status = null) {
  if (status !== null && !STATUSES.includes(status)) throw new HttpError(400, 'unknown status');
  const rows = await conn.query(
    `SELECT * FROM science_project_requests ${status ? 'WHERE status = ? ' : ''}ORDER BY id DESC`,
    status ? [status] : []
  );
  return rows.map((r) => shapeRequest(r, people));
}

async function pendingCount(conn) {
  const [{ n }] = await conn.query("SELECT COUNT(*) AS n FROM science_project_requests WHERE status = 'pending'");
  return Number(n);
}

async function createRequest(conn, user, body, people, coreRule = null) {
  const fields = parseRequest(body, people);
  if (!(await projectStatus(conn, user, people, coreRule)).can_request) {
    throw new HttpError(409, 'You can already create a project yourself, with "+ New project"');
  }
  try {
    const r = await conn.query(
      `INSERT INTO science_project_requests (requester_user_id, pending_user_id, title, description, group_id, pi_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, user.id, fields.title, fields.description, fields.groupId, fields.piUserId]
    );
    return getRequest(conn, Number(r.insertId), people);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'You already have a request waiting for a decision');
    throw err;
  }
}

async function cancelRequest(conn, userId, id) {
  const r = await conn.query(
    "UPDATE science_project_requests SET status = 'cancelled', pending_user_id = NULL WHERE id = ? AND requester_user_id = ? AND status = 'pending'",
    [id, userId]
  );
  if (!r.affectedRows) throw new HttpError(404, 'You have no waiting request with that number');
}

// Approve (creates the project, owned by the requester) or decline. Nobody
// decides their own request, except an administrator or developer. The caller
// has already checked that `approver` may decide requests.
async function decideRequest(conn, coreApi, approver, id, { approve, note }, people) {
  const decisionNote = cleanString(note, { max: NOTE_MAX, field: 'note' });
  await conn.beginTransaction();
  try {
    const rows = await conn.query('SELECT * FROM science_project_requests WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Request not found');
    const request = rows[0];
    if (request.status !== 'pending') throw new HttpError(409, `This request is already ${request.status}`);
    if (Number(request.requester_user_id) === Number(approver.id) && !isStaff(approver)) {
      throw new HttpError(403, 'Another approver must decide your own request');
    }
    let projectId = null;
    if (approve) {
      const requester = people.usersById.get(Number(request.requester_user_id));
      if (!requester || requester.account_type === 'no_login') throw new HttpError(409, 'The person who asked no longer has an account');
      const made = await insertProject(conn, coreApi, {
        title: request.title, description: request.description, ownerId: Number(requester.id), createdBy: approver.id
      });
      projectId = made.id;
    }
    await conn.query(
      `UPDATE science_project_requests
          SET status = ?, pending_user_id = NULL, decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?, project_id = ?
        WHERE id = ?`,
      [approve ? 'approved' : 'declined', approver.id, decisionNote, projectId, id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
  return getRequest(conn, id, people);
}

// The requester has seen the decisions with these ids.
async function markSeen(conn, userId, ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const clean = ids.slice(0, 200).map((v) => parseId(v, 'request id'));
  await conn.query(
    `UPDATE science_project_requests SET seen_by_requester = 1 WHERE requester_user_id = ? AND id IN (${clean.map(() => '?').join(',')})`,
    [userId, ...clean]
  );
}

module.exports = { requestOptions, parseRequest, shapeRequest, listMine, listAll, pendingCount, createRequest, cancelRequest, decideRequest, markSeen };
