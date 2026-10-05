// ハッシュルーター（#/、#/track/daily、#/result、#/gallery/free ...）
const routes = new Map();
let current = null;
let token = 0;

export function route(name, screen) { routes.set(name, screen); }

export function navigate(path, { replace = false } = {}) {
  const h = `#/${path}`;
  if (location.hash === h) { render(); return; }
  if (replace) { history.replaceState(null, '', h); render(); } else { location.hash = h; }
}

export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name = '', ...params] = raw.split('/').map(decodeURIComponent);
  return { name, params };
}

export async function render() {
  const my = ++token;
  const { name, params } = currentRoute();
  const screen = routes.get(name) || routes.get('');
  if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
  current = null;
  const el = document.getElementById('screen');
  el.replaceChildren();
  el.className = '';
  window.scrollTo(0, 0);
  const inst = await screen.mount(el, params);
  if (my !== token) { if (inst && inst.unmount) inst.unmount(); return; }
  current = inst || null;
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
