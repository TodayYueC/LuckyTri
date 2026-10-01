import { computed, onActivated, onMounted, watch } from "vue";
import { studio } from "./stores/studio";
import type { Page } from "./router";
import { toast } from "./api";

// Cached pages keep their picture and controls, but only the visible page reads.
export function usePageActivity(page: Page, load: () => Promise<unknown>) {
  let activated = false;
  let running = false,
    again = false;
  const visible = computed(() => studio.page === page);
  const refresh = () => {
    if (!visible.value) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void load()
      .catch((error: Error) => toast(error.message, true))
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  };
  onMounted(refresh);
  onActivated(() => {
    if (activated) refresh();
    activated = true;
  });
  watch(() => [studio.tick, studio.pulse], refresh);
  return visible;
}
