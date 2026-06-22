export function joinPublicPath(baseUrl = '/', pathname = '') {
  const base = String(baseUrl || '/');
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = String(pathname || '').replace(/^\/+/, '');
  return `${normalizedBase}${cleanPath}`;
}

export function canRegisterServiceWorker({
  navigatorObject = globalThis.navigator,
  locationObject = globalThis.location,
} = {}) {
  const protocol = String(locationObject?.protocol || '');
  const hostname = String(locationObject?.hostname || '');

  return (
    Boolean(navigatorObject?.serviceWorker) &&
    (protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
  );
}

export async function registerAppShellServiceWorker({
  navigatorObject = globalThis.navigator,
  locationObject = globalThis.location,
  baseUrl = import.meta.env?.BASE_URL || '/',
  onUpdate,
} = {}) {
  if (!canRegisterServiceWorker({ navigatorObject, locationObject })) {
    return {
      registered: false,
      reason: 'unsupported',
    };
  }

  const serviceWorker = navigatorObject.serviceWorker;
  const registration = await serviceWorker.register(joinPublicPath(baseUrl, 'sw.js'), {
    scope: joinPublicPath(baseUrl),
  });

  registration.addEventListener?.('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener?.('statechange', () => {
      if (worker.state === 'installed' && serviceWorker.controller) {
        onUpdate?.(registration);
      }
    });
  });

  return {
    registered: true,
    registration,
  };
}
