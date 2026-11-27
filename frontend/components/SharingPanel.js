// Sharing: who can open a project. Same picking style as core's user/group
// selection - a user or a group, read by default, raised to write on request.
// Only the owner, administrators and developers can change anything here; the
// backend enforces it, the controls are just hidden for everyone else.
import React, { useEffect, useMemo, useState } from 'react';
import { ui, ACCESS_COLORS, ACCESS_LABELS, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';
import { useSortedRowsSafe, sortHeaders } from '../lib/sorting';

const TYPE_LABELS = { user: 'User', group: 'Group', everyone: 'Everyone' };
const HEADERS = [['label', 'Name'], ['member_type', 'Type'], ['access', 'Access']];
const COLUMNS = {
  label: { type: 'text' },
  member_type: { value: (m) => TYPE_LABELS[m.member_type], type: 'text' },
  access: { value: (m) => ACCESS_LABELS[m.access], type: 'text' }
};

const NAMES_SHOWN = 5;
function strandedWarning(people, question) {
  const more = people.length - NAMES_SHOWN;
  const names = people.slice(0, NAMES_SHOWN).join(', ') + (more > 0 ? ` and ${more} more` : '');
  return `This leaves ${names} without a project. They will have to ask for one before they can run or record project work.\n\n${question}`;
}

function SharingPanel({ coreApi, project, reload }) {
  const { api } = coreApi;
  const base = `/science/projects/${project.id}`;
  const [targets, setTargets] = useState({ users: [], groups: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedType, setType] = usePageStateSafe(coreApi, `science.project:${project.id}.shareType`, 'user', ['user', 'group', 'everyone']);
  // "Everyone" is offered on the Project template only, while it is not already shared that way.
  const canAddEveryone = project.is_template && !project.members.some((m) => m.member_type === 'everyone');
  const type = savedType === 'everyone' && !canAddEveryone ? 'user' : savedType;
  const everyone = type === 'everyone';
  const [search, setSearch] = usePageStateSafe(coreApi, `science.project:${project.id}.shareSearch`, '', (v) => typeof v === 'string');
  const [pick, setPick] = useState('');
  const [level, setLevel] = useState('read');
  const [newOwner, setNewOwner] = useState('');
  const table = useSortedRowsSafe(coreApi, project.members, COLUMNS, { rememberAs: 'science.project.members', defaultSort: { column: 'label', direction: 'asc' } });

  useEffect(() => {
    if (!project.can_manage) return;
    api.get('/science/share-targets').then((res) => setTargets(res.data)).catch((err) => setError(errorText(err)));
  }, [api, project.can_manage]);

  const taken = useMemo(() => new Set(project.members.map((m) => `${m.member_type}:${m.member_id}`)), [project.members]);
  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (type === 'everyone') return [];
    const list = type === 'user' ? targets.users.filter((u) => u.id !== project.owner.id) : targets.groups;
    return list.filter((t) => !taken.has(`${type}:${t.id}`) && (!needle || t.label.toLowerCase().includes(needle)));
  }, [targets, type, search, taken, project.owner.id]);

  function run(request) {
    setBusy(true);
    setError('');
    return request
      .then(reload)
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  const add = () => run(api.post(`${base}/members`, { member_type: type, member_id: everyone ? undefined : Number(pick), access: level }).then(() => setPick('')));
  // Removing a share, or lowering it to read, is always allowed; if it leaves someone with
  // no project, say who before doing it.
  function afterWarning(m, access, question, request) {
    setBusy(true);
    setError('');
    api.get(`${base}/members/${m.id}/impact`, { params: { access } })
      .then(
        (res) => !res.data.without_project.length || window.confirm(strandedWarning(res.data.without_project, question)),
        () => window.confirm(`Could not check whether this leaves someone without a project. ${question}`)
      )
      .then((go) => (go ? run(request()) : setBusy(false)));
  }
  const setAccess = (m, access) => {
    const request = () => api.put(`${base}/members/${m.id}`, { access });
    if (m.access === 'write' && access === 'read') afterWarning(m, 'read', 'Change to read anyway?', request);
    else run(request());
  };
  const remove = (m) => afterWarning(m, 'none', 'Remove anyway?', () => api.delete(`${base}/members/${m.id}`));
  function handOver() {
    const target = targets.users.find((u) => u.id === Number(newOwner));
    if (!target || !window.confirm(`Hand ${project.number} over to ${target.label}? You stay on the project as a write member.`)) return;
    run(api.post(`${base}/transfer`, { user_id: target.id }).then(() => setNewOwner('')));
  }

  return (
    <div>
      {error && <div style={ui.error}>{error}</div>}
      {!project.can_manage && <div style={ui.hint}>Only the owner, administrators and developers can change who this project is shared with.</div>}
      <p style={{ fontSize: '13px', color: '#666' }}>
        Owner: <strong>{project.owner.label}</strong>. Administrators and developers can always see and manage every project. Access adds up: if someone is shared directly and through a group, the higher level applies.
      </p>

      {project.members.length === 0 ? (
        <div style={ui.empty}>Not shared with anyone yet.</div>
      ) : (
        <div style={ui.wrapper}>
          <table style={ui.table}>
            <thead style={ui.thead}><tr>{sortHeaders(coreApi, table, HEADERS, ui.th)}{project.can_manage && <th style={ui.th} />}</tr></thead>
            <tbody>
              {table.rows.map((m) => (
                <tr key={m.id}>
                  <td style={ui.td}>{m.label}</td>
                  <td style={ui.td}>{TYPE_LABELS[m.member_type]}</td>
                  <td style={ui.td}>
                    {project.can_manage ? (
                      <select style={ui.input} value={m.access} disabled={busy} onChange={(e) => setAccess(m, e.target.value)}>
                        <option value="read">Read</option>
                        <option value="write">Write (can run jobs)</option>
                      </select>
                    ) : <span style={ui.chip(ACCESS_COLORS[m.access])}>{ACCESS_LABELS[m.access]}</span>}
                  </td>
                  {project.can_manage && <td style={ui.td}><button style={ui.button('#dc3545')} disabled={busy} onClick={() => remove(m)}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {project.can_manage && (
        <div style={{ marginTop: '20px' }}>
          <strong style={{ fontSize: '13px' }}>Share with</strong>
          <div style={{ ...ui.toolbar, marginTop: '8px' }}>
            <select style={ui.input} value={type} onChange={(e) => { setType(e.target.value); setPick(''); }}>
              <option value="user">A user</option>
              <option value="group">A group</option>
              {canAddEveryone && <option value="everyone">Everyone</option>}
            </select>
            {!everyone && <input style={ui.input} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />}
            {!everyone && (
              <select style={{ ...ui.input, minWidth: '240px' }} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{options.length ? 'Choose...' : 'Nobody left to add'}</option>
                {options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
            <select style={ui.input} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="read">Read</option>
              <option value="write">Write (can run jobs)</option>
            </select>
            <button style={ui.button('#28a745')} disabled={busy || (!everyone && !pick)} onClick={add}>Add</button>
          </div>

          <div style={{ marginTop: '24px' }}>
            <strong style={{ fontSize: '13px' }}>Hand the project over</strong>
            <div style={{ ...ui.toolbar, marginTop: '8px' }}>
              <select style={{ ...ui.input, minWidth: '240px' }} value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                <option value="">New owner...</option>
                {targets.users.filter((u) => u.id !== project.owner.id).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
              <button style={ui.button('#dc3545')} disabled={busy || !newOwner} onClick={handOver}>Hand over</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SharingPanel;
