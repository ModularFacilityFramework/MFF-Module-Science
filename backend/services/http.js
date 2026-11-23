// Small shared helpers for the route files: an HTTP error type, a handler
// wrapper that owns the DB connection, and input cleaning.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a route body: hands it a pooled connection, releases it, and turns a
// thrown HttpError into its status. Anything else is logged and answered 500
// without leaking the message.
function route(pool, fn) {
  return async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await fn(req, res, conn);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(`[science] ${req.method} ${req.originalUrl} failed:`, err);
        res.status(500).json({ error: 'Internal error' });
      }
    } finally {
      conn.release();
    }
  };
}

// Trims a string field. Throws 400 when required and empty, or too long.
function cleanString(value, { max, required = false, field = 'value' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const v = value.trim();
  if (!v) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (max && v.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return v;
}

function parseId(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} is invalid`);
  return n;
}

// Link stored with an item: an in-app path only, never a full URL, so a module
// cannot plant a javascript: or off-site link in another user's project page.
function cleanLink(value) {
  const v = cleanString(value, { max: 512, field: 'link' });
  if (v === null) return null;
  if (!v.startsWith('/') || v.startsWith('//') || /[\s\\]/.test(v)) throw new HttpError(400, 'link must be an in-app path starting with a single "/"');
  return v;
}

module.exports = { HttpError, route, cleanString, parseId, cleanLink };
