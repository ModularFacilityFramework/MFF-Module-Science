// The project item registry: every job or object a module records against a
// project. module_id always comes from core's delegation, never from a request body.
const { HttpError, cleanString, cleanLink } = require('./http');
const { describeUser } = require('./people');

const MAX_BATCH = 200;

// The fields a module sends for one item. Throws HttpError 400.
function parseItem(body) {
  const rawId = body.item_id === undefined || body.item_id === null ? null : String(body.item_id);
  return {
    itemType: cleanString(body.item_type, { max: 64, required: true, field: 'item_type' }),
    itemId: cleanString(rawId, { max: 128, required: true, field: 'item_id' }),
    title: cleanString(body.title, { max: 255, required: true, field: 'title' }),
    status: cleanString(body.status, { max: 64, field: 'status' }),
    link: cleanLink(body.link)
  };
}

// An item moved in from before projects existed also says who made it and when.
// created_by 0 means "not known". Both are optional.
function parseOldItem(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'each item must be an object');
  const item = parseItem(body);
  let createdBy = 0;
  if (body.created_by !== undefined && body.created_by !== null) {
    createdBy = Number(body.created_by);
    if (!Number.isInteger(createdBy) || createdBy < 0) throw new HttpError(400, 'created_by must be a user id');
  }
  let createdAt = null;
  if (body.created_at !== undefined && body.created_at !== null && body.created_at !== '') {
    createdAt = new Date(body.created_at);
    const year = createdAt.getUTCFullYear();
    if (!(year >= 1971 && year <= 2037)) throw new HttpError(400, 'created_at must be a date');
  }
  return { ...item, createdBy, createdAt };
}

// onlyCreatedBy: see itemsLimitedTo() in access.js; every caller must pass it.
async function listItems(conn, projectId, people, { moduleId = null, onlyCreatedBy } = {}) {
  if (onlyCreatedBy === undefined) throw new Error('listItems: onlyCreatedBy is required (null for no limit)');
  const where = ['project_id = ?'];
  const params = [projectId];
  if (moduleId) { where.push('module_id = ?'); params.push(moduleId); }
  if (onlyCreatedBy !== null) { where.push('created_by = ?'); params.push(onlyCreatedBy); }
  const rows = await conn.query(
    `SELECT id, module_id, item_type, item_id, title, status, link, created_by, created_at, updated_at
       FROM science_project_items WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, id DESC`,
    params
  );
  return rows.map((i) => ({
    ...i,
    created_by_label: Number(i.created_by) ? describeUser(people, i.created_by).label : 'Unknown'
  }));
}

// Registers an item, or updates its title, status and link. Who made it and
// when stay as first registered.
function upsertItem(conn, projectId, moduleId, item, createdBy, createdAt = null) {
  return conn.query(
    `INSERT INTO science_project_items (project_id, module_id, item_type, item_id, title, status, link, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
     ON DUPLICATE KEY UPDATE title = VALUES(title), status = VALUES(status), link = VALUES(link)`,
    [projectId, moduleId, item.itemType, item.itemId, item.title, item.status, item.link, createdBy, createdAt, createdAt]
  );
}

function removeItem(conn, projectId, moduleId, itemType, itemId) {
  return conn.query(
    'DELETE FROM science_project_items WHERE project_id = ? AND module_id = ? AND item_type = ? AND item_id = ?',
    [projectId, moduleId, itemType, itemId]
  );
}

// Moves a module's project-less items into the template. An item the module has
// already registered in another project is left where it is. A bad entry is
// reported and does not stop the others, so a module can safely run it again.
async function adoptItems(conn, templateId, moduleId, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'items must be a non-empty list');
  if (items.length > MAX_BATCH) throw new HttpError(400, `at most ${MAX_BATCH} items per call`);
  let saved = 0;
  const skipped = [];
  for (const raw of items) {
    let item;
    try {
      item = parseOldItem(raw);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped.push({ item_type: raw && raw.item_type, item_id: raw && raw.item_id, reason: 'invalid', error: err.message });
      continue;
    }
    const elsewhere = await conn.query(
      'SELECT project_id FROM science_project_items WHERE module_id = ? AND item_type = ? AND item_id = ? AND project_id <> ? LIMIT 1',
      [moduleId, item.itemType, item.itemId, templateId]
    );
    if (elsewhere.length) {
      skipped.push({ item_type: item.itemType, item_id: item.itemId, reason: 'in_another_project', project_id: Number(elsewhere[0].project_id) });
      continue;
    }
    await upsertItem(conn, templateId, moduleId, item, item.createdBy, item.createdAt);
    saved += 1;
  }
  return { saved, skipped };
}

module.exports = { MAX_BATCH, parseItem, parseOldItem, listItems, upsertItem, removeItem, adoptItems };
