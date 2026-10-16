import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import LoginView from '../src/views/LoginView.vue';

function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/account', component: { template: '<div />' } },
      { path: '/register', component: { template: '<div />' } },
    ],
  });
  const wrapper = mount(LoginView, { global: { plugins: [router] } });
  return { wrapper, router };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginView', () => {
  it('shows 用户名', () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).toContain('用户名');
  });

  it('shows 密码', () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).toContain('密码');
  });

  it('submits POST /api/login', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ userId: 'user-1', username: 'ada' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper, router } = mountView();
    await router.isReady();
    await wrapper.get('input[name="username"]').setValue('ada');
    await wrapper.get('input[name="password"]').setValue('password-ok');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'ada', password: 'password-ok' }),
      }),
    );
  });
});
