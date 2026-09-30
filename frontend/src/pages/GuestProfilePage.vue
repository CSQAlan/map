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
    <header><p class="section-kicker">访客使用</p><h1 id="guest-mobility-title">请选择出行情况</h1><p>这会帮助系统为您安排更合适的路线。</p></header>
    <div class="profile-prompt-options" role="group" aria-labelledby="guest-mobility-title">
      <button v-for="option in options" :key="option[0]" :class="{ selected: mobilityType === option[0] }" :aria-pressed="mobilityType === option[0]" type="button" @click="mobilityType = option[0]"><strong>{{ option[1] }}</strong><span>{{ option[2] }}</span></button>
    </div>
    <button class="primary-action" type="button" @click="$emit('continue', { mobilityType })">下一步</button>
    <button class="text-action" type="button" @click="$emit('back')">返回登录</button>
  </section>
</template>

<style scoped>
.guest-profile-panel {
  display: grid;
  gap: 1.25rem;
  width: min(calc(100% - 2rem), 40rem);
  margin: clamp(1rem, 5vh, 3rem) auto 2rem;
  padding: clamp(1.25rem, 5vw, 2.25rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.25rem;
  background: var(--color-paper);
  box-shadow: 0 12px 34px rgb(32 55 71 / 8%);
}

.guest-profile-panel header h1 {
  margin: .2rem 0 .5rem;
  color: var(--color-ink);
  font-size: clamp(1.75rem, 6vw, 2.5rem);
  line-height: 1.2;
}

.guest-profile-panel header > p:last-child {
  margin: 0;
  color: #586c79;
  line-height: 1.55;
}

.profile-prompt-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .75rem;
}

.profile-prompt-options button {
  display: grid;
  align-content: center;
  gap: .3rem;
  min-height: 5.25rem;
  padding: .875rem 1rem;
  border: 1px solid #c7d4db;
  border-radius: var(--radius-surface);
  color: var(--color-ink);
  background: var(--color-paper);
  text-align: left;
}

.profile-prompt-options button strong {
  font-size: 1.0625rem;
}

.profile-prompt-options button span {
  color: #586c79;
  line-height: 1.4;
}

.profile-prompt-options button.selected {
  border: 2px solid var(--color-blue);
  padding: calc(.875rem - 1px) calc(1rem - 1px);
  background: var(--color-blue-soft);
}

.guest-profile-panel :deep(.primary-action),
.guest-profile-panel .text-action {
  width: 100%;
  min-height: 3.25rem;
  border-radius: var(--radius-control);
  font-size: 1.0625rem;
}

.guest-profile-panel :deep(.primary-action) {
  color: #fff;
  background: var(--color-blue);
}

.guest-profile-panel .text-action {
  color: var(--color-blue);
}

@media (max-width: 480px) {
  .guest-profile-panel {
    width: calc(100% - 1.25rem);
    margin: .625rem auto 1rem;
    padding: 1.125rem;
    border-radius: 1rem;
  }

  .profile-prompt-options {
    grid-template-columns: 1fr;
    gap: .625rem;
  }

  .profile-prompt-options button {
    min-height: 4.5rem;
  }
}
</style>
