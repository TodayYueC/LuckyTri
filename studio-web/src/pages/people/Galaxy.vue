<script setup lang="ts">
import { computed } from "vue";
import { hueOf, initials } from "../../format";
import { liveMood } from "../../mood/useMood";
import TaOrb from "../../components/ta/TaOrb.vue";

const props = defineProps<{ people: any[]; activity?: string }>();
const emit = defineEmits<{ open: [id: string]; list: [] }>();
const ranked = computed(() =>
  [...props.people].sort((a, b) => (b.familiarity ?? 0) - (a.familiarity ?? 0)),
);
const featured = computed(() => ranked.value.slice(0, 12));
const hidden = computed(() =>
  Math.max(0, ranked.value.length - featured.value.length),
);
</script>

<template>
  <section class="galaxy" aria-label="相遇之间：TA 认识的人">
    <div class="encounter-hero">
      <div class="encounter-copy">
        <span class="eyebrow">PEOPLE / 相遇之间</span>
        <h2>每一次相遇，<br /><em>都留下一点温度。</em></h2>
        <p>
          越熟悉离 TA 越近。这里先放着最近亲近的
          {{ featured.length }} 个人，其他人也仍然在名单里。
        </p>
        <div class="encounter-count">
          <b>{{ people.length }}</b
          ><span>个相遇过的人</span>
        </div>
      </div>
      <div class="encounter-lens" aria-hidden="true">
        <div class="lens-ring ring-a"></div>
        <div class="lens-ring ring-b"></div>
        <span class="lens-dot dot-a"></span><span class="lens-dot dot-b"></span
        ><span class="lens-dot dot-c"></span>
        <div class="orb">
          <TaOrb :mood="liveMood" :activity="activity || 'idle'" :size="100" />
        </div>
      </div>
    </div>

    <div class="people-heading">
      <div>
        <span class="eyebrow">CLOSER TO HER</span>
        <h3>最近靠近的人</h3>
      </div>
      <span>点开一张光片，看看她记得什么</span>
    </div>
    <div class="encounter-grid">
      <button
        v-for="(person, index) in featured"
        :key="person.userId"
        type="button"
        class="person-node"
        :class="{
          away: (person.awayDays ?? 0) >= 14,
          tense: person.tension >= 0.3,
        }"
        :data-person="person.userId"
        :style="{
          '--hue': hueOf(person.name || person.userId),
          '--order': index,
        }"
        :aria-label="`${person.name}：${person.feel || '还在慢慢认识'}`"
        @click="emit('open', person.userId)"
      >
        <span class="avatar-wrap"
          ><span class="avatar">{{ initials(person.name) }}</span></span
        >
        <span class="person-copy"
          ><b>{{ person.name }}</b
          ><small>QQ {{ person.userId }}</small
          ><small>{{ person.feel || "还在慢慢认识" }}</small></span
        >
        <span class="person-arrow" aria-hidden="true">↗</span>
        <span
          class="familiarity"
          :style="{
            '--amount':
              Math.round(
                Math.max(0, Math.min(1, person.familiarity ?? 0)) * 100,
              ) + '%',
          }"
          aria-hidden="true"
          ><i></i
        ></span>
      </button>
    </div>
    <button
      v-if="hidden"
      type="button"
      class="more-people"
      @click="emit('list')"
    >
      在名单里看看另外 {{ hidden }} 个人 <span aria-hidden="true">↗</span>
    </button>
  </section>
</template>

