import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChannelListView from '../src/views/ChannelListView.vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function mountList(body: unknown) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal('fetch', fetchMock);
  const wrapper = mount(ChannelListView);
  return { wrapper, fetchMock };
}

describe('ChannelListView', () => {
  it('gives the search input the name q', async () => {
    const { wrapper } = mountList({ items: [], page: 1, pageSize: 20, total: 0 });
    await flushPromises();
    expect(wrapper.get('input').attributes('name')).toBe('q');
  });

  it('requests /api/channels with credentials', async () => {
    const { fetchMock } = mountList({ items: [], page: 1, pageSize: 20, total: 0 });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('renders channel id, name, and description from the JSON list', async () => {
    const { wrapper } = mountList({
      items: [{ id: 'ch-1', name: '可见名称', description: '可见描述' }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('ch-1');
    expect(wrapper.text()).toContain('可见名称');
    expect(wrapper.text()).toContain('可见描述');
  });

  it('does not render a member username', async () => {
    const { wrapper } = mountList({
      items: [
        {
          id: 'ch-1',
          name: '可见名称',
          description: '可见描述',
          username: '隐藏成员名',
          members: [{ username: '隐藏成员名' }],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('可见名称');
    expect(wrapper.text()).not.toContain('隐藏成员名');
  });

  it('does not offer create or join buttons', async () => {
    const { wrapper } = mountList({ items: [], page: 1, pageSize: 20, total: 0 });
    await flushPromises();
    const labels = wrapper.findAll('button').map((button) => button.text());
    expect(labels.some((label) => label.includes('建立') || label.includes('加入'))).toBe(false);
  });

  it('does not mention 公司', async () => {
    const { wrapper } = mountList({ items: [], page: 1, pageSize: 20, total: 0 });
    await flushPromises();
    expect(wrapper.text()).not.toContain('公司');
  });

  it('shows the next page when another page exists', async () => {
    const { wrapper, fetchMock } = mountList({
      items: [{ id: 'ch-1', name: '可见名称', description: '可见描述' }],
      page: 1,
      pageSize: 20,
      total: 25,
    });
    await flushPromises();
    const next = wrapper.findAll('button').find((button) => button.text() === '下一页');
    expect(next).toBeTruthy();
    await next!.trigger('click');
    await flushPromises();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('page=2'))).toBe(true);
  });
});
