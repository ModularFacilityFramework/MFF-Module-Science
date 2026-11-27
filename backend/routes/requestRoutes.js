// "Request a project" and its approval. Anyone using Science sees where they
// stand and their own requests. Deciding is for the module's declared page
// "project_approvals": administrators and developers, plus whoever an
// administrator grants that page (Setup -> Preferences -> Access).
const express = require('express');
const { route, parseId } = require('../services/http');
const { isStaff } = require('../services/access');
const { loadPeople } = require('../services/people');
const { projectStatus } = require('../services/membership');
const requests = require('../services/requests');

const APPROVAL_PAGE = 'project_approvals';

module.exports = function buildRouter(coreApi) {
  const router = express.Router();
  const auth = coreApi.authenticateToken;
  const pool = coreApi.pool;

  // requirePage lets a call another module makes on a user's behalf through
  // without the page grant, so those are refused first: approving is done by a
  // person, in Science.
  const inPerson = (req, res, next) => {
    if (req.delegatedFrom || (req.user && req.user.backgroundBy)) return res.status(403).json({ error: 'This can only be done in Science' });
    return next();
  };
  // A core without per-page access: administrators and developers only.
  const approverPage = typeof coreApi.requirePage === 'function'
    ? coreApi.requirePage(APPROVAL_PAGE)
    : (req, res, next) => (isStaff(req.user) ? next() : res.status(403).json({ error: 'Only administrators and developers can do this' }));
  const approver = [auth, inPerson, approverPage];

  // GET /status - { has_project, project_count, can_create, can_request, pending_request, new_decisions }
  router.get('/status', auth, route(pool, async (req, res, conn) => {
    const people = await loadPeople(coreApi);
    const mine = await requests.listMine(conn, req.user.id, people);
    res.json({
      ...(await projectStatus(conn, req.user, people)),
      pending_request: mine.find((r) => r.status === 'pending') || null,
      new_decisions: mine.filter((r) => r.unseen)
    });
  }));

  router.get('/request-options', auth, route(pool, async (req, res) => {
    res.json(requests.requestOptions(await loadPeople(coreApi)));
  }));

  router.get('/requests/mine', auth, route(pool, async (req, res, conn) => {
    res.json(await requests.listMine(conn, req.user.id, await loadPeople(coreApi)));
  }));

  // POST /requests { title, description, group_id?, pi_user_id? }
  router.post('/requests', auth, route(pool, async (req, res, conn) => {
    res.status(201).json(await requests.createRequest(conn, req.user, req.body || {}, await loadPeople(coreApi)));
  }));

  router.post('/requests/:id/cancel', auth, route(pool, async (req, res, conn) => {
    await requests.cancelRequest(conn, req.user.id, parseId(req.params.id, 'request id'));
    res.json({ success: true });
  }));

  // POST /requests/seen { ids } - the requester has seen these decisions.
  router.post('/requests/seen', auth, route(pool, async (req, res, conn) => {
    await requests.markSeen(conn, req.user.id, (req.body || {}).ids);
    res.json({ success: true });
  }));

  // GET /approvals?status=pending|approved|declined|cancelled|all
  router.get('/approvals', ...approver, route(pool, async (req, res, conn) => {
    const wanted = req.query.status === 'all' ? null : req.query.status || 'pending';
    res.json({
      requests: await requests.listAll(conn, await loadPeople(coreApi), wanted),
      pending: await requests.pendingCount(conn)
    });
  }));

  // POST /approvals/:id/approve|decline { note? }
  for (const [action, approve] of [['approve', true], ['decline', false]]) {
    router.post(`/approvals/:id/${action}`, ...approver, route(pool, async (req, res, conn) => {
      const id = parseId(req.params.id, 'request id');
      const note = (req.body || {}).note;
      res.json(await requests.decideRequest(conn, coreApi, req.user, id, { approve, note }, await loadPeople(coreApi)));
    }));
  }

  return router;
};

module.exports.APPROVAL_PAGE = APPROVAL_PAGE;
