// Inline styles matching core's own pages (docs/MFF-Core_module-ui-guide.md).
// No UI library on purpose.
export const ui = {
  tabBar: { display: 'flex', borderBottom: '1px solid #dee2e6', marginBottom: '20px', backgroundColor: '#f8f9fa' },
  tab: (active) => ({
    padding: '10px 20px',
    cursor: 'pointer',
    backgroundColor: active ? '#ffffff' : 'transparent',
    borderBottom: active ? '2px solid #007bff' : 'none',
    fontWeight: active ? 'bold' : 'normal',
    border: active ? '1px solid #dee2e6' : 'none',
    fontSize: '13px'
  }),
  panel: { backgroundColor: '#ffffff', padding: '20px', border: '1px solid #dee2e6', borderRadius: '0 0 4px 4px' },
  wrapper: { border: '1px solid #ddd', borderRadius: '4px', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { backgroundColor: '#f8f9fa' },
  th: { padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: '13px' },
  td: { padding: '12px', textAlign: 'left', borderBottom: '1px solid #eee', fontSize: '13px' },
  loading: { textAlign: 'center', padding: '20px' },
  error: { textAlign: 'center', padding: '12px', color: 'red', backgroundColor: '#ffeeee', borderRadius: '4px', margin: '10px 0', fontSize: '13px' },
  empty: { padding: '20px', color: '#999', fontStyle: 'italic', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' },
  hint: { fontSize: '12px', color: '#856404', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', padding: '8px 12px', display: 'inline-block', marginBottom: '12px' },
  toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' },
  input: { padding: '5px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' },
  textarea: { padding: '5px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  label: { display: 'block', fontSize: '12px', color: '#666', margin: '10px 0 3px' },
  button: (color = '#007bff') => ({ padding: '4px 10px', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', backgroundColor: color }),
  chip: (color = '#6c757d') => ({ display: 'inline-block', padding: '2px 6px', margin: '1px 3px 1px 0', borderRadius: '3px', fontSize: '11px', color: 'white', backgroundColor: color }),
  meta: { color: '#666', fontSize: '12px' },
  greyedRow: { opacity: 0.5 },
  linkButton: { background: 'none', border: 'none', padding: 0, color: '#007bff', cursor: 'pointer', fontSize: '13px', textAlign: 'left' }
};

export const ACCESS_COLORS = { owner: '#007bff', admin: '#007bff', write: '#28a745', read: '#6c757d' };
export const ACCESS_LABELS = { owner: 'Owner', admin: 'Admin', write: 'Write', read: 'Read' };

export function errorText(err) {
  return (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || 'Something went wrong';
}
