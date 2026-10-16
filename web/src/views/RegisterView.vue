<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { postJson } from '../api.js';

const username = ref('');
const password = ref('');
const error = ref('');
let router = null;
try {
  router = useRouter();
} catch {
  router = null;
}

async function submit() {
  error.value = '';
  const { status, data } = await postJson('/api/register', {
    username: username.value,
    password: password.value,
  });
  if (status === 201) {
    if (router) await router.push('/account');
    return;
  }
  error.value = data.error === 'username_taken' ? '用户名已被使用' : '注册没有完成';
}
</script>

<template>
  <form @submit.prevent="submit">
    <h1>注册</h1>
    <label>
      用户名
      <input v-model="username" name="username" autocomplete="username" />
    </label>
    <label>
      密码
      <input v-model="password" name="password" type="password" autocomplete="new-password" />
    </label>
    <button type="submit">注册</button>
    <p v-if="error" class="error">{{ error }}</p>
    <p class="muted">已有账号？<router-link to="/login">去登录</router-link></p>
  </form>
</template>
