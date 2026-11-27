// "Request a project": the form and the person's own requests, and for approvers
// the requests to decide. The backend decides who may do what.
import React, { useCallback, useEffect, useState } from 'react';
import { ui, errorText } from '../lib/ui';
import { usePageStateSafe } from '../lib/usePageStateSafe';
import { useSortedRowsSafe, sortHeaders } from '../lib/sorting';

const STATUS_LABELS = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };
const STATUS_COLORS = { pending: '#fd7e14', approved: '#28a745', declined: '#dc3545', cancelled: '#6c757d' };
const FILTERS = [['pending', 'Waiting'], ['approved', 'Approved'], ['declined', 'Declined'], ['cancelled', 'Cancelled'], ['all', 'All']];
const EMPTY_DRAFT = { title: '', description: '', group_id: null, pi_user_id: null };
const validDraft = (d) => !!d && typeof d === 'object' && typeof d.title === 'string' && typeof d.description === 'string';
const validNotes = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

const date = (v) => (v ? new Date(v).toLocaleString() : '');
const status = (r) => <span style={ui.chip(STATUS_COLORS[r.status])}>{STATUS_LABELS[r.status]}</span>;

const COLUMNS = {
  requester_label: { type: 'text' },
  title: { type: 'text' },
  group_label: { type: 'text' },
  pi_label: { type: 'text' },
  created_at: { type: 'date' },
  status: { value: (r) => STATUS_LABELS[r.status], type: 'text' }
};
const MINE_HEADERS = [['title', 'Request'], ['group_label', 'Group'], ['pi_label', 'PI'], ['created_at', 'Asked'], ['status', 'Status']];
const REVIEW_HEADERS = [['requester_label', 'Asked by'], ...MINE_HEADERS];

function Title({ r }) {
  return (
    <td style={{ ...ui.td, maxWidth: '360px' }}>
      <strong>{r.title}</strong>
      <div style={{ ...ui.meta, whiteSpace: 'pre-wrap' }}>{r.description}</div>
    </td>
  );
}

function Decision({ r }) {
  if (r.status !== 'approved' && r.status !== 'declined') return null;
  return (
    <div style={ui.meta}>
      {r.decided_by_label ? `by ${r.decided_by_label}` : ''}{r.decided_at ? `, ${date(r.decided_at)}` : ''}
      {r.decision_note && <div style={{ whiteSpace: 'pre-wrap' }}>{r.decision_note}</div>}
    </div>
  );
}

