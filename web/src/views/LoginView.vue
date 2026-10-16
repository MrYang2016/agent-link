<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { postJson } from '../api.js';

const username = ref('');
const password = ref('');
const error = ref('');
let router = null;
let route = null;
try {
  router = useRouter();
  route = useRoute();
} catch {
  router = null;
  route = null;
}

async function submit() {
  error.value = '';
  const { status } = await postJson('/api/login', {
    username: username.value,
    password: password.value,
  });
  if (status === 200) {
    const next = route && typeof route.query.redirect === 'string' ? route.query.redirect : '/account';
    if (router) await router.push(next);
    return;
  }
  error.value = '用户名或密码不正确';
}
</script>

<template>
  <form @submit.prevent="submit">
    <h1>登录</h1>
    <label>
      用户名
      <input v-model="username" name="username" autocomplete="username" />
    </label>
    <label>
      密码
      <input v-model="password" name="password" type="password" autocomplete="current-password" />
    </label>
    <button type="submit">登录</button>
    <p v-if="error" class="error">{{ error }}</p>
    <p class="muted">没有账号？<router-link to="/register">去注册</router-link></p>
  </form>
</template>
