<script setup>
import { ref } from 'vue';
const emit = defineEmits(['continue', 'back']);
const mobilityType = ref('INDEPENDENT');
const options = [
  ['INDEPENDENT', '独立出行', '可以正常步行'],
  ['SLOW_WALKER', '慢行老人', '优先平缓路线和休息点'],
  ['CANE', '使用拐杖', '尽量减少台阶，优先扶手'],
  ['WHEELCHAIR', '使用轮椅', '只推荐无障碍路线'],
  ['FAMILY_ASSISTED', '家属陪同', '兼顾安全和稳定'],
];
</script>

<template>
  <section class="guest-profile-panel profile-guest-style">
    <header><p class="section-kicker">访客使用</p><h1>请选择出行情况</h1><p>这会帮助系统为您安排更合适的路线。</p></header>
    <div class="profile-prompt-options" role="radiogroup">
      <button v-for="option in options" :key="option[0]" :class="{ selected: mobilityType === option[0] }" type="button" @click="mobilityType = option[0]"><strong>{{ option[1] }}</strong><span>{{ option[2] }}</span></button>
    </div>
    <button class="primary-action" type="button" @click="$emit('continue', { mobilityType })">下一步</button>
    <button class="text-action" type="button" @click="$emit('back')">返回登录</button>
  </section>
</template>
