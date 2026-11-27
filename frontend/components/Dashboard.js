// This module's top-level content - the component passed to registerDashboardTab
// in frontend/index.js. Core's Dashboard wrapper already pads the page, so this
// starts directly with its own sub-tab bar (docs/MFF-Core_module-ui-guide.md).
// Who may open the module at all is core's decision (Modules -> Access); what
// someone may do inside it is decided by the module's backend.
import React, { useCallback, useEffect, useState } from 'react';
import ProjectsTab from './ProjectsTab';
import MaterialsTab from './MaterialsTab';
import RequestsTab from './RequestsTab';
import { ui } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';

const TABS = [
  { key: 'projects', label: 'Projects', component: ProjectsTab },
  { key: 'materials', label: 'Materials', component: MaterialsTab },
  { key: 'requests', label: 'Project requests', component: RequestsTab }
];
const TAB_KEYS = TABS.map((t) => t.key);

// May this user decide project requests? Core's per-page access to the module's
// "project_approvals" page: administrators, developers and whoever is granted it.
function useIsApprover(coreApi) {
  // Whether core offers the hook is fixed for the session, so the hook order is stable.
  const access = typeof coreApi.useModuleAccess === 'function'
    ? coreApi.useModuleAccess('science') // eslint-disable-line react-hooks/rules-of-hooks
    : null;
  return !!(access && Array.isArray(access.pages) && access.pages.includes('project_approvals'));
}

// What the user should know about their projects, above every tab but Requests.
function Notices({ info, isApprover, waitingForApprover, open }) {
  const lines = [];
  if (info && info.new_decisions.length) {
    for (const r of info.new_decisions) {
      lines.push([`d${r.id}`, `Your project request "${r.title}" was ${r.status}.`, 'See it']);
    }
  } else if (info && !info.has_project && info.can_request) {
    if (info.pending_request) {
      lines.push(['waiting', `Your project request "${info.pending_request.title}" is waiting for a decision.`, 'See it']);
    } else {
      lines.push(['none', 'You have no project yet. You need one before you can run or record project work.', 'Request a project']);
    }
  }
  if (isApprover && waitingForApprover > 0) {
    lines.push(['review', `${waitingForApprover} project request${waitingForApprover === 1 ? ' is' : 's are'} waiting for a decision.`, 'Review']);
  }
  return lines.map(([key, text, button]) => (
    <div key={key} style={{ ...ui.hint, display: 'block' }}>
      {text} <button style={{ ...ui.button('#007bff'), marginLeft: '8px' }} onClick={open}>{button}</button>
    </div>
  ));
}

function Dashboard({ coreApi }) {
  const { api } = coreApi;
  const [activeTab, setActiveTab] = usePageStateSafe(coreApi, 'science.main.tab', 'projects', TAB_KEYS);
  const current = TABS.find((t) => t.key === activeTab) || TABS[0];
  const Active = current.component;
  const isApprover = useIsApprover(coreApi);
  const [info, setInfo] = useState(null);
  const [waitingForApprover, setWaiting] = useState(0);

  const refresh = useCallback(() => {
    // A failure leaves what was there: the tabs report their own errors.
    api.get('/science/status').then((res) => setInfo(res.data)).catch(() => {});
    if (isApprover) api.get('/science/approvals').then((res) => setWaiting(res.data.pending)).catch(() => {});
  }, [api, isApprover]);
  useEffect(refresh, [refresh, current.key]);

  return (
    <div>
      <div style={ui.tabBar}>
        {TABS.map((tab) => (
          <div key={tab.key} style={ui.tab(tab.key === current.key)} onClick={() => setActiveTab(tab.key)}>
            {tab.label}{tab.key === 'requests' && isApprover && waitingForApprover > 0 && <span style={ui.chip('#fd7e14')}>{waitingForApprover}</span>}
          </div>
        ))}
      </div>
      <div style={ui.panel}>
        {current.key !== 'requests' && <Notices info={info} isApprover={isApprover} waitingForApprover={waitingForApprover} open={() => setActiveTab('requests')} />}
        <Active coreApi={coreApi} info={info} isApprover={isApprover} refresh={refresh} />
      </div>
    </div>
  );
}

export default Dashboard;