function RequestForm({ coreApi, onSent }) {
  const { api } = coreApi;
  const [draft, setDraft, resetDraft] = usePageStateSafe(coreApi, 'science.requests.draft', EMPTY_DRAFT, validDraft);
  const [options, setOptions] = useState({ groups: [], pis: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const GroupPicker = coreApi.ui && coreApi.ui.GroupPicker;

  useEffect(() => {
    api.get('/science/request-options').then((res) => setOptions(res.data)).catch((err) => setError(errorText(err)));
  }, [api]);

  const set = (field, value) => setDraft({ ...draft, [field]: value });
  function send() {
    setBusy(true);
    setError('');
    api.post('/science/requests', draft)
      .then(() => { resetDraft(); onSent(); })
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ ...ui.wrapper, padding: '12px', marginBottom: '20px', overflow: 'visible', maxWidth: '720px' }}>
      <strong style={{ fontSize: '13px' }}>Request a project</strong>
      <label style={ui.label}>Title</label>
      <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box' }} maxLength={255} value={draft.title} onChange={(e) => set('title', e.target.value)} />
      <label style={ui.label}>What is it for? (a few lines)</label>
      <textarea style={ui.textarea} rows={4} maxLength={2000} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      <label style={ui.label}>Group (optional)</label>
      {GroupPicker ? (
        <GroupPicker value={draft.group_id} onChange={(id) => set('group_id', id)} />
      ) : (
        <select style={ui.input} value={draft.group_id || ''} onChange={(e) => set('group_id', Number(e.target.value) || null)}>
          <option value="">None</option>
          {options.groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      )}
      <label style={ui.label}>PI (optional)</label>
      <select style={{ ...ui.input, minWidth: '240px' }} value={draft.pi_user_id || ''} onChange={(e) => set('pi_user_id', Number(e.target.value) || null)}>
        <option value="">None</option>
        {options.pis.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {error && <div style={ui.error}>{error}</div>}
      <div style={{ marginTop: '12px' }}>
        <button style={ui.button('#28a745')} disabled={busy || !draft.title.trim() || !draft.description.trim()} onClick={send}>{busy ? 'Sending...' : 'Send request'}</button>
      </div>
    </div>
  );
}

function MyRequests({ coreApi, rows, onCancel, busy }) {
  const table = useSortedRowsSafe(coreApi, rows, COLUMNS, { rememberAs: 'science.requests.mine', defaultSort: { column: 'created_at', direction: 'desc' } });
  return (
    <div style={ui.wrapper}>
      <table style={ui.table}>
        <thead style={ui.thead}><tr>{sortHeaders(coreApi, table, MINE_HEADERS, ui.th)}<th style={ui.th} /></tr></thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.id}>
              <Title r={r} />
              <td style={ui.td}>{r.group_label || ''}</td>
              <td style={ui.td}>{r.pi_label || ''}</td>
              <td style={ui.td}>{date(r.created_at)}</td>
              <td style={ui.td}>{status(r)}{r.unseen && <span style={ui.chip('#007bff')}>new</span>}<Decision r={r} /></td>
              <td style={ui.td}>{r.status === 'pending' && <button style={ui.button('#6c757d')} disabled={busy} onClick={() => onCancel(r)}>Cancel request</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewPanel({ coreApi, onDecided }) {
  const { api } = coreApi;
  const [filter, setFilter] = usePageStateSafe(coreApi, 'science.requests.filter', 'pending', FILTERS.map((f) => f[0]));
  const [notes, setNotes] = usePageStateSafe(coreApi, 'science.requests.notes', {}, validNotes);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const table = useSortedRowsSafe(coreApi, rows || [], COLUMNS, { rememberAs: 'science.requests.review', defaultSort: { column: 'created_at', direction: 'asc' } });

  const load = useCallback(() => {
    api.get('/science/approvals', { params: { status: filter } })
      .then((res) => setRows(res.data.requests))
      .catch((err) => { setError(errorText(err)); setRows([]); });
  }, [api, filter]);
  useEffect(load, [load]);

  function decide(r, action) {
    setBusy(true);
    setError('');
    api.post(`/science/approvals/${r.id}/${action}`, { note: notes[r.id] || '' })
      .then(() => {
        const rest = { ...notes };
        delete rest[r.id];
        setNotes(rest);
        onDecided();
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => { setBusy(false); load(); });
  }

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={ui.toolbar}>
        <strong style={{ fontSize: '13px' }}>Requests to decide</strong>
        <select style={ui.input} value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <p style={ui.meta}>Approving creates the project, with the person who asked as its owner.</p>
      {error && <div style={ui.error}>{error}</div>}
      {rows === null ? (
        <div style={ui.loading}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={ui.empty}>{filter === 'pending' ? 'No request is waiting.' : 'No requests to show.'}</div>
      ) : (
        <div style={ui.wrapper}>
          <table style={ui.table}>
            <thead style={ui.thead}><tr>{sortHeaders(coreApi, table, REVIEW_HEADERS, ui.th)}<th style={ui.th}>Decision</th></tr></thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td style={ui.td}>{r.requester_label}</td>
                  <Title r={r} />
                  <td style={ui.td}>{r.group_label || ''}</td>
                  <td style={ui.td}>{r.pi_label || ''}</td>
                  <td style={ui.td}>{date(r.created_at)}</td>
                  <td style={ui.td}>{status(r)}</td>
                  <td style={ui.td}>
                    {r.status === 'pending' ? (
                      <div>
                        <input style={{ ...ui.input, minWidth: '180px' }} placeholder="Note to the person (optional)" maxLength={1000} value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                        <div style={{ marginTop: '6px' }}>
                          <button style={ui.button('#28a745')} disabled={busy} onClick={() => decide(r, 'approve')}>Approve</button>
                          <button style={{ ...ui.button('#dc3545'), marginLeft: '6px' }} disabled={busy} onClick={() => decide(r, 'decline')}>Decline</button>
                        </div>
                      </div>
                    ) : <Decision r={r} />}
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

// info: GET /science/status (kept by Dashboard); refresh() reads it again.
function RequestsTab({ coreApi, info, isApprover, refresh }) {
  const { api } = coreApi;
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reading the list is seeing the decisions: they are marked as seen, and stay
  // labelled "new" until the tab is opened again.
  const load = useCallback(() => {
    api.get('/science/requests/mine')
      .then((res) => {
        setMine(res.data);
        const ids = res.data.filter((r) => r.unseen).map((r) => r.id);
        if (ids.length) api.post('/science/requests/seen', { ids }).then(refresh).catch(() => {});
      })
      .catch((err) => { setError(errorText(err)); setMine([]); });
  }, [api, refresh]);
  useEffect(load, [load]);

  const changed = () => { load(); refresh(); };
  function cancel(r) {
    setBusy(true);
    setError('');
    api.post(`/science/requests/${r.id}/cancel`)
      .catch((err) => setError(errorText(err)))
      .finally(() => { setBusy(false); changed(); });
  }

  const waiting = !!(mine && mine.some((r) => r.status === 'pending'));
  return (
    <div>
      {isApprover && <ReviewPanel coreApi={coreApi} onDecided={changed} />}
      {error && <div style={ui.error}>{error}</div>}
      {info && info.can_request && mine !== null && !waiting && <RequestForm coreApi={coreApi} onSent={changed} />}
      {info && info.can_create && (
        <p style={ui.meta}>You can create a project yourself with "+ New project" on the Projects tab.</p>
      )}
      {mine === null ? (
        <div style={ui.loading}>Loading...</div>
      ) : mine.length > 0 && (
        <div>
          <p style={{ fontSize: '13px' }}><strong>My requests</strong></p>
          <MyRequests coreApi={coreApi} rows={mine} onCancel={cancel} busy={busy} />
        </div>
      )}
    </div>
  );
}

export default RequestsTab;
