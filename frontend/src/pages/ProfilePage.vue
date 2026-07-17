<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  user: Object,
  loading: Boolean
});

const emit = defineEmits(['save', 'logout']);

const profileForm = ref({
  username: props.user?.username || '',
  realName: props.user?.realName || '',
  age: props.user?.age || '',
  phone: props.user?.phone || '',
  mobilityType: props.user?.mobilityType || 'INDEPENDENT',
  hasWheelchair: props.user?.hasWheelchair || false,
  hasCane: props.user?.hasCane || false,
  healthConditions: props.user?.healthConditions || '',
  emergencyContact: props.user?.emergencyContact || '',
  emergencyPhone: props.user?.emergencyPhone || ''
});

const mobilityOptions = [
  { label: '独立出行', value: 'INDEPENDENT', hint: '可接受普通步行路线' },
  { label: '轮椅老人', value: 'WHEELCHAIR', hint: '不走台阶，优先坡道、宽路和无障碍路段' },
  { label: '拐杖老人', value: 'CANE', hint: '台阶惩罚很高，优先扶手、平缓、安全路线' },
  { label: '慢行老人', value: 'SLOW_WALKER', hint: '优先休息点、树荫、低坡度' },
  { label: '家属陪同', value: 'FAMILY_ASSISTED', hint: '兼顾陪同行走、安全提示' }
];

// Watch for user prop changes to update form
watch(() => props.user, (newUser) => {
  if (newUser) {
    profileForm.value = {
      username: newUser.username || '',
      realName: newUser.realName || '',
      age: newUser.age || '',
      phone: newUser.phone || '',
      mobilityType: newUser.mobilityType || 'INDEPENDENT',
      hasWheelchair: newUser.hasWheelchair || false,
      hasCane: newUser.hasCane || false,
      healthConditions: newUser.healthConditions || '',
      emergencyContact: newUser.emergencyContact || '',
      emergencyPhone: newUser.emergencyPhone || ''
    };
  }
}, { immediate: true });

function handleSave() {
  emit('save', { ...profileForm.value });
}

function handleLogout() {
  if (confirm('确定要退出登录吗？')) {
    emit('logout');
  }
}
</script>

<template>
  <section class="profile-panel">
    <div class="profile-header">
      <div>
        <p class="section-kicker">个人中心</p>
        <h2>我的信息</h2>
        <p>完善个人信息，获得更精准的路线推荐</p>
      </div>
      <button class="secondary-action logout-btn" type="button" @click="handleLogout">
        退出登录
      </button>
    </div>

    <form class="profile-form" @submit.prevent="handleSave">
      <div class="form-section">
        <h3>基本信息</h3>
        <label class="field-block">
          <span>用户名</span>
          <input v-model="profileForm.username" type="text" disabled />
        </label>

        <label class="field-block">
          <span>真实姓名</span>
          <input v-model="profileForm.realName" type="text" placeholder="请输入真实姓名" maxlength="50" />
        </label>

        <label class="field-block">
          <span>年龄</span>
          <input v-model.number="profileForm.age" type="number" placeholder="请输入年龄" min="1" max="120" />
        </label>

        <label class="field-block">
          <span>联系电话</span>
          <input v-model="profileForm.phone" type="tel" placeholder="请输入联系电话" maxlength="20" />
        </label>
      </div>

      <div class="form-section">
        <h3>身体状况</h3>
        <label class="field-block">
          <span>出行能力</span>
          <select v-model="profileForm.mobilityType">
            <option v-for="option in mobilityOptions" :key="option.value" :value="option.value">
              {{ option.label }} - {{ option.hint }}
            </option>
          </select>
        </label>

        <div class="toggle-grid">
          <label>
            <input v-model="profileForm.hasWheelchair" type="checkbox" />
            使用轮椅
          </label>
          <label>
            <input v-model="profileForm.hasCane" type="checkbox" />
            使用拐杖
          </label>
        </div>

        <label class="field-block full-span">
          <span>健康状况说明</span>
          <textarea
            v-model="profileForm.healthConditions"
            placeholder="例如：有高血压、心脏病史，需要定期休息；膝关节不好，避免爬楼梯等"
            maxlength="500"
          ></textarea>
        </label>
      </div>

      <div class="form-section">
        <h3>紧急联系人</h3>
        <label class="field-block">
          <span>联系人姓名</span>
          <input v-model="profileForm.emergencyContact" type="text" placeholder="请输入紧急联系人姓名" maxlength="50" />
        </label>

        <label class="field-block">
          <span>联系人电话</span>
          <input v-model="profileForm.emergencyPhone" type="tel" placeholder="请输入紧急联系人电话" maxlength="20" />
        </label>
      </div>

      <button class="primary-action" type="submit" :disabled="loading">
        {{ loading ? '保存中...' : '保存信息' }}
      </button>
    </form>
  </section>
</template>
