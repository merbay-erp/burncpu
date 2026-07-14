import { performance } from 'node:perf_hooks';

const envInt = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const configuredBaseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3050';
let baseUrlObject;
try {
  baseUrlObject = new URL(configuredBaseUrl);
} catch {
  throw new Error('BASE_URL must be an absolute http(s) URL');
}
if (!['http:', 'https:'].includes(baseUrlObject.protocol)
  || baseUrlObject.pathname !== '/'
  || baseUrlObject.search
  || baseUrlObject.hash
  || baseUrlObject.username
  || baseUrlObject.password) {
  throw new Error('BASE_URL must contain only an http(s) origin (no path, query or fragment)');
}
const baseHostname = baseUrlObject.hostname.toLowerCase().replace(/\.$/, '');
if (baseHostname === 'burncpu.com' || baseHostname.endsWith('.burncpu.com')) {
  throw new Error('Refusing to generate load against burncpu.com');
}
const isLoopback = baseHostname === 'localhost'
  || baseHostname === '127.0.0.1'
  || baseHostname === '[::1]'
  || baseHostname === '::1';
const allowNonlocal = ['1', 'true', 'yes'].includes((process.env.ALLOW_NONLOCAL_BASE_URL ?? '').toLowerCase());
if (!isLoopback && !allowNonlocal) {
  throw new Error('BASE_URL must target loopback; set ALLOW_NONLOCAL_BASE_URL=true only for an isolated staging target');
}
const baseUrl = baseUrlObject.origin;
// Keep accidental local invocations from exhausting the host. The scheduled
// profile intentionally reaches the 10k SSE ceiling; larger runs belong in a
// dedicated load generator/runner rather than a developer or GitHub worker.
const httpConcurrency = envInt('HTTP_CONCURRENCY', 200, { max: 5_000 });
const httpRequests = envInt('HTTP_REQUESTS', 2_000, { max: 1_000_000 });
const sseConnections = envInt('SSE_CONNECTIONS', 1_000, { max: 10_000 });
const sseHoldMs = envInt('SSE_HOLD_MS', 5_000, { max: 3_600_000 });
const requestTimeoutMs = envInt('REQUEST_TIMEOUT_MS', 10_000, { max: 300_000 });
const sseTimeoutMs = envInt('SSE_CONNECT_TIMEOUT_MS', 45_000, { max: 300_000 });
const maxP95Ms = envInt('MAX_HTTP_P95_MS', 1_500, { max: 3_600_000 });
const maxP99Ms = envInt('MAX_HTTP_P99_MS', 5_000, { max: 3_600_000 });
const sessionCookie = process.env.SSE_COOKIE ?? 'burncpu_session=load-session-token';

const endpoints = [
  '/healthz',
  '/api/v1/posts?limit=12',
  '/api/v1/search?q=rust',
  '/sitemap.xml',
];
const maxResponseBytes = 8 * 1024 * 1024;

const percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const round = (value) => Math.round(value * 10) / 10;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function drainResponse(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    bytes += value.byteLength;
    if (bytes > maxResponseBytes) {
      await reader.cancel();
      throw new Error(`HTTP response exceeded ${maxResponseBytes} bytes`);
    }
  }
}

