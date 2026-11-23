import { useState } from 'react';

// coreApi.usePageState keeps a value per user on the server (it survives leaving
// the page, a reload and a logout). On an older core without it, fall back to
// plain useState so the module still works. Whether it exists is fixed for the
// whole session, so the hook order never changes between renders.
export function usePageStateSafe(coreApi, key, defaultValue, validate) {
  if (typeof coreApi.usePageState === 'function') return coreApi.usePageState(key, defaultValue, validate);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [value, setValue] = useState(defaultValue);
  return [value, setValue, () => setValue(defaultValue)];
}
