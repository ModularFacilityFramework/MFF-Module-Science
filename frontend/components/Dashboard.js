// This module's top-level content - the component passed to registerDashboardTab
// in frontend/index.js. Core's Dashboard wrapper already pads the page, so this
// starts directly with its own sub-tab bar (docs/MFF-Core_module-ui-guide.md).
// Who may open the module at all is core's decision (Modules -> Access); every
// signed-in user who can open it sees both tabs, and what they may do inside a
// project or on a material is decided by the module's backend.
import React from 'react';
import ProjectsTab from './ProjectsTab';
import MaterialsTab from './MaterialsTab';
import { ui } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';

const TABS = [
  { key: 'projects', label: 'Projects', component: ProjectsTab },
  { key: 'materials', label: 'Materials', component: MaterialsTab }
];
const TAB_KEYS = TABS.map((t) => t.key);

function Dashboard({ coreApi }) {
  const [activeTab, setActiveTab] = usePageStateSafe(coreApi, 'science.main.tab', 'projects', TAB_KEYS);
  const current = TABS.find((t) => t.key === activeTab) || TABS[0];
  const Active = current.component;
  return (
    <div>
      <div style={ui.tabBar}>
        {TABS.map((tab) => (
          <div key={tab.key} style={ui.tab(tab.key === current.key)} onClick={() => setActiveTab(tab.key)}>{tab.label}</div>
        ))}
      </div>
      <div style={ui.panel}>
        <Active coreApi={coreApi} />
      </div>
    </div>
  );
}

export default Dashboard;
