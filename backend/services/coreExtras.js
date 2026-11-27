// What Science uses from core 0.1.227 or later when it is there: notifications,
// a page check outside a request, and core's rule for who may create a project.
// On an older core, a decision is still shown inside Science, only
// administrators and developers are reported as approvers, and Science's own
// rule decides who may create.
const { isStaff } = require('./access');
const { SCIENCE_LINK } = require('./membership');

// The module's declared page (module.manifest.json) for deciding project requests.
const APPROVAL_PAGE = 'project_approvals';

async function isApprover(coreApi, user) {
  if (typeof coreApi.hasPage !== 'function') return isStaff(user);
  try {
    return !!(await coreApi.hasPage(user, APPROVAL_PAGE));
  } catch (err) {
    console.warn(`[science] could not check the approval page: ${err.message}`);
    return false;
  }
}

// Core's rule for who may create a project (Science's, plus core's setting
// "people with a project may create more"): true or false, or null on a core
// without it. Core asks our provider's canCreate on the way, so call this before
// taking a database connection, and never from canCreate itself.
async function coreMayCreate(coreApi, user) {
  if (!coreApi.projects || typeof coreApi.projects.mayCreate !== 'function') return null;
  try {
    return (await coreApi.projects.mayCreate(user)) === true;
  } catch (err) {
    console.warn(`[science] could not ask core who may create a project: ${err.message}`);
    return false;
  }
}

// Middleware: puts that answer on req.coreMayCreate.
const askCoreMayCreate = (coreApi) => async (req, res, next) => {
  req.coreMayCreate = await coreMayCreate(coreApi, req.user);
  next();
};

function decisionNotice(request, projectNumber) {
  const approved = request.status === 'approved';
  const lines = [
    approved
      ? `Your project request "${request.title}" was approved. The project${projectNumber ? ` ${projectNumber}` : ''} is yours.`
      : `Your project request "${request.title}" was declined.`
  ];
  if (request.decision_note) lines.push(`Note: ${request.decision_note}`);
  return {
    title: approved ? 'Your project request was approved' : 'Your project request was declined',
    message: lines.join('\n'),
    link: SCIENCE_LINK
  };
}

// Tells the requester what was decided. Never fails the decision itself.
async function notifyDecision(coreApi, request, projectNumber = null) {
  if (typeof coreApi.notify !== 'function') return;
  try {
    const sent = await coreApi.notify(request.requester_user_id, decisionNotice(request, projectNumber));
    if (sent && !sent.ok) console.warn(`[science] the requester of request ${request.id} was not notified: ${sent.error}`);
  } catch (err) {
    console.warn(`[science] the requester of request ${request.id} was not notified: ${err.message}`);
  }
}

module.exports = { APPROVAL_PAGE, isApprover, coreMayCreate, askCoreMayCreate, decisionNotice, notifyDecision };
