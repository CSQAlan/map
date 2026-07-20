<script setup>
import { ref } from 'vue';

const emit = defineEmits(['submit', 'skip']);
const answers = ref({
  walking: 'independent',
  restNeed: 'sometimes',
  stairAbility: 'avoid',
  vision: 'normal',
  concerns: [],
});

const questions = [
  { key: 'walking', title: '平时走路的情况？', options: [['independent', '基本独立'], ['slow', '走得较慢'], ['assisted', '需要陪同']] },
  { key: 'restNeed', title: '走一段路需要休息吗？', options: [['rarely', '很少需要'], ['sometimes', '偶尔需要'], ['often', '经常需要']] },
  { key: 'stairAbility', title: '遇到台阶时？', options: [['ok', '可以慢慢走'], ['avoid', '希望尽量避开'], ['unable', '不能走台阶']] },
  { key: 'vision', title: '夜间或昏暗处看路？', options: [['normal', '没有困难'], ['careful', '需要更亮一些'], ['difficult', '看路较困难']] },
];

const concernOptions = ['膝盖或关节不适', '容易疲劳', '怕滑倒', '需要轮椅/拐杖', '希望有座椅休息'];

function toggleConcern(value) {
  answers.value.concerns = answers.value.concerns.includes(value)
    ? answers.value.concerns.filter((item) => item !== value)
    : [...answers.value.concerns, value];
}
</script>

<template>
  <div class="profile-prompt-backdrop questionnaire-backdrop" role="dialog" aria-modal="true" aria-labelledby="questionnaire-title">
    <section class="questionnaire-card">
      <p class="section-kicker">可选完善</p>
      <h2 id="questionnaire-title">再了解您一点</h2>
      <p>回答几道简单问题，路线会更适合您。您也可以暂时跳过。</p>

      <div v-for="question in questions" :key="question.key" class="question-block">
        <strong>{{ question.title }}</strong>
        <div class="question-options">
          <button
            v-for="option in question.options"
            :key="option[0]"
            type="button"
            :class="{ selected: answers[question.key] === option[0] }"
            @click="answers[question.key] = option[0]"
          >{{ option[1] }}</button>
        </div>
      </div>

      <div class="question-block">
        <strong>还有哪些需要特别注意？（可多选）</strong>
        <div class="question-options concern-options">
          <button
            v-for="option in concernOptions"
            :key="option"
            type="button"
            :class="{ selected: answers.concerns.includes(option) }"
            @click="toggleConcern(option)"
          >{{ option }}</button>
        </div>
      </div>

      <div class="questionnaire-actions">
        <button class="primary-action" type="button" @click="$emit('submit', answers)">保存并继续</button>
        <button class="secondary-action" type="button" @click="$emit('skip')">暂时跳过</button>
      </div>
    </section>
  </div>
</template>
