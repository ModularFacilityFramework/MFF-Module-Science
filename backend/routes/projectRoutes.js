// Projects, sharing and the materials linked to a project. Who may do what is
// decided in services/access.js: read sees, write adds items and links
// materials, only the owner (or an administrator/developer) renames, archives,
// shares and hands the project over. A project the caller cannot read answers
// 404, so its existence is not leaked.
const express = require('express');
const { route, HttpError, cleanString, parseId } = require('../services/http');
const { canWrite, canManage, itemsLimitedTo, materialLinkableTo, isStaff } = require('../services/access');
const { loadPeople, describeUser, userLabel, isSelectable } = require('../services/people');
const { loadProjectAccess, accessFlags, listProjects, createProject } = require('../services/projects');
const { findTemplateId, ensureTemplateQuietly } = require('../services/template');
const { listItems } = require('../services/items');

module.exports = function buildRouter(coreApi) {
  const router = express.Router();
  const auth = coreApi.authenticateToken;
  const pool = coreApi.pool;

  async function requireProject(conn, req, need) {
    const loaded = await loadProjectAccess(conn, parseId(req.params.id, 'project id'), req.user);
    if (!loaded || loaded.access === 'none') throw new HttpError(404, 'Project not found');
    if (need === 'write' && !canWrite(loaded.access)) throw new HttpError(403, 'You need write access to this project');
    if (need === 'manage' && !canManage(loaded.access)) throw new HttpError(403, 'Only the owner can do this');
    return loaded;
  }

  const touch = (conn, id) => conn.query('UPDATE science_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);

  // GET /projects?scope=mine|shared|all&search=&archived=1
  router.get('/projects', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const scope = ['mine', 'shared', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
    await ensureTemplateQuietly(conn, coreApi);
    res.json(await listProjects(conn, req.user, people, {
      scope,
      search: req.query.search,
      includeArchived: req.query.archived === '1'
    }));
  }));

  // POST /projects { title, description } - anyone with access to the module; the caller becomes the owner.
  router.post('/projects', auth, route(pool, async (req, res, conn) => {
    await ensureTemplateQuietly(conn, coreApi);
    res.status(201).json(await createProject(conn, coreApi, req.user, req.body || {}));
  }));

  // GET /projects/:id - the project page: members, linked materials and registered items.
  router.get('/projects/:id', auth, route(pool, async (req, res, conn) => {
    const { project, members, access } = await requireProject(conn, req);
    const people = await loadPeople(coreApi);
    const owner = describeUser(people, project.owner_user_id);
    
    const memberRows = members.map((m) => {
      if (m.member_type === 'group') {
        const g = people.groupsById.get(Number(m.member_id));
        return { id: m.id, member_type: 'group', member_id: m.member_id, access: m.access, name: g ? g.group_name : `Group #${m.member_id}`, username: null, label: g ? g.group_name : `Group #${m.member_id}` };
      }
      const u = describeUser(people, m.member_id);
      return { id: m.id, member_type: 'user', member_id: m.member_id, access: m.access, name: u.name, username: u.username, label: u.label };
    });

    if (project.everyone_access) {
      memberRows.push({ id: 'everyone', member_type: 'everyone', member_id: 0, access: project.everyone_access, name: 'Everyone', username: null, label: 'Everyone (all users)' });
    }

    const materials = await conn.query(
      `SELECT m.id, m.kind, m.name, m.description, m.uniprot_id, m.visibility, m.owner_user_id, pm.added_at
         FROM science_project_materials pm JOIN science_materials m ON m.id = pm.material_id
        WHERE pm.project_id = ? ORDER BY m.kind, m.name`,
      [project.id]
    );
    const isTemplate = (await findTemplateId(conn)) === Number(project.id);
    const onlyCreatedBy = itemsLimitedTo({ isTemplate, access, user: req.user });
    const items = await listItems(conn, project.id, people, { onlyCreatedBy });
    res.json({
      id: project.id,
      number: project.number,
      title: project.title,
      description: project.description,
      folder_path: project.folder_path,
      archived: !!project.archived,
      is_template: isTemplate,
      created_at: project.created_at,
      updated_at: project.updated_at,
      owner,
      ...accessFlags(access),
      members: memberRows,
      materials: materials.map((m) => ({ ...m, owner_label: describeUser(people, m.owner_user_id).label })),
      items,
      items_own_only: onlyCreatedBy !== null
    });
  }));

  // PUT /projects/:id { title?, description?, archived? } - owner / administrator / developer.
  router.put('/projects/:id', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'manage');
    const title = req.body.title === undefined ? project.title : cleanString(req.body.title, { max: 255, required: true, field: 'title' });
    const description = req.body.description === undefined ? project.description : cleanString(req.body.description, { max: 20000, field: 'description' });
    const archived = req.body.archived === undefined ? project.archived : req.body.archived ? 1 : 0;
    await conn.query('UPDATE science_projects SET title = ?, description = ?, archived = ? WHERE id = ?', [title, description, archived, project.id]);
    res.json({ success: true });
  }));

  // POST /projects/:id/transfer { user_id } - hand the project to another user; the previous owner stays on as a write member.
  router.post('/projects/:id/transfer', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'manage');
    const newOwnerId = parseId(req.body.user_id, 'user_id');
    const people = await loadPeople(coreApi);
    const target = people.usersById.get(newOwnerId);
    if (!target || !isSelectable(target)) throw new HttpError(400, 'That user cannot own a project');
    if (newOwnerId === Number(project.owner_user_id)) throw new HttpError(400, 'That user already owns this project');
    await conn.beginTransaction();
    try {
      await conn.query('DELETE FROM science_project_members WHERE project_id = ? AND member_type = ? AND member_id = ?', [project.id, 'user', newOwnerId]);
      await conn.query('UPDATE science_projects SET owner_user_id = ? WHERE id = ?', [newOwnerId, project.id]);
      await conn.query(
        `INSERT INTO science_project_members (project_id, member_type, member_id, access, added_by) VALUES (?, 'user', ?, 'write', ?)
         ON DUPLICATE KEY UPDATE access = 'write'`,
        [project.id, project.owner_user_id, req.user.id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    res.json({ success: true });
  }));

  // GET /share-targets - the users and groups the sharing picker offers (sorted per the MFF people-list rule).
  router.get('/share-targets', auth, route(pool, async (req, res) => {
    const people = await loadPeople(coreApi);
    res.json({
      users: people.users.filter(isSelectable).map((u) => ({ id: u.id, username: u.username, label: userLabel(u) })),
      groups: people.groups
        .filter((g) => !g.archived_at)
        .map((g) => ({ id: g.id, label: g.group_name }))
        .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
    });
  }));

  const setEveryone = (conn, id, access) => conn.query('UPDATE science_projects SET everyone_access = ? WHERE id = ?', [access, id]);

  // POST /projects/:id/members { member_type: 'user'|'group'|'everyone', member_id, access: 'read'|'write' } - add, or change the level of, a share.
  // Read by default. "everyone" (no member_id) is only offered on the Project template.
  router.post('/projects/:id/members', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'manage');
    const type = req.body.member_type;
    if (type === 'everyone') {
      if ((await findTemplateId(conn)) !== Number(project.id)) throw new HttpError(400, 'Only the Project template can be shared with everyone');
      const level = req.body.access === undefined ? 'read' : req.body.access;
      if (level !== 'read' && level !== 'write') throw new HttpError(400, 'access must be "read" or "write"');
      await setEveryone(conn, project.id, level);
      res.status(201).json({ success: true });
      return;
    }
    if (type !== 'user' && type !== 'group') throw new HttpError(400, 'member_type must be "user" or "group"');
    const memberId = parseId(req.body.member_id, 'member_id');
    const access = req.body.access === undefined ? 'read' : req.body.access;
    if (access !== 'read' && access !== 'write') throw new HttpError(400, 'access must be "read" or "write"');
    const people = await loadPeople(coreApi);
    if (type === 'user') {
      const u = people.usersById.get(memberId);
      if (!u || !isSelectable(u)) throw new HttpError(400, 'Unknown user');
      if (memberId === Number(project.owner_user_id)) throw new HttpError(400, 'The owner already has full access');
    } else {
      const g = people.groupsById.get(memberId);
      if (!g || g.archived_at) throw new HttpError(400, 'Unknown group');
    }
    await conn.query(
      `INSERT INTO science_project_members (project_id, member_type, member_id, access, added_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE access = VALUES(access)`,
      [project.id, type, memberId, access, req.user.id]
    );
    await touch(conn, project.id);
    res.status(201).json({ success: true });
  }));

  // PUT /projects/:id/members/:memberRowId { access }
  router.put('/projects/:id/members/:memberRowId', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'manage');
    const access = req.body.access;
    if (access !== 'read' && access !== 'write') throw new HttpError(400, 'access must be "read" or "write"');
    if (req.params.memberRowId === 'everyone') {
      if (!project.everyone_access) throw new HttpError(404, 'Member not found');
      await setEveryone(conn, project.id, access);
      res.json({ success: true });
      return;
    }
    const r = await conn.query('UPDATE science_project_members SET access = ? WHERE id = ? AND project_id = ?', [access, parseId(req.params.memberRowId, 'member'), project.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Member not found');
    await touch(conn, project.id);
    res.json({ success: true });
  }));

  // DELETE /projects/:id/members/:memberRowId
  router.delete('/projects/:id/members/:memberRowId', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'manage');
    if (req.params.memberRowId === 'everyone') {
      if (!project.everyone_access) throw new HttpError(404, 'Member not found');
      await setEveryone(conn, project.id, null);
      res.json({ success: true });
      return;
    }
    const r = await conn.query('DELETE FROM science_project_members WHERE id = ? AND project_id = ?', [parseId(req.params.memberRowId, 'member'), project.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Member not found');
    await touch(conn, project.id);
    res.json({ success: true });
  }));

  // POST /projects/:id/materials { material_id } - link a material the caller can see. Private materials only go into projects owned by their owner.
  router.post('/projects/:id/materials', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'write');
    const materialId = parseId(req.body.material_id, 'material_id');
    const rows = await conn.query('SELECT id, owner_user_id, visibility FROM science_materials WHERE id = ?', [materialId]);
    const material = rows[0];
    const visible = material && (material.visibility === 'public' || Number(material.owner_user_id) === Number(req.user.id) || isStaff(req.user));
    if (!visible) throw new HttpError(404, 'Material not found');
    if (!materialLinkableTo(material, project)) throw new HttpError(409, 'This material is private: it can only be used in projects owned by its owner');
    await conn.query('INSERT IGNORE INTO science_project_materials (project_id, material_id, added_by) VALUES (?, ?, ?)', [project.id, materialId, req.user.id]);
    await touch(conn, project.id);
    res.status(201).json({ success: true });
  }));

  // DELETE /projects/:id/materials/:materialId
  router.delete('/projects/:id/materials/:materialId', auth, route(pool, async (req, res, conn) => {
    const { project } = await requireProject(conn, req, 'write');
    await conn.query('DELETE FROM science_project_materials WHERE project_id = ? AND material_id = ?', [project.id, parseId(req.params.materialId, 'material id')]);
    await touch(conn, project.id);
    res.json({ success: true });
  }));

  return router;
};
