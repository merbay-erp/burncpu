/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import Layout from './Layout';
import './styles.css';

const Home = lazy(() => import('./pages/Home'));
const Feed = lazy(() => import('./pages/Feed'));
const Login = lazy(() => import('./pages/Login'));
const TwoFA = lazy(() => import('./pages/TwoFA'));
const Profile = lazy(() => import('./pages/Profile'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Hashtag = lazy(() => import('./pages/Hashtag'));
const Search = lazy(() => import('./pages/Search'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
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

render(
  () => (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/feed" component={Feed} />
      <Route path="/login" component={Login} />
      <Route path="/2fa" component={TwoFA} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/settings" component={Settings} />
      <Route path="/search" component={Search} />
      {/* `@` gets URL-encoded to %40 by browsers, which then doesn't match
          a literal `@` in the route. Use /u/:username and redirect @links. */}
      <Route path="/u/:username" component={Profile} />
      <Route path="/posts/:id" component={PostDetail} />
      <Route path="/hashtag/:tag" component={Hashtag} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
);
