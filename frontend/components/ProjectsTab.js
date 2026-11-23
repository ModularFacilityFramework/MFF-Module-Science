// The Projects tab: the list of projects the user can reach, and the project page.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ProjectPage from './ProjectPage';
import { ui, ACCESS_COLORS, ACCESS_LABELS, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';

const SCOPES = [
  ['all', 'All I can see'],
  ['mine', 'My projects'],
  ['shared', 'Shared with me']
];
const SORT_KEYS = ['number', 'title', 'owner_label', 'item_count', 'updated_at'];
const validSort = (s) => s && typeof s === 'object' && SORT_KEYS.includes(s.key) && (s.dir === 'asc' || s.dir === 'desc');
const validDraft = (d) => d === null || (d && typeof d === 'object' && typeof d.title === 'string' && typeof d.description === 'string');

function ProjectList({ coreApi, onOpen }) {
  const { api } = coreApi;
  const [scope, setScope] = usePageStateSafe(coreApi, 'science.projects.scope', 'all', SCOPES.map((s) => s[0]));
  const [search, setSearch] = usePageStateSafe(coreApi, 'science.projects.search', '', (v) => typeof v === 'string');
  const [archived, setArchived] = usePageStateSafe(coreApi, 'science.projects.archived', false, (v) => typeof v === 'boolean');
  const [sort, setSort] = usePageStateSafe(coreApi, 'science.projects.sort', { key: 'updated_at', dir: 'desc' }, validSort);
  const [draft, setDraft, resetDraft] = usePageStateSafe(coreApi, 'science.projects.draft', null, validDraft);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.get('/science/projects', { params: { scope, archived: archived ? 1 : 0 } })
      .then((res) => setProjects(res.data))
      .catch((err) => { setError(errorText(err)); setProjects([]); });
  }, [api, scope, archived]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = (projects || []).filter((p) => !needle || `${p.number} ${p.title} ${p.owner_label}`.toLowerCase().includes(needle));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').toLowerCase().localeCompare(String(y ?? '').toLowerCase());
      return cmp * dir;
    });
  }, [projects, search, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  function create() {
    setSaving(true);
    setError('');
    api.post('/science/projects', { title: draft.title, description: draft.description })
      .then((res) => { resetDraft(); onOpen(res.data.id); })
      .catch((err) => setError(errorText(err)))
      .finally(() => setSaving(false));
  }

  return (
    <div>
      <div style={ui.toolbar}>
        <select style={ui.input} value={scope} onChange={(e) => setScope(e.target.value)}>
          {SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input style={{ ...ui.input, minWidth: '220px' }} placeholder="Search number, title or owner" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={ui.meta}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        <span style={{ flex: 1 }} />
        {draft === null && <button style={ui.button('#28a745')} onClick={() => setDraft({ title: '', description: '' })}>+ New project</button>}
      </div>

      {draft !== null && (
        <div style={{ ...ui.wrapper, padding: '12px', marginBottom: '16px', overflow: 'visible' }}>
          <strong style={{ fontSize: '13px' }}>New project</strong>
          <label style={ui.label}>Title</label>
          <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box' }} value={draft.title} maxLength={255} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <label style={ui.label}>Description (optional)</label>
          <textarea style={ui.textarea} rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <div style={{ marginTop: '10px' }}>
            <button style={ui.button('#28a745')} disabled={saving || !draft.title.trim()} onClick={create}>{saving ? 'Creating...' : 'Create'}</button>
            <button style={{ ...ui.button('#6c757d'), marginLeft: '6px' }} onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={ui.error}>{error}</div>}
      {projects === null ? (
        <div style={ui.loading}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={ui.empty}>No projects to show.</div>
      ) : (
        <div style={ui.wrapper}>
          <table style={ui.table}>
            <thead style={ui.thead}>
              <tr>
                {[['number', 'Number'], ['title', 'Title'], ['owner_label', 'Owner'], ['item_count', 'Items'], ['updated_at', 'Updated']].map(([k, label]) => (
                  <th key={k} style={{ ...ui.th, cursor: 'pointer' }} onClick={() => toggleSort(k)}>{label}{arrow(k)}</th>
                ))}
                <th style={ui.th}>Your access</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={p.archived ? ui.greyedRow : undefined}>
                  <td style={ui.td}>{p.number}</td>
                  <td style={ui.td}><button style={ui.linkButton} onClick={() => onOpen(p.id)}>{p.title}</button>{p.archived && <span style={ui.chip('#999')}>archived</span>}</td>
                  <td style={ui.td}>{p.owner_label}</td>
                  <td style={ui.td}>{p.item_count}</td>
                  <td style={ui.td}>{p.updated_at ? new Date(p.updated_at).toLocaleString() : ''}</td>
                  <td style={ui.td}><span style={ui.chip(ACCESS_COLORS[p.access])}>{ACCESS_LABELS[p.access]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProjectsTab({ coreApi }) {
  // The open project survives leaving the tab and a reload. If it was deleted or
  // the user lost access, ProjectPage reports it missing and we fall back to the list.
  const [selected, setSelected] = usePageStateSafe(coreApi, 'science.projects.selected', null, (v) => v === null || Number.isInteger(v));
  if (selected !== null) {
    return <ProjectPage key={selected} coreApi={coreApi} projectId={selected} onBack={() => setSelected(null)} />;
  }
  return <ProjectList coreApi={coreApi} onOpen={setSelected} />;
}

export default ProjectsTab;
