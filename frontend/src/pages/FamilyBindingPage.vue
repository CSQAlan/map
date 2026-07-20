<script setup>
import { ref } from 'vue';
defineProps({ errorMessage: { type: String, default: '' } });
const emit = defineEmits(['bind', 'back']);
const elderAccount = ref('');
const bindingCode = ref('');
</script>
<template>
  <section class="family-binding-panel">
    <p class="section-kicker">家属注册 · 第 2 步</p><h1>关联需要关爱的老人</h1>
    <p>请输入老人“我的”页面中的数字账号和 6 位家属关联码。</p>
    <form @submit.prevent="$emit('bind', { elderAccount: elderAccount.trim(), bindingCode: bindingCode.trim() })">
      <label class="field-block"><span>老人数字账号</span><input v-model="elderAccount" required inputmode="numeric" placeholder="例如：100001" /></label>
      <label class="field-block"><span>家属关联码</span><input v-model="bindingCode" required inputmode="numeric" maxlength="6" placeholder="请输入 6 位关联码" /></label>
      <p v-if="errorMessage" class="error-line">{{ errorMessage }}</p><button class="primary-action" type="submit">确认关联</button>
    </form>
    <div class="binding-help"><strong>如何关联？</strong><ol><li>请老人先完成注册。</li><li>老人打开“我的”，查看数字账号和关联码。</li><li>家属输入两项信息，完成关联。</li></ol></div>
    <button class="text-action" type="button" @click="$emit('back')">返回登录</button>
  </section>
</template>
