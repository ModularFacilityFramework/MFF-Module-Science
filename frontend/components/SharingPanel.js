// Sharing: who can open a project. Same picking style as core's user/group
// selection - a user or a group, read by default, raised to write on request.
// Only the owner, administrators and developers can change anything here; the
// backend enforces it, the controls are just hidden for everyone else.
import React, { useEffect, useMemo, useState } from 'react';
import { ui, ACCESS_COLORS, ACCESS_LABELS, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';

function SharingPanel({ coreApi, project, reload }) {
  const { api } = coreApi;
  const base = `/science/projects/${project.id}`;
  const [targets, setTargets] = useState({ users: [], groups: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [type, setType] = usePageStateSafe(coreApi, `science.project:${project.id}.shareType`, 'user', ['user', 'group']);
  const [search, setSearch] = usePageStateSafe(coreApi, `science.project:${project.id}.shareSearch`, '', (v) => typeof v === 'string');
  const [pick, setPick] = useState('');
  const [level, setLevel] = useState('read');
  const [newOwner, setNewOwner] = useState('');

  useEffect(() => {
    if (!project.can_manage) return;
    api.get('/science/share-targets').then((res) => setTargets(res.data)).catch((err) => setError(errorText(err)));
  }, [api, project.can_manage]);

  const taken = useMemo(() => new Set(project.members.map((m) => `${m.member_type}:${m.member_id}`)), [project.members]);
  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
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

  const add = () => run(api.post(`${base}/members`, { member_type: type, member_id: Number(pick), access: level }).then(() => setPick('')));
  const setAccess = (m, access) => run(api.put(`${base}/members/${m.id}`, { access }));
  const remove = (m) => run(api.delete(`${base}/members/${m.id}`));
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
            <thead style={ui.thead}><tr><th style={ui.th}>Name</th><th style={ui.th}>Type</th><th style={ui.th}>Access</th>{project.can_manage && <th style={ui.th} />}</tr></thead>
            <tbody>
              {project.members.map((m) => (
                <tr key={m.id}>
                  <td style={ui.td}>{m.label}</td>
                  <td style={ui.td}>{m.member_type === 'group' ? 'Group' : 'User'}</td>
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
            </select>
            <input style={ui.input} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select style={{ ...ui.input, minWidth: '240px' }} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{options.length ? 'Choose...' : 'Nobody left to add'}</option>
              {options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select style={ui.input} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="read">Read</option>
              <option value="write">Write (can run jobs)</option>
            </select>
            <button style={ui.button('#28a745')} disabled={busy || !pick} onClick={add}>Add</button>
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
