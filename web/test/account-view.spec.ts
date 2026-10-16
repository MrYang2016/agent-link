import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountView from '../src/views/AccountView.vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mountOffline(props: { token: string; serverOrigin: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  return mount(AccountView, { props });
}

describe('AccountView', () => {
  it('renders #agent-token', async () => {
    const wrapper = mountOffline({ token: 'prop-token-77', serverOrigin: 'https://origin.example' });
    await flushPromises();
    expect(wrapper.find('#agent-token').exists()).toBe(true);
  });

  it('includes the passed token in #install-command', async () => {
    const wrapper = mountOffline({ token: 'prop-token-77', serverOrigin: 'https://origin.example' });
    await flushPromises();
    expect(wrapper.get('#install-command').text()).toContain('--token prop-token-77');
  });

  it('includes the server origin in #install-command', async () => {
    const wrapper = mountOffline({ token: 'prop-token-77', serverOrigin: 'https://origin.example' });
    await flushPromises();
    const text = wrapper.get('#install-command').text();
    expect(text).toContain('https://origin.example/install');
    expect(text).toContain('--server https://origin.example');
  });

  it('shows the token from GET /api/me', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ userId: 'user-1', username: 'ada', token: 'api-token-88' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(AccountView, {
      props: { token: 'prop-token-77', serverOrigin: 'https://origin.example' },
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'include' }));
    expect(wrapper.get('#agent-token').text()).toBe('api-token-88');
  });

  it('does not mention 公司', async () => {
    const wrapper = mountOffline({ token: 'prop-token-77', serverOrigin: 'https://origin.example' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('公司');
  });
});
