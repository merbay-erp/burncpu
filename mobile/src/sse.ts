// Minimal Server-Sent Events client over XMLHttpRequest — React Native core, so
// no native module. Cookies are sent from the native jar (withCredentials), the
// same session fetch uses. Best-effort: one auto-reconnect on drop. Returns a
// close() function. Used for the DM typing indicator (/notifications/stream).

import { API_ORIGIN } from './api';

export function openEventStream(path: string, onEvent: (data: unknown) => void): () => void {
  let xhr: XMLHttpRequest | null = null;
  let closed = false;
  let retried = false;

  const connect = () => {
    if (closed) return;
    const req = new XMLHttpRequest();
    xhr = req;
    let buffer = '';
    let offset = 0;

    req.open('GET', `${API_ORIGIN}/api/v1${path}`);
    req.setRequestHeader('Accept', 'text/event-stream');
    req.withCredentials = true;

    req.onreadystatechange = () => {
      if (closed || req !== xhr) return;
      if (req.readyState === 3 || req.readyState === 4) {
        buffer += req.responseText.slice(offset);
        offset = req.responseText.length;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) {
            try {
              onEvent(JSON.parse(data));
            } catch {
              /* non-JSON keepalive */
            }
          }
        }
        if (req.readyState === 4 && !closed && !retried) {
          retried = true;
          setTimeout(connect, 1500);
        }
      }
    };
    req.onerror = () => {
      if (!closed && !retried) {
        retried = true;
        setTimeout(connect, 1500);
      }
    };
    try {
      req.send();
    } catch {
      /* ignore */
    }
  };

  connect();
  return () => {
    closed = true;
    try {
      xhr?.abort();
    } catch {
      /* ignore */
    }
  };
}
