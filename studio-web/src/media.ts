import { onBeforeUnmount, ref } from "vue";

export function useMedia(query: string) {
  const list = matchMedia(query);
  const matches = ref(list.matches);
  const update = (event: MediaQueryListEvent) =>
    (matches.value = event.matches);
  list.addEventListener("change", update);
  onBeforeUnmount(() => list.removeEventListener("change", update));
  return matches;
}
