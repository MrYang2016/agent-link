<template>
  <div class="shell">
    <header class="top">
      <span class="mark">agent-link</span>
      <nav>
        <router-link to="/register">注册</router-link>
        <router-link to="/login">登录</router-link>
        <router-link to="/account">账号</router-link>
        <router-link to="/channels">频道</router-link>
      </nav>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>
