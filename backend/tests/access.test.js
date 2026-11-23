// Run with: nvm exec 20 npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../services/access');
const { cleanLink, cleanString, HttpError } = require('../services/http');
const { slug } = require('../services/projects');
const { compareUsers, userLabel } = require('../services/people');

const project = { id: 1, owner_user_id: 10 };
const user = (over = {}) => ({ id: 20, group_id: 5, roles: ['facility_user'], ...over });

test('owner has owner access even with no member row', () => {
  assert.equal(a.resolveAccess({ project, members: [], user: user({ id: 10 }) }), 'owner');
});

test('administrators and developers get admin access on any project; the owner stays owner', () => {
  assert.equal(a.resolveAccess({ project, members: [], user: user({ roles: ['administrator'] }) }), 'admin');
  assert.equal(a.resolveAccess({ project, members: [], user: user({ roles: ['Developer'] }) }), 'admin');
  assert.equal(a.resolveAccess({ project, members: [], user: user({ id: 10, roles: ['administrator'] }) }), 'owner');
});

test('a stranger sees nothing', () => {
  assert.equal(a.resolveAccess({ project, members: [], user: user() }), 'none');
  assert.equal(a.canRead('none'), false);
});

test('direct and group grants add up: the highest wins', () => {
  const members = [
    { member_type: 'user', member_id: 20, access: 'read' },
    { member_type: 'group', member_id: 5, access: 'write' }
  ];
  assert.equal(a.resolveAccess({ project, members, user: user() }), 'write');
  assert.equal(a.resolveAccess({ project, members: members.slice(0, 1), user: user() }), 'read');
});

test('a grant to someone else or another group does not apply; a user with no group is safe', () => {
  const members = [
    { member_type: 'user', member_id: 21, access: 'write' },
    { member_type: 'group', member_id: 6, access: 'write' },
    { member_type: 'group', member_id: 0, access: 'write' }
  ];
  assert.equal(a.resolveAccess({ project, members, user: user() }), 'none');
  assert.equal(a.resolveAccess({ project, members, user: user({ group_id: null }) }), 'none');
});

test('permission helpers', () => {
  assert.deepEqual(['none', 'read', 'write', 'owner', 'admin'].map(a.canWrite), [false, false, true, true, true]);
  assert.deepEqual(['none', 'read', 'write', 'owner', 'admin'].map(a.canManage), [false, false, false, true, true]);
  assert.equal(a.levelFromNumber(2), 'write');
  assert.equal(a.levelFromNumber(1), 'read');
  assert.equal(a.levelFromNumber(0), 'none');
});

test('private materials only go into their owner\'s projects, public ones anywhere', () => {
  assert.equal(a.materialLinkableTo({ visibility: 'public', owner_user_id: 99 }, project), true);
  assert.equal(a.materialLinkableTo({ visibility: 'private', owner_user_id: 10 }, project), true);
  assert.equal(a.materialLinkableTo({ visibility: 'private', owner_user_id: 99 }, project), false);
});

test('private materials are visible to their owner and staff only', () => {
  const m = { visibility: 'private', owner_user_id: 20 };
  assert.equal(a.materialVisibleTo(m, user()), true);
  assert.equal(a.materialVisibleTo(m, user({ id: 21 })), false);
  assert.equal(a.materialVisibleTo(m, user({ id: 21, roles: ['administrator'] })), true);
  assert.equal(a.materialVisibleTo({ ...m, visibility: 'public' }, user({ id: 21 })), true);
});

test('item links must be in-app paths', () => {
  assert.equal(cleanLink('/abcfold?job=12'), '/abcfold?job=12');
  assert.equal(cleanLink(''), null);
  for (const bad of ['https://evil.example', '//evil.example', 'data:text/html,x', '/a b', '/a\\b']) {
    assert.throws(() => cleanLink(bad), HttpError, bad);
  }
});

test('cleanString trims, requires and limits', () => {
  assert.equal(cleanString('  hi ', { max: 5 }), 'hi');
  assert.throws(() => cleanString('', { required: true, field: 'title' }), /title is required/);
  assert.throws(() => cleanString('abcdef', { max: 5 }), /too long/);
  assert.throws(() => cleanString(5, {}), /must be text/);
});

test('folder slug is safe and short', () => {
  assert.equal(slug('My Ribosome / 70S!'), 'my-ribosome-70s');
  assert.equal(slug('../../etc'), 'etc');
  assert.equal(slug('???'), 'project');
  assert.ok(slug('x'.repeat(200)).length <= 40);
});

test('people are sorted by first name, then last name, case-insensitively, and labelled with the username', () => {
  const list = [
    { first_name: 'bob', last_name: 'Zed', username: 'bz' },
    { first_name: 'Alice', last_name: 'Young', username: 'ay' },
    { first_name: 'Alice', last_name: 'adams', username: 'aa' }
  ].sort(compareUsers);
  assert.deepEqual(list.map((u) => u.username), ['aa', 'ay', 'bz']);
  assert.equal(userLabel(list[0]), 'Alice adams (aa)');
});
