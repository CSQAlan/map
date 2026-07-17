<script setup>
import { ref } from 'vue';

const emit = defineEmits(['continue', 'back']);
const mobilityType = ref('INDEPENDENT');
const healthCondition = ref('');

const options = [
  { value: 'INDEPENDENT', label: '独立出行', hint: '可正常步行' },
  { value: 'SLOW_WALKER', label: '慢行老人', hint: '优先休息点与平缓路线' },
  { value: 'CANE', label: '使用拐杖', hint: '少台阶、优先扶手' },
  { value: 'WHEELCHAIR', label: '使用轮椅', hint: '只推荐无障碍路线' },
  { value: 'FAMILY_ASSISTED', label: '家属陪同', hint: '兼顾安全与稳定' },
];

function continueAsGuest() {
  emit('continue', { mobilityType: mobilityType.value, healthCondition: healthCondition.value.trim() });
}
</script>

<template>
  <section class="guest-profile-panel">
    <header>
      <p class="section-kicker">访客使用</p>
      <h1>请选择您的出行情况</h1>
      <p>这次填写的信息只用于本次路线推荐，离开后不会保存。</p>
    </header>

    <div class="guest-profile-options" role="radiogroup" aria-label="出行画像">
      <button
        v-for="option in options"
        :key="option.value"
        class="guest-profile-option"
        :class="{ selected: mobilityType === option.value }"
        type="button"
        role="radio"
        :aria-checked="mobilityType === option.value"
        @click="mobilityType = option.value"
      >
        <strong>{{ option.label }}</strong><span>{{ option.hint }}</span>
      </button>
    </div>

    <label class="field-block">
      <span>身体情况（选填）</span>
      <textarea v-model.trim="healthCondition" maxlength="200" placeholder="例如：膝盖不舒服，需要少走台阶"></textarea>
    </label>

    <button class="primary-action" type="button" @click="continueAsGuest">进入通用界面</button>
    <button class="text-action" type="button" @click="$emit('back')">返回登录</button>
  </section>
</template>
