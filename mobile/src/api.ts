// HTTP client — mirrors web/src/api.ts but with an absolute origin (the app is
// not same-origin) and the native cookie jar carrying the burncpu_session
// cookie across requests + app restarts (NSHTTPCookieStorage / CookieManager).

export const API_ORIGIN = 'https://burncpu.com';
const BASE = `${API_ORIGIN}/api/v1`;

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
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) {
    const err = (json as { error?: string; message?: string } | undefined) ?? {};
    throw new ApiError(r.status, err.error ?? 'http_error', err.message ?? `HTTP ${r.status}`);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body),
  del: <T>(path: string) => call<T>('DELETE', path),
};

// Absolute URL helper for <Image> (avatars/media are origin-relative /media/...).
export const mediaUrl = (u?: string | null): string | undefined =>
  !u ? undefined : u.startsWith('http') ? u : `${API_ORIGIN}${u}`;

// ─── Types (same contracts as the web client) ──────────────────

export interface Author {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
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
  edited_at?: string;
  viewer_reacted?: boolean;
  viewer_bookmarked?: boolean;
}

export interface CreateResponse {
  post?: PostView;
  quarantined: boolean;
}

export interface Timeline {
  posts: PostView[];
  next_before: string | null;
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

export interface PostEditVersion {
  body: string;
  body_html: string;
  edited_at: string;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
  favicon?: string;
}

// Open Graph unfurl (server-resolved + cached). `null` = nothing worth showing.
export function fetchLinkPreview(url: string) {
  return api.get<{ preview: LinkPreview | null }>(`/link_preview?url=${encodeURIComponent(url)}`);
}
