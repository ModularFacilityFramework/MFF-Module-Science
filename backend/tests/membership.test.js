const test = require('node:test');
const assert = require('node:assert/strict');
const { isWorkProject, mayCreate, hasWorkProject, strandedBy, peopleBehind } = require('../services/membership');
const { countItems } = require('../services/projects');
const { parseRequest, requestOptions, shapeRequest, decideRequest } = require('../services/requests');
const { applyAssignment, assignmentOptions } = require('../services/assignment');

const person = (id, over = {}) => ({ id, username: `u${id}`, first_name: `N${id}`, last_name: 'X', group_id: null, roles: ['facility_user'], account_type: 'standard', status: 'active', ...over });
const project = (id, over = {}) => ({ id, owner_user_id: 100, archived: 0, everyone_access: null, is_template: 0, ...over });
const share = (id, projectId, userId, access = 'write', type = 'user') => ({ id, project_id: projectId, member_type: type, member_id: userId, access });

test('only a project you can write in, not archived and not the template, counts', () => {
  const p = { can_write: true, is_template: false, archived: false };
  assert.equal(isWorkProject(p), true);
  for (const over of [{ can_write: false }, { is_template: true }, { archived: true }]) {
    assert.equal(isWorkProject({ ...p, ...over }), false);
  }
});

test('without a project you cannot create one; administrators and developers always can', () => {
  assert.equal(mayCreate(person(1), 0), false);
  assert.equal(mayCreate(person(1), 1), true);
  assert.equal(mayCreate(person(1, { roles: ['developer'] }), 0), true);
});

test('hasWorkProject: ownership or a write share, never the template', () => {
  const me = person(1);
  const none = new Map();
  assert.equal(hasWorkProject(me, [project(1, { owner_user_id: 1 })], none), true);
  assert.equal(hasWorkProject(me, [project(1, { is_template: 1, everyone_access: 'write' })], none), false);
  assert.equal(hasWorkProject(me, [project(1, { owner_user_id: 1, archived: 1 })], none), false);
  assert.equal(hasWorkProject(me, [project(1)], new Map([[1, [share(1, 1, 1, 'read')]]])), false);
  assert.equal(hasWorkProject(me, [project(1)], new Map([[1, [share(1, 1, 1, 'write')]]])), true);
});

test('removing or lowering a share names only those it leaves without a project', () => {
  const projects = [project(1), project(2)];
  const members = [share(10, 1, 1), share(11, 1, 2), share(12, 2, 2)];
  const only = (userId, memberRowId, access) => strandedBy({ projects, members, candidates: [person(userId)], memberRowId, access }).map((u) => u.id);
  assert.deepEqual(only(1, 10, 'none'), [1]);
  assert.deepEqual(only(1, 10, 'read'), [1]);
  assert.deepEqual(only(2, 11, 'none'), []);
});

test('a group share concerns its members who can log in, unless they have another way in', () => {
  const people = { users: [person(1, { group_id: 9 }), person(2, { group_id: 9 }), person(3, { group_id: 9, account_type: 'no_login' }), person(4)] };
  const group = share(20, 1, 9, 'write', 'group');
  const candidates = peopleBehind(group, people);
  assert.deepEqual(candidates.map((u) => u.id), [1, 2]);
  const left = strandedBy({ projects: [project(1), project(2, { owner_user_id: 2 })], members: [group], candidates, memberRowId: 20, access: 'none' });
  assert.deepEqual(left.map((u) => u.id), [1]);
});

test('item counts per module, optionally only your own', () => {
  const rows = [{ module_id: 'abcfold', n: 3, own: 1 }, { module_id: 'cryoem', n: 2, own: 0 }];
  assert.deepEqual(countItems(rows, false), { item_count: 5, item_counts: { abcfold: 3, cryoem: 2 } });
  assert.deepEqual(countItems(rows, true), { item_count: 1, item_counts: { abcfold: 1 } });
  assert.deepEqual(countItems(undefined, false), { item_count: 0, item_counts: {} });
});

const people = (() => {
  const users = [person(1), person(2, { is_pi: true }), person(3, { account_type: 'no_login' })];
  const groups = [{ id: 7, group_name: 'Lab', archived_at: null }, { id: 8, group_name: 'Old', archived_at: '2025-01-01' }];
  return { users, groups, usersById: new Map(users.map((u) => [u.id, u])), groupsById: new Map(groups.map((g) => [g.id, g])) };
})();

test('a request needs a title and a short text; group and PI are optional but must be real ones', () => {
  assert.deepEqual(requestOptions(people).groups.map((g) => g.id), [7]);
  assert.deepEqual(requestOptions(people).pis.map((p) => p.id), [2]);
  assert.deepEqual(parseRequest({ title: ' T ', description: 'why', group_id: 7, pi_user_id: '' }, people), { title: 'T', description: 'why', groupId: 7, piUserId: null });
  assert.throws(() => parseRequest({ title: 'T' }, people), /description/);
  assert.throws(() => parseRequest({ title: 'T', description: 'x'.repeat(2001) }, people), /too long/);
  assert.throws(() => parseRequest({ title: 'T', description: 'why', group_id: 8 }, people), /group_id/);
  assert.throws(() => parseRequest({ title: 'T', description: 'why', pi_user_id: 1 }, people), /pi_user_id/);
});

test('a decision is new to the requester until seen; a cancellation never is', () => {
  const row = { id: 1, requester_user_id: 1, title: 't', description: 'd', group_id: null, pi_user_id: null, status: 'declined', decided_by: 2, decided_at: null, decision_note: null, project_id: null, seen_by_requester: 0 };
  assert.equal(shapeRequest(row, people).unseen, true);
  assert.equal(shapeRequest({ ...row, seen_by_requester: 1 }, people).unseen, false);
  assert.equal(shapeRequest({ ...row, status: 'cancelled' }, people).unseen, false);
});

test('an approver who is not staff cannot decide their own request', async () => {
  let rolledBack = false;
  const conn = {
    beginTransaction: async () => {},
    commit: () => assert.fail('must not commit'),
    rollback: async () => { rolledBack = true; },
    query: async () => [{ id: 5, requester_user_id: 1, status: 'pending' }]
  };
  await assert.rejects(decideRequest(conn, {}, person(1), 5, { approve: true }, people), (e) => e.status === 403);
  assert.equal(rolledBack, true);
});

test('assigning projects at registration is for administrators and developers only', async () => {
  const conn = { query: () => assert.fail('must not read'), beginTransaction: () => assert.fail('must not write') };
  const manager = person(9, { roles: ['facility_manager'] });
  await assert.rejects(assignmentOptions(conn, manager, 1, people), (e) => e.status === 403);
  await assert.rejects(applyAssignment(conn, {}, manager, 1, {}, people), (e) => e.status === 403);
  const admin = person(9, { roles: ['administrator'] });
  await assert.rejects(applyAssignment(conn, {}, admin, 3, {}, people), (e) => e.status === 400);
  await assert.rejects(applyAssignment(conn, {}, admin, 99, {}, people), (e) => e.status === 404);
  await assert.rejects(applyAssignment(conn, {}, admin, 1, { grants: [{ project_id: 1, access: 'owner' }] }, people), /access must be/);
});
