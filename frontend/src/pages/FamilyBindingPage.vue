<script setup>
import { ref } from 'vue';
defineProps({ errorMessage: { type: String, default: '' } });
const emit = defineEmits(['bind', 'back']);
const elderAccount = ref('');
const bindingCode = ref('');
</script>
<template>
  <section class="family-binding-panel family-binding-card">
    <p class="section-kicker">家属注册 · 第 2 步</p><h1>关联需要关爱的老人</h1>
    <p class="family-binding-intro">请输入老人“我的”页面中的数字账号和 6 位家属关联码。</p>
    <form @submit.prevent="$emit('bind', { elderAccount: elderAccount.trim(), bindingCode: bindingCode.trim() })">
      <label class="field-block"><span>老人数字账号</span><input v-model="elderAccount" name="elder_account" autocomplete="off" required inputmode="numeric" placeholder="例如：100001" /></label>
      <label class="field-block"><span>家属关联码</span><input v-model="bindingCode" name="family_binding_code" autocomplete="off" required inputmode="numeric" maxlength="6" placeholder="请输入 6 位关联码" /></label>
      <p v-if="errorMessage" class="error-line" role="alert">{{ errorMessage }}</p><button class="primary-action" type="submit">确认关联</button>
    </form>
    <div class="binding-help"><strong>如何关联？</strong><ol><li>请老人先完成注册。</li><li>老人打开“我的”，查看数字账号和关联码。</li><li>家属输入两项信息，完成关联。</li></ol></div>
    <button class="text-action" type="button" @click="$emit('back')">返回登录</button>
  </section>
</template>

<style scoped>
.family-binding-card {
  width: min(100%, 34rem);
  margin: clamp(1rem, 5vh, 3rem) auto;
  padding: clamp(1.25rem, 5vw, 2rem);
  border: var(--border-subtle);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
  box-shadow: var(--shadow);
}

.family-binding-card h1 {
  margin: 0.25rem 0 0.5rem;
  color: var(--color-ink);
  font-size: clamp(1.65rem, 5vw, 2rem);
  line-height: 1.25;
}

.family-binding-intro {
  color: #536977;
}

.family-binding-card form {
  gap: 1rem;
}

.family-binding-card input {
  min-height: var(--target-comfortable);
  border-color: #cbd9e0;
  border-radius: var(--radius-control);
}

.binding-help {
  border: 1px solid #d2e2e8;
  border-radius: var(--radius-control);
  color: #405b69;
  background: var(--color-blue-soft);
}

.family-binding-card .primary-action {
  min-height: var(--target-comfortable);
  border-radius: var(--radius-control);
  background: var(--color-blue);
}

.family-binding-card .text-action {
  min-height: var(--target-comfortable);
}
</style>
