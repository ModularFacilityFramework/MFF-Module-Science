// Table sorting is core's (coreApi.useSortedRows + coreApi.ui.SortHeader, see
// "Sortable tables" in docs/MFF-Core_module-core-api.md). Every table with
// column headers in this module uses these two wrappers; the module has no
// sorting of its own. On a core older than 0.1.223 the rows stay in the order
// the server sent them and the headers have no buttons. Whether core offers the
// hook is fixed for the whole session, so the hook order never changes.
import React from 'react';

export function useSortedRowsSafe(coreApi, rows, columns, options) {
  if (typeof coreApi.useSortedRows === 'function') return coreApi.useSortedRows(rows, columns, options);
  return { rows, sort: null, columns, toggle: () => {} };
}

// columns: [[key, header text], ...]. Returns the <th> cells of one header row.
export function sortHeaders(coreApi, table, columns, style) {
  const SortHeader = coreApi.ui && coreApi.ui.SortHeader;
  return columns.map(([key, label]) => (
    SortHeader && typeof coreApi.useSortedRows === 'function'
      ? <SortHeader key={key} table={table} column={key} label={label} style={style}>{label}</SortHeader>
      : <th key={key} style={style}>{label}</th>
  ));
}
