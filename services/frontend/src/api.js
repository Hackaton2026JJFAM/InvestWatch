// Cienki klient REST. Frontend nie odwołuje się do bazy – wyłącznie do /api.
// Akcje administracyjne: przy 401 {auth:'admin'} pokazuje okno logowania i ponawia żądanie raz.
let loginHandler = null;
let isAdmin = false;
export const setLoginHandler = (fn) => { loginHandler = fn; };
export const setAdminState = (value) => { isAdmin = Boolean(value); };

// Akcje administracyjne – okno logowania przed wysłaniem (bez zbędnego 401 w konsoli)
const ADMIN_ACTION = /^(PATCH \/settings|(POST|PATCH|DELETE) \/sources|POST \/seed|DELETE \/materials\/)/;

async function request(method, path, body, retried = false) {
  if (!isAdmin && !retried && loginHandler && ADMIN_ACTION.test(`${method} ${path}`)) {
    if (!(await loginHandler())) throw Object.assign(new Error('Anulowano logowanie administratora'), { auth: 'cancelled' });
    retried = true;
  }
  try {
    return await rawRequest(method, path, body);
  } catch (err) {
    if (err.auth === 'admin' && !retried && loginHandler && !path.startsWith('/auth/')) {
      if (await loginHandler()) return request(method, path, body, true);
    }
    throw err;
  }
}

async function rawRequest(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok && data === null) {
    // np. strona HTML z proxy zamiast JSON – zgłaszamy błąd zamiast pustego obiektu
    throw new Error(`Nieprawidłowa odpowiedź serwera (${res.status}, ${res.headers.get('content-type') || 'brak typu'})`);
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.details = data?.details;
    err.auth = data?.auth;
    throw err;
  }
  return data;
}

// Surowy plik (np. wideo) w treści żądania; metadane w parametrach zapytania.
export async function uploadFile(path, file, params = {}) {
  const res = await fetch(`/api${path}${qs(params)}`, {
    method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => v !== undefined && v !== '' && v !== null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
