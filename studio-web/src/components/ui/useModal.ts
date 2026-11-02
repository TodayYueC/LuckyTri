import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

type Modal = {
  panel: Ref<HTMLElement | undefined>;
  returnTo: HTMLElement | null;
  layer: HTMLElement | null;
  previousZ: string;
};
const stack: Modal[] = [];
let layerOrder = 80;
const focusable =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
const visible = (el: HTMLElement) =>
  el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility !== "hidden" &&
  !el.closest('[inert],[aria-hidden="true"]');

/** One focus boundary and Escape target, even for a dialog inside a sheet. */
export function useModal(
  open: Ref<boolean>,
  panel: Ref<HTMLElement | undefined>,
  close: () => void,
) {
  const entry: Modal = { panel, returnTo: null, layer: null, previousZ: "" };
  const top = () => stack.at(-1) === entry;
  function key(event: KeyboardEvent) {
    if (!top() || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab" && panel.value) {
      const choices = [
        ...panel.value.querySelectorAll<HTMLElement>(focusable),
      ].filter((el) => el.tabIndex >= 0 && visible(el));
      const first = choices[0],
        last = choices.at(-1),
        current = document.activeElement;
      if (!first) {
        event.preventDefault();
        panel.value.focus();
      } else if (
        event.shiftKey &&
        (current === first ||
          current === panel.value ||
          !panel.value.contains(current))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (current === last || !panel.value.contains(current))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  function release() {
    const index = stack.indexOf(entry);
    if (index < 0) return;
    const wasTop = top();
    stack.splice(index, 1);
    if (!stack.length) layerOrder = 80;
    document.removeEventListener("keydown", key);
    if (entry.layer) entry.layer.style.zIndex = entry.previousZ;
    entry.layer = null;
    const target = entry.returnTo;
    const parent = stack.at(-1)?.panel.value;
    if (
      wasTop &&
      target?.isConnected &&
      visible(target) &&
      (!parent || parent.contains(target))
    )
      target.focus({ preventScroll: true });
    else if (wasTop) parent?.focus({ preventScroll: true });
  }
  watch(
    open,
    async (show) => {
      if (!show) {
        release();
        return;
      }
      entry.returnTo = document.activeElement as HTMLElement | null;
      stack.push(entry);
      document.addEventListener("keydown", key);
      await nextTick();
      if (!open.value || !top() || !panel.value) return;
      const layer = panel.value.closest<HTMLElement>(
        ".sheet-layer,.dialog-layer,.companion",
      );
      if (layer) {
        entry.layer = layer;
        entry.previousZ = layer.style.zIndex;
        layer.style.zIndex = String((layerOrder += 2));
      }
      const target = panel.value.querySelector<HTMLElement>("[autofocus]");
      (target || panel.value).focus({ preventScroll: true });
    },
    { immediate: true },
  );
  onBeforeUnmount(release);
}
