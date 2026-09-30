<script setup>
import { ref, watch } from 'vue';
const props = defineProps({ user: Object, loading: Boolean });
const emit = defineEmits(['save', 'logout']);
const profileForm = ref({});
const mobilityOptions = [['INDEPENDENT', '独立出行'], ['WHEELCHAIR', '使用轮椅'], ['CANE', '使用拐杖'], ['SLOW_WALKER', '慢行老人'], ['FAMILY_ASSISTED', '家属陪同']];
watch(() => props.user, (user) => { profileForm.value = { username: user?.username || '', realName: user?.realName || '', age: user?.age || '', phone: user?.phone || '', mobilityType: user?.mobilityType || 'INDEPENDENT', hasWheelchair: user?.hasWheelchair || false, hasCane: user?.hasCane || false, healthConditions: user?.healthConditions || '', emergencyContact: user?.emergencyContact || '', emergencyPhone: user?.emergencyPhone || '' }; }, { immediate: true });
</script>

<template>
  <section class="profile-panel elder-profile-panel">
    <header class="profile-header"><div><p class="section-kicker">我的</p><h1>个人信息</h1><p>完善信息后，路线会更适合您。</p></div><button class="secondary-action logout-btn" type="button" @click="$emit('logout')">退出登录</button></header>
    <div class="account-display"><span>我的数字账号</span><strong>{{ user?.account || user?.username || '未设置' }}</strong><small>请提供给家属进行关联</small></div>
    <form class="profile-form" @submit.prevent="$emit('save', profileForm)">
      <section class="form-section"><h2>基本信息</h2><label class="field-block"><span>姓名</span><input v-model="profileForm.realName" autocomplete="name" maxlength="50" placeholder="请输入您的姓名" /></label><label class="field-block"><span>年龄</span><input v-model.number="profileForm.age" type="number" min="1" max="120" inputmode="numeric" placeholder="请输入年龄" /></label><label class="field-block"><span>手机号</span><input v-model="profileForm.phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="用于验证码登录" /></label></section>
      <section class="form-section"><h2>身体状况</h2><label class="field-block"><span>出行情况</span><select v-model="profileForm.mobilityType"><option v-for="option in mobilityOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option></select></label><div class="toggle-grid"><label><input v-model="profileForm.hasWheelchair" type="checkbox" /> 使用轮椅</label><label><input v-model="profileForm.hasCane" type="checkbox" /> 使用拐杖</label></div><label class="field-block full-span"><span>身体情况与出行偏好</span><textarea v-model="profileForm.healthConditions" maxlength="500" placeholder="可填写膝盖不适、容易疲劳、希望少走台阶等"></textarea></label></section>
      <section class="form-section"><h2>紧急联系人</h2><label class="field-block"><span>联系人姓名</span><input v-model="profileForm.emergencyContact" maxlength="50" /></label><label class="field-block"><span>联系人电话</span><input v-model="profileForm.emergencyPhone" type="tel" inputmode="numeric" maxlength="20" /></label></section>
      <section v-if="user?.familyBindingCode" class="family-code-panel"><p class="section-kicker">家属关联</p><h2>请把关联码告诉家属</h2><strong>{{ user.familyBindingCode }}</strong><p>家属需输入您的账号和这 6 位关联码，才能查看出行信息。</p></section>
      <button class="primary-action" type="submit" :disabled="loading">{{ loading ? '保存中…' : '保存信息' }}</button>
    </form>
  </section>
</template>

<style scoped>
.elder-profile-panel {
  width: min(100%, 70rem);
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.25rem;
  background: var(--color-paper);
  box-shadow: 0 8px 26px rgb(32 55 71 / 7%);
}

.profile-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #e1e8ec;
}

.profile-header h1 {
  margin: .2rem 0 .35rem;
  color: var(--color-ink);
  font-size: clamp(1.75rem, 5vw, 2.25rem);
  line-height: 1.2;
}

.profile-header p:last-child {
  margin: 0;
  color: #586c79;
  line-height: 1.5;
}

