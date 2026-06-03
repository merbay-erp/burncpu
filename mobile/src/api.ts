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

// `/users/{username}/posts` returns these — note there is NO `author` object
// (the profile owner is implied). We enrich them into PostView client-side.
export interface PostBrief {
  id: string;
  body: string;
  body_html: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
  content_warning?: string;
  edited_at?: string;
  author?: Author;
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

// ─── Sessions & security ───────────────────────────────────────
export interface SessionView {
  id: string;
  created_at: string;
  last_seen_at: string;
  last_seen_ip: string | null;
  last_seen_ua: string | null;
  flagged: boolean;
  current: boolean;
}
export interface SecurityEvent {
  kind: string;
  outcome: string;
  ip: string | null;
  user_agent: string | null;
  ts: string;
}
export interface SecurityInfo {
  sessions: SessionView[];
  events: SecurityEvent[];
}

// ─── Two-factor (TOTP) ─────────────────────────────────────────
export interface TwoFaStatus {
  enrolled: boolean;
  confirmed: boolean;
  recovery_codes_remaining: number;
}
export interface TwoFaEnroll {
  otpauth_uri: string;
  secret_base32: string;
  recovery_codes: string[];
}

// ─── Invites ───────────────────────────────────────────────────
export interface Invite {
  code: string;
  expires_at: string;
  created_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
}
export interface InviteCreated {
  code: string;
  url: string;
  expires_at: string;
}

// ─── Personal API tokens ───────────────────────────────────────
export interface ApiToken {
  id: string;
  name: string;
  scope: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface ApiTokenCreated {
  id: string;
  name: string;
  scope: string;
  token: string; // plaintext — shown exactly once
  expires_at: string | null;
}

// ─── Trash (soft-deleted posts, 30-day window) ─────────────────
export interface TrashedPost {
  id: string;
  body: string;
  deleted_at: string;
  created_at: string;
}

// ─── Trending posts ────────────────────────────────────────────
export interface TrendingPost {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
  body: string;
  body_html: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
}

// ─── Personal activity / analytics ─────────────────────────────
export interface ActivityTotals {
  posts: number;
  reactions_received: number;
  replies_received: number;
  followers_gained: number;
}
export interface ActivityDay extends ActivityTotals {
  day: string;
}
export interface Activity {
  window: string;
  totals: ActivityTotals;
  daily: ActivityDay[];
}

// `/users/lookup?prefix=` (mention typeahead) returns Author-shaped rows.
export const lookupUsers = (prefix: string) =>
  api.get<Author[]>(`/users/lookup?prefix=${encodeURIComponent(prefix)}`);

// ─── Two-factor login challenge ────────────────────────────────
export const twoFaChallenge = (code: string) => api.post('/auth/2fa/challenge', { code: code.trim() });

// ─── Webhooks ──────────────────────────────────────────────────
export const WEBHOOK_EVENTS = ['reaction', 'reply', 'follow', 'mention', 'dm'] as const;
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  last_called_at: string | null;
  last_status: number | null;
  failure_streak: number;
  created_at: string;
}
export interface WebhookCreated {
  id: string;
  url: string;
  events: string[];
  secret: string; // shown once
}
export interface WebhookDelivery {
  event: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

// ─── Admin ─────────────────────────────────────────────────────
export interface AdminStats {
  total_users: number;
  new_users_24h: number;
  dau_24h: number;
  total_posts: number;
  posts_24h: number;
  reactions_24h: number;
  follows_24h: number;
  requests_24h: number;
  errors_24h: number;
  flagged_sessions: number;
  pending_mod_posts: number;
  dm_messages_24h: number;
  media_total: number;
  media_bytes: number;
}
export interface AdminReport {
  id: string;
  reporter_username: string;
  target_kind: string;
  target_id: string;
  reason: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_username: string | null;
  resolution: string | null;
}
export interface FedInstance {
  host: string;
  followers: number;
  blocked: boolean;
  reason: string | null;
}
export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  last_seen_at: string | null;
  post_count: number;
}

// ─── Invite landing (public validation) ────────────────────────
export interface InviteCheck {
  code: string;
  valid: boolean;
  reason: string | null;
  inviter_username: string | null;
  expires_at: string | null;
}
export const checkInvite = (code: string) => api.get<InviteCheck>(`/invites/${encodeURIComponent(code)}`);

// Some endpoints (bookmarks, hashtag/search hits) return posts with FLAT author
// fields (author_username / author_display_name / author_avatar_url) instead of
// the nested `author` object that <Post> needs. Normalize them into a PostView.
// (Profile posts have no author at all — those are enriched separately.)
export function normalizePost(raw: Record<string, unknown>): PostView {
  if (raw.author) return raw as unknown as PostView;
  const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const author: Author = {
    id: s(raw.author_id) ?? '',
    username: s(raw.author_username) ?? s(raw.username) ?? '',
    display_name: s(raw.author_display_name) ?? s(raw.author_username) ?? s(raw.username) ?? '',
    avatar_url: s(raw.author_avatar_url) ?? s(raw.avatar_url) ?? null,
  };
  return {
    ...raw,
    author,
    visibility: s(raw.visibility) ?? 'public',
    reply_to_id: (raw.reply_to_id as string | null) ?? null,
  } as unknown as PostView;
}
