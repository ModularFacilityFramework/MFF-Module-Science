// The proteins, complexes and ligands linked to one project. One record can be
// in many projects. Anyone with write access links or unlinks; a private
// material can only be linked into projects owned by its own owner.
import React, { useEffect, useState } from 'react';
import { ui, errorText } from '../lib/ui';
import { useSortedRowsSafe, sortHeaders } from '../lib/sorting';

export const KIND_LABELS = { protein: 'Protein', complex: 'Complex', ligand: 'Ligand' };
const HEADERS = [['kind', 'Kind'], ['name', 'Name'], ['uniprot_id', 'UniProt'], ['owner_label', 'Owner'], ['visibility', 'Visibility']];
const COLUMNS = {
  kind: { value: (m) => KIND_LABELS[m.kind], type: 'text' },
  name: { type: 'text' },
  uniprot_id: { type: 'text' },
  owner_label: { type: 'text' },
  visibility: { type: 'text' }
};

function ProjectMaterialsPanel({ coreApi, project, reload }) {
  const { api } = coreApi;
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const table = useSortedRowsSafe(coreApi, project.materials, COLUMNS, { rememberAs: 'science.project.materials', defaultSort: { column: 'name', direction: 'asc' } });

  useEffect(() => {
    if (!project.can_write) return;
    api.get('/science/materials', { params: { linkable_project: project.id } })
      .then((res) => setCandidates(res.data))
      .catch((err) => setError(errorText(err)));
  }, [api, project.id, project.can_write, project.materials]);

  function run(request) {
    setBusy(true);
    setError('');
    return request.then(reload).catch((err) => setError(errorText(err))).finally(() => setBusy(false));
  }

  return (
    <div>
      {error && <div style={ui.error}>{error}</div>}
      {project.materials.length === 0 ? (
        <div style={ui.empty}>No proteins, complexes or ligands in this project yet.</div>
      ) : (
        <div style={ui.wrapper}>
          <table style={ui.table}>
            <thead style={ui.thead}><tr>{sortHeaders(coreApi, table, HEADERS, ui.th)}{project.can_write && <th style={ui.th} />}</tr></thead>
            <tbody>
              {table.rows.map((m) => (
                <tr key={m.id}>
                  <td style={ui.td}>{KIND_LABELS[m.kind]}</td>
                  <td style={ui.td}>{m.name}</td>
                  <td style={ui.td}>{m.uniprot_id || ''}</td>
                  <td style={ui.td}>{m.owner_label}</td>
                  <td style={ui.td}><span style={ui.chip(m.visibility === 'public' ? '#17a2b8' : '#6c757d')}>{m.visibility}</span></td>
                  {project.can_write && <td style={ui.td}><button style={ui.button('#dc3545')} disabled={busy} onClick={() => run(api.delete(`/science/projects/${project.id}/materials/${m.id}`))}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {project.can_write && (
        <div style={{ ...ui.toolbar, marginTop: '16px' }}>
          <select style={{ ...ui.input, minWidth: '300px' }} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{candidates.length ? 'Add an existing record...' : 'No other records available - create one in the Materials tab'}</option>
            {candidates.map((m) => <option key={m.id} value={m.id}>{KIND_LABELS[m.kind]}: {m.name} ({m.owner_label}, {m.visibility})</option>)}
          </select>
          <button style={ui.button('#28a745')} disabled={busy || !pick} onClick={() => run(api.post(`/science/projects/${project.id}/materials`, { material_id: Number(pick) }).then(() => setPick('')))}>Add to project</button>
        </div>
      )}
    </div>
  );
}

export default ProjectMaterialsPanel;