.elder-profile-panel .logout-btn {
  min-width: 6rem;
  min-height: var(--target-min);
  border-color: #b9c8d0;
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
}

.account-display {
  gap: .25rem;
  margin: 1rem 0 1.25rem;
  padding: 1rem 1.125rem;
  border: 1px solid #cbdde5;
  border-radius: var(--radius-surface);
  color: var(--color-ink);
  background: var(--color-blue-soft);
}

.account-display span,
.account-display small {
  color: #526b79;
}

.account-display strong {
  overflow-wrap: anywhere;
  color: var(--color-blue);
  font-size: 1.375rem;
}

.profile-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 1rem;
}

.form-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: .875rem;
  margin: 0;
  padding: 1rem;
  border: 1px solid #e0e8ec;
  border-radius: var(--radius-surface);
  background: #fbfcfd;
}

.form-section h2 {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--color-ink);
  font-size: 1.25rem;
}

.elder-profile-panel .field-block {
  display: grid;
  gap: .35rem;
  min-width: 0;
  margin: 0;
}

.elder-profile-panel .field-block span {
  color: var(--color-ink);
  font-size: 1rem;
  font-weight: 700;
}

.elder-profile-panel input:not([type="checkbox"], [type="radio"]),
.elder-profile-panel select,
.elder-profile-panel textarea {
  width: 100%;
  min-width: 0;
  min-height: 3.25rem;
  padding: .65rem .75rem;
  border: 1px solid #b9c8d0;
  border-radius: var(--radius-control);
  background: var(--color-paper);
  font-size: 1rem;
}

.elder-profile-panel textarea {
  min-height: 7rem;
  resize: vertical;
}

.elder-profile-panel input:focus-visible,
.elder-profile-panel select:focus-visible,
.elder-profile-panel textarea:focus-visible {
  border-color: var(--color-blue);
  outline: 3px solid rgb(40 104 135 / 22%);
  outline-offset: 2px;
}

.form-section .full-span,
.form-section .toggle-grid {
  grid-column: 1 / -1;
}

.toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .625rem;
}

.toggle-grid label {
  display: flex;
  align-items: center;
  gap: .625rem;
  min-height: 3.25rem;
  padding: .5rem .75rem;
  border: 1px solid #d3dee3;
  border-radius: var(--radius-control);
  background: var(--color-paper);
  font-weight: 600;
}

.toggle-grid input {
  width: 1.25rem;
  height: 1.25rem;
  accent-color: var(--color-blue);
}

.family-code-panel {
  grid-column: 1 / -1;
  margin: 0;
  padding: 1rem;
  border: 1px dashed #8faebb;
  border-radius: var(--radius-surface);
  color: var(--color-ink);
  background: var(--color-info-soft);
}

.family-code-panel h2 {
  margin: .25rem 0 .5rem;
  font-size: 1.125rem;
}

.family-code-panel strong {
  color: var(--color-blue);
}

.family-code-panel p:last-child {
  margin-bottom: 0;
  color: #526b79;
  line-height: 1.5;
}

.profile-form > :deep(.primary-action) {
  grid-column: 1 / -1;
  min-height: 3.5rem;
  border-radius: var(--radius-control);
  color: #fff;
  background: var(--color-blue);
  font-size: 1.125rem;
}

@media (max-width: 700px) {
  .elder-profile-panel {
    padding: 1rem;
    border-radius: 1rem;
  }

  .profile-form,
  .form-section {
    grid-template-columns: 1fr;
  }

  .form-section h2,
  .form-section .full-span,
  .form-section .toggle-grid {
    grid-column: auto;
  }

  .profile-header {
    align-items: center;
  }
}

@media (max-width: 420px) {
  .elder-profile-panel {
    padding: .875rem;
  }

  .profile-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .elder-profile-panel .logout-btn {
    width: 100%;
  }

  .toggle-grid {
    grid-template-columns: 1fr;
  }
}
</style>
