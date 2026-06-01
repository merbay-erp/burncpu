// Tiny fetch wrapper. Same-origin in production (nginx proxies /api/),
// and `vite dev` proxies /api → burncpu.com.

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  };
  const r = await fetch(`/api/v1${path}`, init);
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) {
    const err = (json as { error?: string; message?: string } | undefined) ?? {};
    throw new ApiError(r.status, err.error ?? 'http_error', err.message ?? r.statusText);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body),
  del: <T>(path: string) => call<T>('DELETE', path),
};

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
  favicon?: string;
}

// Open Graph unfurl for a URL. The server resolves + caches it; a `null`
// preview means "nothing worth showing" (the card simply isn't rendered).
export function fetchLinkPreview(url: string) {
  return api.get<{ preview: LinkPreview | null }>(
    `/link_preview?url=${encodeURIComponent(url)}`,
  );
}

// ─── Types ──────────────────────────────────────────────────────

export interface Author {
  id: string;
  username: string;
  display_name: string;
}

export interface ParentExcerpt {
  id: string;
  author_username: string;
  excerpt: string;
}

export interface PostView {
  id: string;
  author: Author;
  body: string;
  body_html: string;
  visibility: string;
  reply_to_id: string | null;
  parent?: ParentExcerpt;
  content_warning?: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
  // 19 May 2026 — viewer-spesifik state. Anonim icin undefined, giris yapmissa true/false.
  // Post.tsx createEffect ile setReacted/setBookmarked initial state sync.
  viewer_reacted?: boolean;
  viewer_bookmarked?: boolean;
}

export interface Timeline {
  posts: PostView[];
  next_before: string | null;
  // Composite keyset tie-breaker — echoed back as `before_id` so pagination
  // never skips posts that share an identical `created_at` timestamp.
  next_before_id?: string | null;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  last_seen_at: string | null;
  pinned_post_id: string | null;
  counts: { posts: number; followers: number; following: number };
  // 19 May 2026 — viewer-spesifik state. Sayfa refresh sonrasi follow/block/mute
  // butonlarinin dogru gozukmesi icin backend'den geliyor (eski bug: refresh
  // ettiginde "Takip Et" hep aktif gozukurdu).
  is_following: boolean;
  is_followed_by: boolean;
  mutual_follow: boolean;
  is_blocked_by_viewer: boolean;
  is_muted_by_viewer: boolean;
}

export interface Notification {
  id: string;
  kind: 'reaction' | 'reply' | 'follow' | 'mention' | 'mod_action';
  actor_id: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  target_kind: string;
  target_id: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface ReactionTally {
  total: number;
  by_emoji: Record<string, number>;
  viewer: string | null;
}

export interface SearchHit {
  id: string;
  author_id: string;
  author_username: string;
  body: string;
  tags: string[];
  created_at: number;
  _formatted?: { body: string };
}

export interface SearchResponse {
  hits: SearchHit[];
  estimatedTotalHits?: number;
  processingTimeMs?: number;
}
