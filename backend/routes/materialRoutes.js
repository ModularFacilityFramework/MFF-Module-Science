// Research materials: proteins, complexes and ligands. Each record has one
// owner and is private or public. Public: other users can find it and link it
// into their own projects. Private: only usable in projects owned by its owner.
const express = require('express');
const { route, HttpError, cleanString, parseId } = require('../services/http');
const { isStaff, canWrite, materialLinkableTo } = require('../services/access');
const { loadPeople, describeUser } = require('../services/people');
const { loadProjectAccess } = require('../services/projects');

const KINDS = ['protein', 'complex', 'ligand'];
const VISIBILITIES = ['private', 'public'];

function readFields(body, existing = {}) {
  const pick = (key, opts) => (body[key] === undefined ? existing[key] ?? null : cleanString(body[key], { field: key, ...opts }));
  const kind = body.kind === undefined ? existing.kind : body.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'kind must be protein, complex or ligand');
  const name = body.name === undefined ? existing.name : cleanString(body.name, { max: 255, required: true, field: 'name' });
  if (!name) throw new HttpError(400, 'name is required');
  const visibility = body.visibility === undefined ? existing.visibility || 'private' : body.visibility;
  if (!VISIBILITIES.includes(visibility)) throw new HttpError(400, 'visibility must be private or public');
  let sequence = pick('sequence', { max: 200000 });
  if (sequence !== null && !/^[A-Za-z*\-\s]*$/.test(sequence)) throw new HttpError(400, 'sequence may only contain letters, "-" and "*"');
  if (sequence !== null) sequence = sequence.replace(/\s+/g, '');
  return {
    kind,
    name,
    visibility,
    description: pick('description', { max: 20000 }),
    sequence,
    uniprot_id: pick('uniprot_id', { max: 40 }),
    smiles: pick('smiles', { max: 5000 })
  };
}

module.exports = function buildRouter(coreApi) {
  const router = express.Router();
  const auth = coreApi.authenticateToken;
  const pool = coreApi.pool;

  async function loadMaterial(conn, req) {
    const rows = await conn.query('SELECT * FROM science_materials WHERE id = ?', [parseId(req.params.id, 'material id')]);
    const m = rows[0];
    if (!m || !(m.visibility === 'public' || Number(m.owner_user_id) === Number(req.user.id) || isStaff(req.user))) throw new HttpError(404, 'Material not found');
    return m;
  }

  const requireOwner = (material, user) => {
    if (Number(material.owner_user_id) !== Number(user.id) && !isStaff(user)) throw new HttpError(403, 'Only the owner can change this material');
  };

  function present(m, people, projectCount) {
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      description: m.description,
      sequence: m.sequence,
      uniprot_id: m.uniprot_id,
      smiles: m.smiles,
      visibility: m.visibility,
      owner_user_id: m.owner_user_id,
      owner_label: describeUser(people, m.owner_user_id).label,
      project_count: projectCount === undefined ? undefined : Number(projectCount),
      updated_at: m.updated_at
    };
  }

  // GET /materials?kind=&scope=visible|mine|public&search=&linkable_project=<id>
  // linkable_project: only the materials the caller could still add to that project.
  router.get('/materials', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const where = [];
    const params = [];
    if (KINDS.includes(req.query.kind)) { where.push('m.kind = ?'); params.push(req.query.kind); }
    if (req.query.scope === 'mine') { where.push('m.owner_user_id = ?'); params.push(req.user.id); }
    else if (req.query.scope === 'public') { where.push("m.visibility = 'public'"); }
    if (!isStaff(req.user)) { where.push("(m.visibility = 'public' OR m.owner_user_id = ?)"); params.push(req.user.id); }
    let project = null;
    if (req.query.linkable_project) {
      const loaded = await loadProjectAccess(conn, parseId(req.query.linkable_project, 'project id'), req.user);
      if (!loaded || !canWrite(loaded.access)) throw new HttpError(403, 'You need write access to this project');
      project = loaded.project;
      where.push('NOT EXISTS (SELECT 1 FROM science_project_materials pm WHERE pm.material_id = m.id AND pm.project_id = ?)');
      params.push(project.id);
    }
    const rows = await conn.query(
      `SELECT m.*, (SELECT COUNT(*) FROM science_project_materials pm WHERE pm.material_id = m.id) AS project_count
         FROM science_materials m ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY m.kind, m.name`,
      params
    );
    const needle = String(req.query.search || '').trim().toLowerCase();
    const out = rows
      .filter((m) => !project || materialLinkableTo(m, project))
      .map((m) => present(m, people, m.project_count))
      .filter((m) => !needle || `${m.name} ${m.uniprot_id || ''} ${m.owner_label}`.toLowerCase().includes(needle));
    res.json(out);
  }));

  router.get('/materials/:id', auth, route(pool, async (req, res, conn) => {
    const m = await loadMaterial(conn, req);
    const people = await loadPeople(coreApi);
    const [{ n }] = await conn.query('SELECT COUNT(*) AS n FROM science_project_materials WHERE material_id = ?', [m.id]);
    res.json(present(m, people, n));
  }));

  // POST /materials - new records start private unless visibility says otherwise.
  router.post('/materials', auth, route(pool, async (req, res, conn) => {
    const f = readFields(req.body);
    const r = await conn.query(
      'INSERT INTO science_materials (kind, name, description, sequence, uniprot_id, smiles, owner_user_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [f.kind, f.name, f.description, f.sequence, f.uniprot_id, f.smiles, req.user.id, f.visibility]
    );
    res.status(201).json({ id: r.insertId });
  }));

  // PUT /materials/:id - owner / administrator / developer. Going private is refused
  // while the material sits in a project owned by someone else.
  router.put('/materials/:id', auth, route(pool, async (req, res, conn) => {
    const m = await loadMaterial(conn, req);
    requireOwner(m, req.user);
    const f = readFields(req.body, m);
    if (f.kind !== m.kind) throw new HttpError(400, 'kind cannot be changed');
    if (f.visibility === 'private' && m.visibility === 'public') {
      const [{ n }] = await conn.query(
        `SELECT COUNT(*) AS n FROM science_project_materials pm JOIN science_projects p ON p.id = pm.project_id
          WHERE pm.material_id = ? AND p.owner_user_id <> ?`,
        [m.id, m.owner_user_id]
      );
      if (Number(n) > 0) throw new HttpError(409, `This material is used in ${n} project(s) owned by other people, so it has to stay public`);
    }
    await conn.query(
      'UPDATE science_materials SET name = ?, description = ?, sequence = ?, uniprot_id = ?, smiles = ?, visibility = ? WHERE id = ?',
      [f.name, f.description, f.sequence, f.uniprot_id, f.smiles, f.visibility, m.id]
    );
    res.json({ success: true });
  }));

  // DELETE /materials/:id - refused while it is linked to any project.
  router.delete('/materials/:id', auth, route(pool, async (req, res, conn) => {
    const m = await loadMaterial(conn, req);
    requireOwner(m, req.user);
    const [{ n }] = await conn.query('SELECT COUNT(*) AS n FROM science_project_materials WHERE material_id = ?', [m.id]);
    if (Number(n) > 0) throw new HttpError(409, `This material is used in ${n} project(s): remove it from them first`);
    await conn.query('DELETE FROM science_materials WHERE id = ?', [m.id]);
    res.json({ success: true });
  }));

  return router;
};
