// What a module may send to import an old project, and the repeat rules. The
// route and the real SQL are checked against a database outside the unit tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImport, importProject } = require('../services/imports');

const status = (n) => (err) => err.status === n;

test('old_id is the module\'s own id, as text or a whole number', () => {
  assert.deepEqual(parseImport({ old_id: 7, title: ' Ribosomes ' }), { oldId: '7', title: 'Ribosomes', description: null });
  assert.deepEqual(parseImport({ old_id: ' a-1 ', title: 'x', description: 'd' }), { oldId: 'a-1', title: 'x', description: 'd' });
});

test('a missing or unusable old_id or title is refused', () => {
  for (const body of [
    { title: 'x' }, { old_id: '', title: 'x' }, { old_id: null, title: 'x' }, { old_id: 1.5, title: 'x' },
    { old_id: {}, title: 'x' }, { old_id: [1], title: 'x' }, { old_id: 'a'.repeat(129), title: 'x' },
    { old_id: 1 }, { old_id: 1, title: ' ' }, { old_id: 1, title: 'a'.repeat(256) }
  ]) {
    assert.throws(() => parseImport(body), status(400), JSON.stringify(body));
  }
});

// A connection that already holds one import, made for user 5.
const withImport = {
  async query(sql) {
    if (sql.includes('science_project_imports i')) return [{ owner_user_id: 5, id: 3, number: 'P-0003' }];
    if (sql.includes('FROM science_projects WHERE id')) return [{ id: 3, number: 'P-0003', owner_user_id: 8 }];
    if (sql.includes('science_project_members')) return [{ member_type: 'user', member_id: 5, access: 'read' }];
    throw new Error(`unexpected: ${sql}`);
  },
  async beginTransaction() { throw new Error('a repeat must not write'); }
};

test('a repeat gives the first project and the access the person has now, and writes nothing', async () => {
  const result = await importProject(withImport, {}, { id: 5, roles: [] }, 'alphapulldown', { old_id: 1, title: 'x' });
  assert.deepEqual(result, {
    created: false, project: { id: 3, number: 'P-0003' }, access: 'read', can_read: true, can_write: false, can_manage: false
  });
});

test('an old project imported for one user is not given to another', async () => {
  await assert.rejects(importProject(withImport, {}, { id: 6, roles: [] }, 'alphapulldown', { old_id: 1, title: 'x' }), status(409));
});
