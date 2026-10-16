<script setup>
import { computed, onMounted, ref } from 'vue';

const props = defineProps({
  token: { type: String, default: '' },
  serverOrigin: { type: String, default: '' },
});

const token = ref(props.token);
const userId = ref('');
const username = ref('');
const origin = ref(props.serverOrigin);

const installCommand = computed(() => {
  const server = origin.value || (typeof window !== 'undefined' ? window.location.origin : '');
  return `curl -fsSL ${server}/install | sh -s -- --token ${token.value} --server ${server}`;
});

onMounted(async () => {
  if (!origin.value && typeof window !== 'undefined') origin.value = window.location.origin;
  if (typeof fetch !== 'function') return;
  try {
    const response = await fetch('/api/me', { credentials: 'include' });
    if (!response.ok) return;
    const body = await response.json();
    userId.value = body.userId || '';
    username.value = body.username || '';
    if (body.token) token.value = body.token;
  } catch {
    // 未登录或接口不可用时仍保留传入的 token，安装命令可以渲染。
  }
});
</script>

<template>
  <section>
    <h1>账号</h1>
    <p>用户 id：{{ userId }}</p>
    <p>用户名：{{ username }}</p>
    <div class="credential">
      <p>令牌</p>
      <p id="agent-token">{{ token }}</p>
    </div>
    <div class="credential">
      <p>安装命令</p>
      <p class="muted">把这条命令贴到终端执行。令牌已经写在命令里，会存进 ~/.agent-link/config.json，不用再单独配置。装完后重新打开 Cursor、Claude Code 或 Codex。</p>
      <code id="install-command">{{ installCommand }}</code>
    </div>
  </section>
</template>
