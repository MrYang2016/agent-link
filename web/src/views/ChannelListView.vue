<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const q = ref('');
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const items = ref([]);
const error = ref('');

let route = null;
let router = null;
try {
  route = useRoute();
  router = useRouter();
} catch {
  route = null;
  router = null;
}

function readQuery() {
  if (!route) return;
  q.value = typeof route.query.q === 'string' ? route.query.q : '';
  const parsed = Number.parseInt(String(route.query.page ?? '1'), 10);
  page.value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function load() {
  const params = new URLSearchParams();
  params.set('q', q.value);
  params.set('page', String(page.value));
  const response = await fetch(`/api/channels?${params.toString()}`, { credentials: 'include' });
  if (response.status === 401) {
    if (router) await router.push('/login');
    return;
  }
  if (!response.ok) {
    error.value = '频道列表没有加载出来';
    return;
  }
  const body = await response.json();
  items.value = Array.isArray(body.items) ? body.items : [];
  total.value = Number(body.total || 0);
  page.value = Number(body.page || page.value);
  pageSize.value = Number(body.pageSize || 20);
  error.value = '';
}

function submit() {
  page.value = 1;
  if (router) {
    router.push({ path: '/channels', query: { q: q.value, page: '1' } });
    return;
  }
  load().catch(() => {
    error.value = '频道列表没有加载出来';
  });
}

function go(nextPage) {
  page.value = nextPage;
  if (router) {
    router.push({ path: '/channels', query: { q: q.value, page: String(nextPage) } });
    return;
  }
  load().catch(() => {
    error.value = '频道列表没有加载出来';
  });
}

onMounted(() => {
  readQuery();
  if (typeof fetch !== 'function') return;
  load().catch(() => {
    error.value = '频道列表没有加载出来';
  });
});

if (route) {
  watch(
    () => [route.query.q, route.query.page],
    () => {
      readQuery();
      load().catch(() => {
        error.value = '频道列表没有加载出来';
      });
    },
  );
}
</script>

<template>
  <section>
    <h1>频道</h1>
    <form @submit.prevent="submit">
      <label>
        搜索名称或描述
        <input v-model="q" name="q" />
      </label>
      <button type="submit">搜索</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="items.length === 0" class="muted">没有匹配的频道</p>
    <div v-for="item in items" :key="item.id" class="row">
      <div>
        <div>{{ item.name }}</div>
        <div class="channel-id">{{ item.id }}</div>
      </div>
      <div>{{ item.description }}</div>
    </div>
    <p class="muted">第 {{ page }} 页，共 {{ total }} 个</p>
    <div class="pager">
      <button v-if="page > 1" type="button" @click="go(page - 1)">上一页</button>
      <button v-if="page * pageSize < total" type="button" @click="go(page + 1)">下一页</button>
    </div>
  </section>
</template>
