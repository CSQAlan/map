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
      <section class="form-section"><h2>基本信息</h2><label class="field-block"><span>姓名</span><input v-model="profileForm.realName" maxlength="50" placeholder="请输入您的姓名" /></label><label class="field-block"><span>年龄</span><input v-model.number="profileForm.age" type="number" min="1" max="120" placeholder="请输入年龄" /></label><label class="field-block"><span>手机号</span><input v-model="profileForm.phone" type="tel" inputmode="numeric" maxlength="20" placeholder="用于验证码登录" /></label></section>
      <section class="form-section"><h2>身体状况</h2><label class="field-block"><span>出行情况</span><select v-model="profileForm.mobilityType"><option v-for="option in mobilityOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option></select></label><div class="toggle-grid"><label><input v-model="profileForm.hasWheelchair" type="checkbox" /> 使用轮椅</label><label><input v-model="profileForm.hasCane" type="checkbox" /> 使用拐杖</label></div><label class="field-block full-span"><span>身体情况与出行偏好</span><textarea v-model="profileForm.healthConditions" maxlength="500" placeholder="可填写膝盖不适、容易疲劳、希望少走台阶等"></textarea></label></section>
      <section class="form-section"><h2>紧急联系人</h2><label class="field-block"><span>联系人姓名</span><input v-model="profileForm.emergencyContact" maxlength="50" /></label><label class="field-block"><span>联系人电话</span><input v-model="profileForm.emergencyPhone" type="tel" inputmode="numeric" maxlength="20" /></label></section>
      <section v-if="user?.familyBindingCode" class="family-code-panel"><p class="section-kicker">家属关联</p><h2>请把关联码告诉家属</h2><strong>{{ user.familyBindingCode }}</strong><p>家属需输入您的账号和这 6 位关联码，才能查看出行信息。</p></section>
      <button class="primary-action" type="submit" :disabled="loading">{{ loading ? '保存中…' : '保存信息' }}</button>
    </form>
  </section>
</template>
