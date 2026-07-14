import type { Page, Route } from '@playwright/test';

export const post = {
  id: '11111111-1111-4111-8111-111111111111',
  author: {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'e2euser',
    display_name: 'E2E User',
    avatar_url: null,
  },
  body: 'Deterministik E2E sinyali',
  body_html: '<p>Deterministik E2E sinyali</p>',
  visibility: 'public',
  reply_to_id: null,
  reactions_count: 3,
  replies_count: 1,
  created_at: '2026-07-14T10:00:00Z',
};

export const reply = {
  ...post,
  id: '33333333-3333-4333-8333-333333333333',
  author: {
    id: '44444444-4444-4444-8444-444444444444',
    username: 'replyuser',
    display_name: 'Reply User',
    avatar_url: null,
  },
  body: 'Deterministik yanıt',
  body_html: '<p>Deterministik yanıt</p>',
  reply_to_id: post.id,
  reactions_count: 0,
  replies_count: 0,
};

export const profile = {
  id: post.author.id,
  username: post.author.username,
  display_name: post.author.display_name,
  bio: 'E2E profil açıklaması',
  avatar_url: null,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
  last_seen_at: '2026-07-14T10:00:00Z',
  pinned_post_id: null,
  counts: { posts: 1, followers: 2, following: 3 },
  is_following: false,
  is_followed_by: false,
  mutual_follow: false,
  is_blocked_by_viewer: false,
  is_muted_by_viewer: false,
};

const searchHit = {
  id: post.id,
  author_id: post.author.id,
  author_username: post.author.username,
  author_display_name: post.author.display_name,
  author_avatar_url: null,
  body: '#rust etiketiyle deterministik sonuç',
  tags: ['rust'],
  reactions_count: post.reactions_count,
  replies_count: post.replies_count,
  created_at: 1_752_490_800,
};

type ApiOverride = (route: Route, url: URL) => Promise<boolean> | boolean;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function mockApi(page: Page, override?: ApiOverride) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (override && (await override(route, url))) return;

    if (url.pathname.endsWith('/users/me')) {
      await json(route, { error: 'unauthorized', message: 'Authentication required' }, 401);
      return;
    }
    if (url.pathname === '/api/v1/posts') {
      await json(route, { posts: [post], next_before: null, next_before_id: null });
      return;
    }
    if (url.pathname.endsWith(`/posts/${post.id}/thread`)) {
      await json(route, { root: post, descendants: [reply] });
      return;
    }
    if (url.pathname.endsWith(`/posts/${post.id}`)) {
      await json(route, post);
      return;
    }
    if (url.pathname.endsWith(`/users/${post.author.username}`)) {
      await json(route, profile);
      return;
    }
    if (url.pathname.endsWith(`/users/${post.author.username}/posts`)) {
      await json(route, [post]);
      return;
    }
    if (url.pathname.endsWith('/trending/hashtags')) {
      await json(route, [{ tag: 'rust', count: 12 }, { tag: 'cloudflare', count: 7 }]);
      return;
    }
    if (url.pathname.endsWith('/trending/posts')) {
      await json(route, []);
      return;
    }
    if (url.pathname.endsWith('/users/suggestions') || url.pathname.endsWith('/oauth/providers')) {
      await json(route, []);
      return;
    }
    if (url.pathname.endsWith('/search')) {
      const query = url.searchParams.get('q') ?? '';
      await json(route, {
        hits: [{
          id: post.id,
          author_username: post.author.username,
          author_display_name: post.author.display_name,
          author_avatar_url: null,
          body: `${query} sonucu`,
          created_at: 1_752_490_800,
        }],
        estimatedTotalHits: 1,
        processingTimeMs: 2,
      });
      return;
    }
    if (url.pathname.endsWith('/hashtags/rust')) {
      await json(route, { hits: [searchHit], estimatedTotalHits: 1, processingTimeMs: 2 });
      return;
    }
    if (url.pathname.endsWith('/hashtags/rust/follow')) {
      await json(route, { following: false });
      return;
    }
    if (url.pathname.endsWith('/feed/federated')) {
      await json(route, { posts: [], next_before: null });
      return;
    }
    if (url.pathname.endsWith('/feed/videos')) {
      await json(route, { posts: [], next_before: null, next_before_id: null });
      return;
    }

    await json(route, {});
  });
}
