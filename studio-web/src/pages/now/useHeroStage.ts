import { computed, ref } from "vue";
import { toast } from "../../api";

const WALLPAPER_KEY = "luckytri-home-wallpaper-position-v3";

function readPoint(
  key: string,
  limits: { x: [number, number]; y: [number, number] },
) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y))
      return null;
    return {
      x: Math.min(limits.x[1], Math.max(limits.x[0], saved.x)),
      y: Math.min(limits.y[1], Math.max(limits.y[0], saved.y)),
    };
  } catch {
    return null;
  }
}

function remember(key: string, value: unknown, failure: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast(failure, true);
    return false;
  }
}

// The home picture can be reframed. The position stays in this browser.
export function useHeroStage() {
  const adjusting = ref(false);
  const heroRef = ref<HTMLElement | null>(null);
  const imageRef = ref<HTMLImageElement | null>(null);
  const picture = ref(
    readPoint(WALLPAPER_KEY, { x: [0, 100], y: [0, 100] }) || { x: 50, y: 50 },
  );
  const pictureStyle = computed(() => ({
    objectPosition: `${picture.value.x}% ${picture.value.y}%`,
  }));

  const pictureDrag = ref<{
    pointerId: number;
    startX: number;
    startY: number;
    startPositionX: number;
    startPositionY: number;
    overflowX: number;
    overflowY: number;
  } | null>(null);

  function beginPictureDrag(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement;
    const image = imageRef.value;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    const rect = element.getBoundingClientRect();
    const scale = Math.max(
      rect.width / image.naturalWidth,
      rect.height / image.naturalHeight,
    );
    pictureDrag.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPositionX: picture.value.x,
      startPositionY: picture.value.y,
      overflowX: Math.max(0, image.naturalWidth * scale - rect.width),
      overflowY: Math.max(0, image.naturalHeight * scale - rect.height),
    };
    element.setPointerCapture(event.pointerId);
  }

  function movePicture(event: PointerEvent) {
    const drag = pictureDrag.value;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.overflowX > 0) {
      picture.value.x = Math.min(
        100,
        Math.max(
          0,
          drag.startPositionX -
            ((event.clientX - drag.startX) / drag.overflowX) * 100,
        ),
      );
    }
    if (drag.overflowY > 0) {
      picture.value.y = Math.min(
        100,
        Math.max(
          0,
          drag.startPositionY -
            ((event.clientY - drag.startY) / drag.overflowY) * 100,
        ),
      );
    }
  }

  function endPictureDrag(event: PointerEvent) {
    if (pictureDrag.value?.pointerId === event.pointerId)
      pictureDrag.value = null;
  }

  function resetPicture() {
    picture.value = { x: 50, y: 50 };
  }

  function finishPicture() {
    if (remember(WALLPAPER_KEY, picture.value, "浏览器没有保存这次构图")) {
      adjusting.value = false;
      pictureDrag.value = null;
      toast("首页壁纸构图已记住");
    }
  }

  return {
    adjusting,
    heroRef,
    imageRef,
    pictureStyle,
    beginPictureDrag,
    movePicture,
    endPictureDrag,
    resetPicture,
    finishPicture,
  };
}