<style scoped>
.galaxy {
  display: grid;
  gap: 22px;
  min-width: 0;
}
.encounter-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(230px, 0.9fr);
  min-height: 300px;
  align-items: center;
  border-radius: 38px;
  padding: 30px clamp(25px, 4vw, 50px);
  border: 1px solid #ffffffe8;
  background: linear-gradient(
    120deg,
    #ffffffc2 3%,
    #e9f8ff85 47%,
    #f2e5ff6b 100%
  );
  box-shadow:
    inset 0 2px 0 #fff,
    0 27px 55px -38px #638bc196;
  backdrop-filter: blur(28px) saturate(1.7);
  -webkit-backdrop-filter: blur(28px) saturate(1.7);
}
.encounter-hero::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 350px;
  height: 350px;
  right: -80px;
  top: -160px;
  border-radius: 50%;
  background: conic-gradient(#d9c6ff91, #b0e4ff8c, #fff3d591, #d9c6ff91);
  filter: blur(23px);
  animation: hue-drift 13s ease-in-out infinite alternate;
}
.encounter-copy {
  position: relative;
  z-index: 1;
}
.encounter-copy h2 {
  margin: 13px 0 15px;
  font-size: clamp(28px, 3.5vw, 46px);
  letter-spacing: -0.05em;
  line-height: 1.18;
}
.encounter-copy h2 em {
  font-style: normal;
  color: transparent;
  background: linear-gradient(105deg, #5f91c8, #9b7fcb 55%, #cd92bf);
  background-clip: text;
  -webkit-background-clip: text;
}
.encounter-copy p {
  max-width: 54ch;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-soft);
}
.encounter-count {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 21px;
  padding: 7px 15px;
  border-radius: 99px;
  background: #ffffff85;
  border: 1px solid #fff;
  box-shadow: inset 0 1px 0 #fff;
  font-size: 12px;
  color: var(--ink-soft);
}
.encounter-count b {
  color: var(--accent);
  font: 700 20px var(--font-display);
}
.encounter-lens {
  position: relative;
  justify-self: center;
  width: min(100%, 320px);
  aspect-ratio: 1.18;
  display: grid;
  place-items: center;
}
.lens-ring {
  position: absolute;
  border-radius: 50%;
}
.ring-a {
  width: 80%;
  aspect-ratio: 1;
  background: radial-gradient(
    circle at 30% 25%,
    #fff 3%,
    #e9faffbb 35%,
    #d1e7ffc2 70%,
    #f0dcff95
  );
  border: 1px solid #fff;
  box-shadow:
    inset 8px 11px 20px #fff,
    inset -9px -11px 18px #9bbded59,
    0 22px 35px -25px #669bd0;
  animation: lens-breathe 6s ease-in-out infinite;
}
.ring-b {
  width: 99%;
  aspect-ratio: 1.13;
  border: 1px solid #ffffffc2;
  box-shadow:
    inset 0 0 16px #fff9,
    0 0 30px #dcf1ff9c;
  transform: rotate(-15deg);
}
.orb {
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 13px 12px #638fd13d);
  animation: orb-rise 5s ease-in-out infinite;
}
.lens-dot {
  position: absolute;
  z-index: 3;
  border-radius: 45% 55% 60% 40%;
  border: 1px solid #fff;
  background: radial-gradient(circle at 25% 20%, #fff, #bcd8f0 70%, #ebd5fd);
  box-shadow:
    inset 2px 2px 4px #fff,
    0 6px 15px #729cd564;
  animation: orb-rise 4s ease-in-out infinite alternate;
}
.dot-a {
  width: 29px;
  height: 29px;
  top: 12%;
  left: 10%;
}
.dot-b {
  width: 18px;
  height: 18px;
  bottom: 21%;
  right: 5%;
  animation-delay: -2s;
}
.dot-c {
  width: 12px;
  height: 12px;
  top: 15%;
  right: 10%;
  animation-delay: -3s;
}
.people-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding: 0 5px;
}
.people-heading h3 {
  margin-top: 4px;
  font-size: clamp(19px, 2vw, 25px);
}
.people-heading > span {
  font-size: 12px;
  color: var(--ink-soft);
}
.encounter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.person-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 110px;
  padding: 19px 16px 23px;
  text-align: left;
  border-radius: 26px;
  border: 1px solid #ffffffe5;
  background: linear-gradient(
    128deg,
    #ffffffd0,
    #ffffff6b 69%,
    hsl(var(--hue) 80% 90% / 0.48)
  );
  box-shadow:
    inset 0 1px 0 #fff,
    0 17px 31px -26px #5f7cb4;
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
  animation: card-in 0.6s var(--spring) both;
  animation-delay: calc(var(--order) * 35ms);
  transition:
    transform 0.45s var(--spring),
    box-shadow 0.28s ease;
}
.person-node:hover:not(:disabled),
.person-node:focus-visible {
  transform: translateY(-5px) scale(1.025);
  box-shadow:
    inset 0 1px 0 #fff,
    0 25px 35px -23px hsl(var(--hue) 42% 60%);
}
.person-node:active:not(:disabled) {
  transform: scale(0.97);
}
.person-node.away {
  opacity: 0.68;
}
.person-node.tense {
  border-color: color-mix(in srgb, var(--warn) 27%, #fff);
}
.avatar-wrap {
  flex: none;
  display: grid;
  place-items: center;
  width: 57px;
  height: 57px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 28% 23%,
    #fff,
    hsl(var(--hue) 72% 87% / 0.9) 48%,
    hsl(var(--hue) 65% 76% / 0.7)
  );
  box-shadow:
    inset 2px 3px 4px #fff,
    inset -3px -4px 8px #a9c4dd6e,
    0 8px 16px -10px #5274a9;
  border: 1px solid #fff;
  transition: transform 0.5s var(--spring);
}
.person-node:hover .avatar-wrap {
  transform: rotate(-9deg) scale(1.1);
}
.avatar {
  color: hsl(var(--hue) 43% 31%);
  font: 700 16px var(--font-display);
}
.person-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.person-copy b {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.person-copy small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ink-soft);
}
.person-arrow {
  margin-left: auto;
  align-self: start;
  color: var(--accent);
  opacity: 0.47;
  transition:
    transform 0.45s var(--spring),
    opacity 0.2s;
}
.person-node:hover .person-arrow {
  transform: translate(3px, -3px);
  opacity: 1;
}
.familiarity {
  position: absolute;
  left: 17px;
  right: 17px;
  bottom: 12px;
  height: 3px;
  overflow: hidden;
  border-radius: 99px;
  background: #9dc3e33b;
}
.familiarity i {
  display: block;
  width: var(--amount);
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #8bcbec, hsl(var(--hue) 70% 75%), #d1b1e9);
}
.more-people {
  justify-self: center;
  border-radius: 999px;
  padding: 10px 20px;
  background: #ffffffa8;
  border: 1px solid #fff;
  box-shadow:
    inset 0 1px 0 #fff,
    0 10px 25px -20px #6d9bc7;
}
.more-people span {
  margin-left: 8px;
}
@keyframes hue-drift {
  to {
    transform: translate(-10%, 16%) rotate(35deg);
  }
}
@keyframes lens-breathe {
  50% {
    transform: scale(1.05);
  }
}
@keyframes orb-rise {
  50% {
    transform: translateY(-8px);
  }
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(15px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (max-width: 1050px) {
  .encounter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 680px) {
  .encounter-hero {
    grid-template-columns: 1fr;
    padding: 26px;
  }
  .encounter-lens {
    width: 215px;
    height: 160px;
    justify-self: end;
    margin-top: -8px;
  }
  .encounter-grid {
    grid-template-columns: 1fr;
  }
  .people-heading {
    display: block;
  }
  .people-heading > span {
    display: block;
    margin-top: 5px;
  }
}
</style>
