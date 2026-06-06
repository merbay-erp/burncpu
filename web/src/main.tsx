/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import Layout from './Layout';
import './styles.css';

// Promote the preloaded font stylesheets (index.html) to applied stylesheets.
// They're preloaded so the download starts early without blocking the first
// paint; we flip rel here — from our own 'self' bundle — because the CSP forbids
// the inline `onload` handler the usual deferred-CSS trick relies on.
for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="style"]')) {
  link.rel = 'stylesheet';
}

// Warm the public timeline fetch the instant this entry module runs — *before*
// the route chunk loads and the app mounts — so the data is already in flight
// (and usually back) by the time Home asks for it. That takes the /posts round
// trip off the sequential path to the first content paint (the LCP). Only on the
// home route; Home consumes it once and falls back to a normal fetch on any miss.
if (location.pathname === '/') {
  (window as unknown as { __homePosts__?: Promise<unknown> }).__homePosts__ = fetch(
    '/api/v1/posts?limit=12',
    { credentials: 'include', headers: { Accept: 'application/json' } },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

const Home = lazy(() => import('./pages/Home'));
const Feed = lazy(() => import('./pages/Feed'));
const Login = lazy(() => import('./pages/Login'));
const Invite = lazy(() => import('./pages/Invite'));
const Confirm = lazy(() => import('./pages/Confirm'));
const TwoFA = lazy(() => import('./pages/TwoFA'));
const Profile = lazy(() => import('./pages/Profile'));
const FollowList = lazy(() => import('./pages/FollowList'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Hashtag = lazy(() => import('./pages/Hashtag'));
const Search = lazy(() => import('./pages/Search'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const Bookmarks = lazy(() => import('./pages/Bookmarks'));
const Trending = lazy(() => import('./pages/Trending'));
const DMs = lazy(() => import('./pages/DMs'));
const DMThread = lazy(() => import('./pages/DMThread'));
const Admin = lazy(() => import('./pages/Admin'));
const Trash = lazy(() => import('./pages/Trash'));
const Activity = lazy(() => import('./pages/Activity'));
const Docs = lazy(() => import('./pages/Docs'));
const NotFound = lazy(() => import('./pages/NotFound'));

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

// After a deploy, the new index.html references new hashed asset chunks.
// If a user still has the old index.html cached, route-split lazy imports
// will 404. Detect that and force-reload to grab the fresh index.html.
window.addEventListener('vite:preloadError', () => window.location.reload());
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message ?? e.reason ?? '');
  if (/Failed to fetch dynamically imported module|Loading chunk/i.test(msg)) {
    window.location.reload();
  }
});

// Register service worker for offline shell + install prompt support.
// Skip in dev (vite serves modules on demand).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // not fatal — site still works without SW
    });
  });
}

render(
  () => (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/feed" component={Feed} />
      <Route path="/login" component={Login} />
      <Route path="/invite/:code" component={Invite} />
      <Route path="/auth/confirm/:token" component={Confirm} />
      <Route path="/2fa" component={TwoFA} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/bookmarks" component={Bookmarks} />
      <Route path="/dm" component={DMs} />
      <Route path="/dm/:username" component={DMThread} />
      <Route path="/admin" component={Admin} />
      <Route path="/trash" component={Trash} />
      <Route path="/settings" component={Settings} />
      <Route path="/trending" component={Trending} />
      <Route path="/activity" component={Activity} />
      <Route path="/docs" component={Docs} />
      <Route path="/search" component={Search} />
      {/* `@` gets URL-encoded to %40 by browsers, which then doesn't match
          a literal `@` in the route. Use /u/:username and redirect @links. */}
      <Route path="/u/:username" component={Profile} />
      <Route path="/u/:username/followers" component={FollowList} />
      <Route path="/u/:username/following" component={FollowList} />
      <Route path="/posts/:id" component={PostDetail} />
      <Route path="/hashtag/:tag" component={Hashtag} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
);