async function openSseConnections() {
  const controllers = Array.from({ length: sseConnections }, () => new AbortController());
  const streams = [];
  const timings = [];
  let failed = 0;

  await Promise.all(controllers.map(async (controller) => {
    const timer = setTimeout(() => controller.abort(), sseTimeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
        headers: {
          Accept: 'text/event-stream',
          Cookie: sessionCookie,
          'User-Agent': 'burncpu-load-test',
        },
        signal: controller.signal,
      });
      timings.push(performance.now() - started);
      if (
        response.status !== 200
        || !response.headers.get('content-type')?.startsWith('text/event-stream')
        || !response.body
      ) {
        failed += 1;
        controller.abort();
        return;
      }
      // Consume each body in a discard loop. This keeps the stream/socket
      // active without buffering events and lets the gate detect a server
      // that closes an SSE connection before the hold window ends.
      const reader = response.body.getReader();
      const stream = { prematurelyClosed: false };
      stream.watch = (async () => {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) {
              if (!controller.signal.aborted) stream.prematurelyClosed = true;
              return;
            }
          }
        } catch {
          // Abort at the end of the hold window is expected. Any other read
          // error means the stream was lost before the gate completed.
          if (!controller.signal.aborted) stream.prematurelyClosed = true;
        }
      })();
      streams.push(stream);
    } catch {
      failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }));

  return {
    controllers,
    streams,
    failed,
    timings,
    close: async () => {
      controllers.forEach((controller) => controller.abort());
      await Promise.allSettled(streams.map((stream) => stream.watch));
    },
  };
}

async function runHttpBurst() {
  const timings = [];
  const statuses = new Map();
  let networkErrors = 0;
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= httpRequests) return;
      const path = endpoints[index % endpoints.length];
      const started = performance.now();
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Accept: path.endsWith('.xml') ? 'application/xml' : 'application/json' },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        await drainResponse(response);
        timings.push(performance.now() - started);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      } catch {
        networkErrors += 1;
        timings.push(performance.now() - started);
      }
    }
  };

  await Promise.all(Array.from({ length: httpConcurrency }, worker));
  return { timings, statuses, networkErrors };
}

console.log(JSON.stringify({
  event: 'load_test_start',
  baseUrl,
  httpConcurrency,
  httpRequests,
  sseConnections,
}));

const started = performance.now();
const sse = await openSseConnections();
const http = await runHttpBurst();
await delay(sseHoldMs);
await sse.close();

const prematurelyClosed = sse.streams.filter((stream) => stream.prematurelyClosed).length;

const non2xx = [...http.statuses.entries()]
  .filter(([status]) => status < 200 || status >= 300)
  .reduce((sum, [, count]) => sum + count, 0);
const summary = {
  durationMs: round(performance.now() - started),
  sse: {
    requested: sseConnections,
    connected: sseConnections - sse.failed,
    failed: sse.failed,
    prematurelyClosed,
    connectP95Ms: round(percentile(sse.timings, 95)),
    activeStreams: sse.streams.length - prematurelyClosed,
  },
  http: {
    requested: httpRequests,
    completed: http.timings.length,
    networkErrors: http.networkErrors,
    non2xx,
    statuses: Object.fromEntries([...http.statuses.entries()].sort(([a], [b]) => a - b)),
    p50Ms: round(percentile(http.timings, 50)),
    p95Ms: round(percentile(http.timings, 95)),
    p99Ms: round(percentile(http.timings, 99)),
    maxMs: round(Math.max(0, ...http.timings)),
  },
};

console.log(JSON.stringify({ event: 'load_test_summary', ...summary }, null, 2));

const failures = [];
if (summary.sse.failed > 0) failures.push(`${summary.sse.failed} SSE connection(s) failed`);
if (summary.sse.prematurelyClosed > 0) failures.push(`${summary.sse.prematurelyClosed} SSE connection(s) closed before the hold window`);
if (summary.http.networkErrors > 0) failures.push(`${summary.http.networkErrors} HTTP network error(s)`);
if (summary.http.non2xx > 0) failures.push(`${summary.http.non2xx} non-2xx response(s)`);
if (summary.http.p95Ms > maxP95Ms) failures.push(`HTTP p95 ${summary.http.p95Ms}ms > ${maxP95Ms}ms`);
if (summary.http.p99Ms > maxP99Ms) failures.push(`HTTP p99 ${summary.http.p99Ms}ms > ${maxP99Ms}ms`);

if (failures.length > 0) {
  console.error(`Load test failed: ${failures.join('; ')}`);
  process.exitCode = 1;
}
