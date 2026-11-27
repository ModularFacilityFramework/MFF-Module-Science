const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTemplateOwner, ensureTemplate } = require('../services/template');
const { parseOldItem, adoptItems, listItems, MAX_BATCH } = require('../services/items');
const { resolveAccess, itemsLimitedTo } = require('../services/access');

const user = (id, over = {}) => ({ id, account_type: 'standard', registration_pending: 0, status: 'active', roles: ['facility_user'], ...over });

test('the template is owned by the first administrator or developer who can log in', () => {
  const users = [
    user(1),
    user(2, { roles: ['administrator'], status: 'inactive' }),
    user(3, { roles: ['administrator'], account_type: 'no_login' }),
    user(4, { roles: ['developer'], registration_pending: 1 }),
    user(7, { roles: ['administrator'] }),
    user(5, { roles: ['Developer'] })
  ];
  assert.equal(pickTemplateOwner(users).id, 5);
  assert.equal(pickTemplateOwner([user(1)]), null);
});

test('an existing template is returned without creating or looking for an owner', async () => {
  const conn = { query: async () => [{ project_id: 12 }] };
  assert.equal(await ensureTemplate(conn, { listUsers: () => assert.fail('not needed') }), 12);
});

test('no administrator or developer yet: nothing is created', async () => {
  const conn = { query: async () => [], beginTransaction: () => assert.fail('must not write') };
  assert.equal(await ensureTemplate(conn, { listUsers: async () => [user(1)] }), null);
});

test('losing the creation race rolls back and returns the winner', async () => {
  let rolledBack = false;
  const conn = {
    beginTransaction: async () => {},
    commit: () => assert.fail('must not commit'),
    rollback: async () => { rolledBack = true; },
    query: async (sql) => {
      if (sql.startsWith('SELECT project_id')) return rolledBack ? [{ project_id: 3 }] : [];
      if (sql.startsWith('INSERT INTO science_template')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return { insertId: 4 };
    }
  };
  assert.equal(await ensureTemplate(conn, { listUsers: async () => [user(1, { roles: ['administrator'] })] }), 3);
  assert.equal(rolledBack, true);
});

test('sharing with everyone gives its level, and a higher personal grant still wins', () => {
  const project = { owner_user_id: 1, everyone_access: 'read' };
  const me = { id: 2, group_id: null, roles: ['facility_user'] };
  assert.equal(resolveAccess({ project, members: [], user: me }), 'read');
  assert.equal(resolveAccess({ project, members: [{ member_type: 'user', member_id: 2, access: 'write' }], user: me }), 'write');
  assert.equal(resolveAccess({ project: { ...project, everyone_access: 'write' }, members: [], user: me }), 'write');
  assert.equal(resolveAccess({ project: { ...project, everyone_access: null }, members: [], user: me }), 'none');
});

test('an old item keeps its creator and date, and both are optional', () => {
  const base = { item_type: 'job', item_id: 7, title: 'Old job' };
  assert.deepEqual([parseOldItem(base).createdBy, parseOldItem(base).createdAt, parseOldItem(base).itemId], [0, null, '7']);
  const full = parseOldItem({ ...base, created_by: 9, created_at: '2025-03-04T10:00:00Z' });
  assert.equal(full.createdBy, 9);
  assert.equal(full.createdAt.toISOString(), '2025-03-04T10:00:00.000Z');
  assert.throws(() => parseOldItem({ ...base, created_by: 'me' }), /created_by/);
  assert.throws(() => parseOldItem({ ...base, created_at: 'yesterday' }), /created_at/);
  assert.throws(() => parseOldItem({ ...base, link: 'https://example.org' }), /link/);
});

test('moving old items: bad and already-placed ones are reported, the rest are saved', async () => {
  const inserted = [];
  const conn = {
    query: async (sql, params) => {
      if (sql.startsWith('SELECT project_id')) return params[2] === '2' ? [{ project_id: 8 }] : [];
      inserted.push(params);
      return {};
    }
  };
  const result = await adoptItems(conn, 1, 'abcfold', [
    { item_type: 'job', item_id: 1, title: 'one', created_by: 5 },
    { item_type: 'job', item_id: 2, title: 'two' },
    { item_type: 'job', item_id: 3 }
  ]);
  assert.equal(result.saved, 1);
  assert.deepEqual(result.skipped.map((s) => [s.item_id, s.reason, s.project_id]), [['2', 'in_another_project', 8], [3, 'invalid', undefined]]);
  assert.deepEqual(inserted.map((p) => [p[0], p[1], p[3], p[7]]), [[1, 'abcfold', '1', 5]]);
  await assert.rejects(adoptItems(conn, 1, 'abcfold', []), /non-empty/);
  await assert.rejects(adoptItems(conn, 1, 'abcfold', new Array(MAX_BATCH + 1).fill({})), /at most/);
});

test('in the Project template each person sees only their own items; its owner and staff see all', () => {
  const me = { id: 2 };
  for (const access of ['read', 'write']) assert.equal(itemsLimitedTo({ isTemplate: true, access, user: me }), 2);
  for (const access of ['owner', 'admin']) assert.equal(itemsLimitedTo({ isTemplate: true, access, user: me }), null);
  assert.equal(itemsLimitedTo({ isTemplate: false, access: 'read', user: me }), null);
});

test('listing items cannot forget the limit', async () => {
  await assert.rejects(listItems({ query: async () => [] }, 1, {}), /onlyCreatedBy is required/);
});
