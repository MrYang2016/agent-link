import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../src/router.js';

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) })),
  );
  await router.isReady();
  if (router.currentRoute.value.path !== '/login') {
    await router.push('/login').catch(() => undefined);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('router', () => {
  it.each(['/register', '/login', '/account', '/channels'])('registers %s', (path) => {
    expect(router.getRoutes().some((route) => route.path === path)).toBe(true);
  });

  it('opens /login when /api/me returns 401 for /channels', async () => {
    await router.push('/channels').catch(() => undefined);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('requests GET /api/me with credentials before /channels', async () => {
    await router.push('/channels').catch(() => undefined);
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'include' }));
  });

  it('stays on /channels when /api/me succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ userId: 'user-1', username: 'ada', token: 'token-1' }),
      })),
    );
    await router.push('/channels').catch(() => undefined);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/channels');
  });
});
