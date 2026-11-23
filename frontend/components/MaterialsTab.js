// The Materials tab: proteins, complexes (e.g. ribosomes) and ligands. Every
// record has an owner and is private or public. Public: other users can find it
// and link it into their own projects. Private: only usable in its owner's
// projects, so others create their own record.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ui, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';
import { KIND_LABELS } from './ProjectMaterialsPanel';

const KINDS = ['protein', 'complex', 'ligand'];
const SCOPES = [['visible', 'All I can see'], ['mine', 'Mine'], ['public', 'Public']];
const EMPTY = { id: null, kind: 'protein', name: '', description: '', sequence: '', uniprot_id: '', smiles: '', visibility: 'private' };
const validForm = (f) => f === null || (f && typeof f === 'object' && KINDS.includes(f.kind) && typeof f.name === 'string');

function MaterialForm({ form, setForm, onSave, onCancel, saving }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ ...ui.wrapper, padding: '12px', marginBottom: '16px', overflow: 'visible' }}>
      <strong style={{ fontSize: '13px' }}>{form.id ? 'Edit' : 'New'} {KIND_LABELS[form.kind].toLowerCase()}</strong>
      {!form.id && (
        <div>
          <label style={ui.label}>Kind</label>
          <select style={ui.input} value={form.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select>
        </div>
      )}
      <label style={ui.label}>Name</label>
      <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box' }} maxLength={255} value={form.name} onChange={set('name')} />
      {form.kind === 'protein' && (
        <div>
          <label style={ui.label}>UniProt ID (optional)</label>
          <input style={ui.input} maxLength={40} value={form.uniprot_id} onChange={set('uniprot_id')} />
        </div>
      )}
      {form.kind !== 'ligand' && (
        <div>
          <label style={ui.label}>Sequence (optional)</label>
          <textarea style={{ ...ui.textarea, fontFamily: 'monospace' }} rows={4} value={form.sequence} onChange={set('sequence')} />
        </div>
      )}
      {form.kind === 'ligand' && (
        <div>
          <label style={ui.label}>SMILES (optional)</label>
          <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} value={form.smiles} onChange={set('smiles')} />
        </div>
      )}
      <label style={ui.label}>Description (optional){form.kind === 'complex' ? ' - e.g. which components it is made of' : ''}</label>
      <textarea style={ui.textarea} rows={3} value={form.description} onChange={set('description')} />
      <label style={ui.label}>Visibility</label>
      <select style={ui.input} value={form.visibility} onChange={set('visibility')}>
        <option value="private">Private - only usable in my own projects</option>
        <option value="public">Public - others can find it and use it in their projects</option>
      </select>
      <div style={{ marginTop: '10px' }}>
        <button style={ui.button('#28a745')} disabled={saving || !form.name.trim()} onClick={onSave}>{saving ? 'Saving...' : 'Save'}</button>
        <button style={{ ...ui.button('#6c757d'), marginLeft: '6px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function MaterialsTab({ coreApi }) {
  const { api, useAuth, useRoles } = coreApi;
  const { userData } = useAuth();
  const { hasAnyRole } = useRoles(userData);
  const myId = userData && userData.user ? userData.user.id : null;
  const isStaff = hasAnyRole(['administrator', 'developer']);

  const [kind, setKind] = usePageStateSafe(coreApi, 'science.materials.kind', 'all', ['all', ...KINDS]);
  const [scope, setScope] = usePageStateSafe(coreApi, 'science.materials.scope', 'visible', SCOPES.map((s) => s[0]));
  const [search, setSearch] = usePageStateSafe(coreApi, 'science.materials.search', '', (v) => typeof v === 'string');
  const [form, setForm, resetForm] = usePageStateSafe(coreApi, 'science.materials.form', null, validForm);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const params = { scope };
    if (kind !== 'all') params.kind = kind;
    api.get('/science/materials', { params })
      .then((res) => { setRows(res.data); setError(''); })
      .catch((err) => { setError(errorText(err)); setRows([]); });
  }, [api, kind, scope]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows || []).filter((m) => !needle || `${m.name} ${m.uniprot_id || ''} ${m.owner_label}`.toLowerCase().includes(needle));
  }, [rows, search]);

  function save() {
    setSaving(true);
    setError('');
    const body = { name: form.name, description: form.description, sequence: form.sequence, uniprot_id: form.uniprot_id, smiles: form.smiles, visibility: form.visibility };
    const request = form.id ? api.put(`/science/materials/${form.id}`, body) : api.post('/science/materials', { ...body, kind: form.kind });
    request
      .then(() => { resetForm(); load(); })
      .catch((err) => setError(errorText(err)))
      .finally(() => setSaving(false));
  }

  function edit(m) {
    setForm({ id: m.id, kind: m.kind, name: m.name, description: m.description || '', sequence: m.sequence || '', uniprot_id: m.uniprot_id || '', smiles: m.smiles || '', visibility: m.visibility });
  }

  function remove(m) {
    if (!window.confirm(`Delete "${m.name}"?`)) return;
    setError('');
    api.delete(`/science/materials/${m.id}`).then(load).catch((err) => setError(errorText(err)));
  }

  const canChange = (m) => isStaff || m.owner_user_id === myId;

  return (
    <div>
      <div style={ui.toolbar}>
        <select style={ui.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}s</option>)}
        </select>
        <select style={ui.input} value={scope} onChange={(e) => setScope(e.target.value)}>
          {SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input style={{ ...ui.input, minWidth: '220px' }} placeholder="Search name, UniProt or owner" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        {form === null && <button style={ui.button('#28a745')} onClick={() => setForm({ ...EMPTY, kind: kind === 'all' ? 'protein' : kind })}>+ New record</button>}
      </div>

      {form !== null && <MaterialForm form={form} setForm={setForm} onSave={save} onCancel={resetForm} saving={saving} />}
      {error && <div style={ui.error}>{error}</div>}

      {rows === null ? (
        <div style={ui.loading}>Loading...</div>
      ) : shown.length === 0 ? (
        <div style={ui.empty}>No records to show.</div>
      ) : (
        <div style={ui.wrapper}>
          <table style={ui.table}>
            <thead style={ui.thead}><tr>{['Kind', 'Name', 'UniProt', 'Owner', 'Visibility', 'In projects', ''].map((h, i) => <th key={i} style={ui.th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td style={ui.td}>{KIND_LABELS[m.kind]}</td>
                  <td style={ui.td}>{m.name}</td>
                  <td style={ui.td}>{m.uniprot_id || ''}</td>
                  <td style={ui.td}>{m.owner_label}</td>
                  <td style={ui.td}><span style={ui.chip(m.visibility === 'public' ? '#17a2b8' : '#6c757d')}>{m.visibility}</span></td>
                  <td style={ui.td}>{m.project_count}</td>
                  <td style={ui.td}>
                    {canChange(m) && <button style={ui.button()} onClick={() => edit(m)}>Edit</button>}
                    {canChange(m) && <button style={{ ...ui.button('#dc3545'), marginLeft: '6px' }} onClick={() => remove(m)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MaterialsTab;
