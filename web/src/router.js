import { createRouter, createWebHistory } from 'vue-router';
import RegisterView from './views/RegisterView.vue';
import LoginView from './views/LoginView.vue';
import AccountView from './views/AccountView.vue';
import ChannelListView from './views/ChannelListView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/channels' },
    { path: '/register', component: RegisterView },
    { path: '/login', component: LoginView },
    { path: '/account', component: AccountView },
    { path: '/channels', component: ChannelListView },
  ],
});

router.beforeEach(async (to) => {
  if (to.path !== '/channels' && to.path !== '/account') return true;
  try {
    const response = await fetch('/api/me', { credentials: 'include' });
    if (response.status === 401) return '/login';
  } catch {
    return '/login';
  }
  return true;
});

export default router;
