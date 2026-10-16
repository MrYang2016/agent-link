import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import RegisterView from '../src/views/RegisterView.vue';

function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/register', component: RegisterView },
      { path: '/account', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  });
  const wrapper = mount(RegisterView, { global: { plugins: [router] } });
  return { wrapper, router };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegisterView', () => {
  it('shows 用户名', () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).toContain('用户名');
  });

  it('shows 密码', () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).toContain('密码');
  });

  it('does not mention 公司', () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).not.toContain('公司');
  });

  it('submits POST /api/register', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 201,
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
      '/api/register',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'ada', password: 'password-ok' }),
      }),
    );
  });
});
