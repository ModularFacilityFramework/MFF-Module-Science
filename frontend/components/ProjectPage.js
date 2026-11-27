// One project: overview, the items other modules registered, linked materials, sharing.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import SharingPanel from './SharingPanel';
import ProjectMaterialsPanel from './ProjectMaterialsPanel';
import { ui, ACCESS_COLORS, ACCESS_LABELS, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';
import { useSortedRowsSafe, sortHeaders } from '../lib/sorting';

const SUBTABS = [
  ['overview', 'Overview'],
  ['items', 'Items'],
  ['materials', 'Proteins, complexes & ligands'],
  ['sharing', 'Sharing']
];

// One registered item. A module the viewer can't use is listed greyed out and can't be opened.
function ItemRow({ coreApi, item }) {
  // coreApi.useModuleAccess exists on every core that has module access; fixed for the session, so hook order is stable.
  const access = typeof coreApi.useModuleAccess === 'function'
    ? coreApi.useModuleAccess(item.module_id) // eslint-disable-line react-hooks/rules-of-hooks
    : { loading: false, visible: true };
  const blocked = !access.loading && !access.visible;
  return (
    <tr style={blocked ? ui.greyedRow : undefined} title={blocked ? `No access to ${item.module_id}` : undefined}>
      <td style={ui.td}>{item.module_id}</td>
      <td style={ui.td}>{item.item_type}</td>
      <td style={ui.td}>
        {!blocked && item.link ? <a href={item.link}>{item.title}</a> : item.title}
        {blocked && <div style={ui.meta}>No access to {item.module_id}</div>}
      </td>
      <td style={ui.td}>{item.status || ''}</td>
      <td style={ui.td}>{item.created_by_label}</td>
      <td style={ui.td}>{item.updated_at ? new Date(item.updated_at).toLocaleString() : ''}</td>
    </tr>
  );
}

const ITEM_HEADERS = [['module_id', 'Module'], ['item_type', 'Type'], ['title', 'Title'], ['status', 'Status'], ['created_by_label', 'Created by'], ['updated_at', 'Updated']];
const ITEM_COLUMNS = {
  module_id: { type: 'text' },
  item_type: { type: 'text' },
  title: { type: 'text' },
  status: { type: 'text' },
  created_by_label: { type: 'text' },
  updated_at: { type: 'date' }
};

function ItemsPanel({ coreApi, project }) {
  const table = useSortedRowsSafe(coreApi, project.items, ITEM_COLUMNS, { rememberAs: 'science.project.items', defaultSort: { column: 'updated_at', direction: 'desc' } });
  if (!project.items.length) return <div style={ui.empty}>Nothing has been run or recorded in this project yet. Other modules add their jobs here.</div>;
  return (
    <div style={ui.wrapper}>
      <table style={ui.table}>
        <thead style={ui.thead}><tr>{sortHeaders(coreApi, table, ITEM_HEADERS, ui.th)}</tr></thead>
        <tbody>{table.rows.map((i) => <ItemRow key={i.id} coreApi={coreApi} item={i} />)}</tbody>
      </table>
    </div>
  );
}

function OverviewPanel({ coreApi, project, reload }) {
  const { api } = coreApi;
  const [draft, setDraft, resetDraft] = usePageStateSafe(coreApi, `science.project:${project.id}.editDraft`, null,
    (d) => d === null || (d && typeof d.title === 'string' && typeof d.description === 'string'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function save(body, done) {
    setSaving(true);
    setError('');
    api.put(`/science/projects/${project.id}`, body)
      .then(() => { if (done) done(); reload(); })
      .catch((err) => setError(errorText(err)))
      .finally(() => setSaving(false));
  }

  return (
    <div>
      {error && <div style={ui.error}>{error}</div>}
      {draft === null ? (
        <div>
          <h3 style={{ margin: '0 0 8px' }}>{project.title}</h3>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', marginBottom: '12px' }}>{project.description || <span style={{ color: '#999', fontStyle: 'italic' }}>No description.</span>}</div>
          {project.can_manage && <button style={ui.button()} onClick={() => setDraft({ title: project.title, description: project.description || '' })}>Edit</button>}
          {project.can_manage && (
            <button style={{ ...ui.button(project.archived ? '#28a745' : '#6c757d'), marginLeft: '6px' }} disabled={saving} onClick={() => save({ archived: !project.archived })}>
              {project.archived ? 'Restore from archive' : 'Archive'}
            </button>
          )}
        </div>
      ) : (
        <div>
          <label style={ui.label}>Title</label>
          <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box' }} maxLength={255} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <label style={ui.label}>Description</label>
          <textarea style={ui.textarea} rows={5} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <div style={{ marginTop: '10px' }}>
            <button style={ui.button('#28a745')} disabled={saving || !draft.title.trim()} onClick={() => save({ title: draft.title, description: draft.description }, resetDraft)}>{saving ? 'Saving...' : 'Save'}</button>
            <button style={{ ...ui.button('#6c757d'), marginLeft: '6px' }} onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      )}
      <table style={{ ...ui.table, marginTop: '20px', maxWidth: '640px' }}>
        <tbody>
          {[
            ['Number', project.number],
            ['Owner', project.owner.label],
            ['Folder', project.folder_path || 'Not set (the administrator has not configured a data folder)'],
            ['Created', project.created_at ? new Date(project.created_at).toLocaleString() : '']
          ].map(([k, v]) => (
            <tr key={k}><td style={{ ...ui.td, color: '#666', width: '120px' }}>{k}</td><td style={ui.td}>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectPage({ coreApi, projectId, onBack }) {
  const { api } = coreApi;
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = usePageStateSafe(coreApi, 'science.project.tab', 'overview', SUBTABS.map((t) => t[0]));

  // The parent passes a fresh onBack every render; keep it in a ref so it never retriggers the load.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const load = useCallback(() => {
    api.get(`/science/projects/${projectId}`)
      .then((res) => { setProject(res.data); setError(''); })
      .catch((err) => {
        // Deleted, or the user lost access: forget the saved selection and show the list again.
        if (err && err.response && err.response.status === 404) onBackRef.current();
        else setError(errorText(err));
      });
  }, [api, projectId]);
  useEffect(load, [load]);

  if (error) return <div><button style={ui.linkButton} onClick={onBack}>&larr; Projects</button><div style={ui.error}>{error}</div></div>;
  if (!project) return <div style={ui.loading}>Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <button style={ui.linkButton} onClick={onBack}>&larr; Projects</button>
        <h2 style={{ margin: '8px 0 0', fontSize: '16px' }}>
          {project.number} &middot; {project.title}
          <span style={{ ...ui.chip(ACCESS_COLORS[project.access]), marginLeft: '10px' }}>{ACCESS_LABELS[project.access]}</span>
          {project.archived && <span style={ui.chip('#999')}>archived</span>}
        </h2>
        {!project.can_write && <div style={ui.hint}>You can view this project but not add to it.</div>}
      </div>
      <div style={{ ...ui.tabBar, marginBottom: '16px' }}>
        {SUBTABS.map(([key, label]) => <div key={key} style={ui.tab(tab === key)} onClick={() => setTab(key)}>{label}</div>)}
      </div>
      {tab === 'overview' && <OverviewPanel coreApi={coreApi} project={project} reload={load} />}
      {tab === 'items' && <ItemsPanel coreApi={coreApi} project={project} />}
      {tab === 'materials' && <ProjectMaterialsPanel coreApi={coreApi} project={project} reload={load} />}
      {tab === 'sharing' && <SharingPanel coreApi={coreApi} project={project} reload={load} />}
    </div>
  );
}

export default ProjectPage;
