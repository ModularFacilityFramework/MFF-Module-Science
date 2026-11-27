// What Science uses from core 0.1.224 or later when it is there: notifications
// and a page check outside a request. On an older core, a decision is still
// shown inside Science and only administrators and developers are reported as
// approvers.
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

module.exports = { APPROVAL_PAGE, isApprover, decisionNotice, notifyDecision };
