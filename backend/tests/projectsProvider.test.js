// The provider core's ProjectPicker reads (frontend/projectsProvider.js). It
// imports nothing, so it is loaded here as an ES module straight from source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../frontend/projectsProvider.js'), 'utf8');
const load = () => import(`data:text/javascript,${encodeURIComponent(source)}`);

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

async function providerWith(api) {
  const { createProjectsProvider } = await load();
  return createProjectsProvider({ api });
}

test('get() reads the flat project from the /external API', async () => {
  let seen = null;
  const provider = await providerWith({ get: async (url) => { seen = url; return { data: { id: 7 } }; } });
  assert.deepEqual(await provider.get(7), { id: 7 });
  assert.equal(seen, '/science/external/projects/7');
});

test('get() returns null for a project that is gone or not accessible', async () => {
  const provider = await providerWith({ get: async () => { throw httpError(404); } });
  assert.equal(await provider.get(99), null);
});

test('get() passes other failures on, so a remembered project is not dropped', async () => {
  const provider = await providerWith({ get: async () => { throw httpError(503); } });
  await assert.rejects(provider.get(7), /HTTP 503/);
});

test('create() posts to the /external API and returns the new project', async () => {
  let seen = null;
  const provider = await providerWith({ post: async (url, body) => { seen = [url, body]; return { data: { id: 7 } }; } });
  assert.deepEqual(await provider.create({ title: 'Ribosome' }), { id: 7 });
  assert.deepEqual(seen, ['/science/external/projects', { title: 'Ribosome' }]);
});

test('list() passes scope, search and archived to the API', async () => {
  let seen = null;
  const provider = await providerWith({ get: async (url, opts) => { seen = [url, opts.params]; return { data: [] }; } });
  await provider.list({ scope: 'shared', search: 'rib', includeArchived: true });
  assert.deepEqual(seen, ['/science/external/projects', { scope: 'shared', search: 'rib', archived: 1 }]);
});
