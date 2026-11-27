// The "Project template" project. Science creates it once, on a new and on an
// existing installation alike. It holds the work done before projects existed
// (modules move their project-less items into it, see routes/templateRoutes.js)
// and is the example people see to learn what a project looks like.
//
// Owner: the first administrator or developer. Everyone has read access; the
// owner can change that like any other share. It is found by its row in
// science_template, never by its title, which the owner may change.
const { STAFF_ROLES } = require('./access');
const { assignNumber } = require('./projects');

const TITLE = 'Project template';
const DESCRIPTION = [
  'This is the example project: it shows what an MFF project looks like. It also holds the work done before projects existed.',
  '',
  '- Items: every job or record a module adds to a project is listed on the Items tab. An item from a module you cannot use is shown greyed out. In this project, each person sees only the items they made; its owner, administrators and developers see them all.',
  '- Proteins, complexes & ligands: the research materials of a project. The three here are examples.',
  '- Sharing: a project has one owner, who can share it with users or groups, to read only or also to write. This one is shared with everyone, to read; its owner can change that.',
  '',
  'For your own work, make a project of your own with "+ New project".'
].join('\n');

const EXAMPLE_MATERIALS = [
  { kind: 'protein', name: 'Example protein: hen egg-white lysozyme', uniprot_id: 'P00698', smiles: null },
  { kind: 'complex', name: 'Example complex: 70S ribosome', uniprot_id: null, smiles: null },
  { kind: 'ligand', name: 'Example ligand: benzamidine', uniprot_id: null, smiles: 'NC(=N)c1ccccc1' }
];

// The administrator or developer with the lowest id who can really log in, or null.
function pickTemplateOwner(users) {
  const staff = (users || []).filter((u) =>
    u.account_type !== 'no_login' &&
    !u.registration_pending &&
    u.status !== 'inactive' &&
    (u.roles || []).some((r) => STAFF_ROLES.includes(String(r).toLowerCase())));
  staff.sort((a, b) => Number(a.id) - Number(b.id));
  return staff[0] || null;
}

async function findTemplateId(conn) {
  const rows = await conn.query('SELECT project_id FROM science_template WHERE slot = 1');
  return rows.length ? Number(rows[0].project_id) : null;
}

// The template's project id, creating the project when there is none yet. Safe
// to call at any time and from several requests at once: the primary key of
// science_template lets only one creation commit. Returns null while there is
// no administrator or developer to own it. `conn` must not be in a transaction.
async function ensureTemplate(conn, coreApi) {
  const existing = await findTemplateId(conn);
  if (existing !== null) return existing;
  const owner = pickTemplateOwner(await coreApi.listUsers());
  if (!owner) return null;
  await conn.beginTransaction();
  try {
    const r = await conn.query(
      "INSERT INTO science_projects (title, description, owner_user_id, everyone_access, created_by) VALUES (?, ?, ?, 'read', ?)",
      [TITLE, DESCRIPTION, owner.id, owner.id]
    );
    // Claim the one slot before anything else: a second creator stops here.
    await conn.query('INSERT INTO science_template (slot, project_id) VALUES (1, ?)', [r.insertId]);
    await assignNumber(conn, coreApi, r.insertId, TITLE);
    for (const m of EXAMPLE_MATERIALS) {
      const made = await conn.query(
        "INSERT INTO science_materials (kind, name, description, uniprot_id, smiles, owner_user_id, visibility) VALUES (?, ?, ?, ?, ?, ?, 'private')",
        [m.kind, m.name, 'An example record in the Project template.', m.uniprot_id, m.smiles, owner.id]
      );
      await conn.query('INSERT INTO science_project_materials (project_id, material_id, added_by) VALUES (?, ?, ?)', [r.insertId, made.insertId, owner.id]);
    }
    await conn.commit();
    return r.insertId;
  } catch (err) {
    await conn.rollback();
    // Another request (or process) created it first.
    const winner = await findTemplateId(conn);
    if (winner !== null) return winner;
    throw err;
  }
}

// For places that only want the template to exist (a project list, startup):
// a failure is logged and never breaks the caller.
async function ensureTemplateQuietly(conn, coreApi) {
  try {
    return await ensureTemplate(conn, coreApi);
  } catch (err) {
    console.warn(`[science] could not create the Project template yet: ${err.message} (after an update, apply the database schema)`);
    return null;
  }
}

module.exports = { TITLE, pickTemplateOwner, findTemplateId, ensureTemplate, ensureTemplateQuietly };
