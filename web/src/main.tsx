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
const NotFound = lazy(() => import('./pages/NotFound'));

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

render(
  () => (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/feed" component={Feed} />
      <Route path="/login" component={Login} />
      <Route path="/2fa" component={TwoFA} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/search" component={Search} />
      <Route path="/@:username" component={Profile} />
      <Route path="/posts/:id" component={PostDetail} />
      <Route path="/hashtag/:tag" component={Hashtag} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
);
