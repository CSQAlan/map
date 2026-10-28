<script setup>
defineProps({ name: { type: String, default: 'pin' }, size: { type: [Number, String], default: 24 } });
const paths = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  route: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9 6h6a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h6',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2 1.5-6A8.5 8.5 0 1 1 21 11.5ZM7 10h8m-8 4h5',
  layers: 'm12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  leaf: 'M20 3C9 2 3 7 5 14c2 7 15 5 15-11ZM4 21 16 8',
  shield: 'm12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5ZM8 12l3 3 5-6',
  chevron: 'm9 5 7 7-7 7',
  send: 'm3 3 19 9-19 9 4-9Zm4 9h15',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 7a9 9 0 1 0 1 9M20 2v6h-6',
  plus: 'M12 5v14M5 12h14',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-3 6a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name] || paths.pin" /></svg></template>
