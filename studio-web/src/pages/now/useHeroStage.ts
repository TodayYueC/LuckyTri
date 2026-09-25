import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { toast } from "../../api";
import { useMedia } from "../../media";

const WALLPAPER_KEY = "luckytri-home-wallpaper-position-v3";
const ORB_KEY = "luckytri-home-orb-position-v2";

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

// The home picture can be reframed, and the orb can be dragged. Both positions
// stay in this browser.
export function useHeroStage() {
  const narrow = useMedia("(max-width: 760px)");
  const adjusting = ref(false);
  const heroRef = ref<HTMLElement | null>(null);
  const imageRef = ref<HTMLImageElement | null>(null);
  const orbRef = ref<{ cancel: () => void } | null>(null);
  const picture = ref({ x: 50, y: 50 });
  const orb = ref({ x: 16, y: 84 });
  const orbDragging = ref(false);
  const pictureStyle = computed(() => ({
    objectPosition: `${picture.value.x}% ${picture.value.y}%`,
  }));
  const orbStyle = computed(() => ({
    left: `${orb.value.x}%`,
    top: `${orb.value.y}%`,
    width: `${narrow.value ? 176 : 250}px`,
    height: `${narrow.value ? 176 : 250}px`,
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
  const orbDrag = ref<{
    pointerId: number;
    startX: number;
    startY: number;
    startPositionX: number;
    startPositionY: number;
    moved: boolean;
  } | null>(null);

  function beginOrbDrag(event: PointerEvent) {
    if (event.button > 0 || !event.isPrimary || adjusting.value) return;
    orbDrag.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPositionX: orb.value.x,
      startPositionY: orb.value.y,
      moved: false,
    };
    window.addEventListener("pointermove", moveOrb, { passive: false });
    window.addEventListener("pointerup", endOrbDrag);
    window.addEventListener("pointercancel", endOrbDrag);
  }

  function moveOrb(event: PointerEvent) {
    const drag = orbDrag.value;
    const bounds = heroRef.value?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    if (!drag.moved) {
      drag.moved = true;
      orbDragging.value = true;
      orbRef.value?.cancel();
    }
    event.preventDefault();
    const size = narrow.value ? 176 : 250;
    const marginX = ((size / 2 + 10) / bounds.width) * 100;
    const marginY = ((size / 2 + 10) / bounds.height) * 100;
    orb.value = {
      x: Math.min(
        100 - marginX,
        Math.max(marginX, drag.startPositionX + (dx / bounds.width) * 100),
      ),
      y: Math.min(
        100 - marginY,
        Math.max(marginY, drag.startPositionY + (dy / bounds.height) * 100),
      ),
    };
  }

  function endOrbDrag(event: PointerEvent) {
    const drag = orbDrag.value;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", moveOrb);
    window.removeEventListener("pointerup", endOrbDrag);
    window.removeEventListener("pointercancel", endOrbDrag);
    orbDrag.value = null;
    orbDragging.value = false;
    if (!drag.moved) return;
    remember(ORB_KEY, orb.value, "TA 的位置只在这次打开期间生效");
  }

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

  onMounted(() => {
    const savedPicture = readPoint(WALLPAPER_KEY, {
      x: [0, 100],
      y: [0, 100],
    });
    const savedOrb = readPoint(ORB_KEY, { x: [10, 90], y: [20, 80] });
    if (savedPicture) picture.value = savedPicture;
    if (savedOrb) orb.value = savedOrb;
  });
  onBeforeUnmount(() => {
    window.removeEventListener("pointermove", moveOrb);
    window.removeEventListener("pointerup", endOrbDrag);
    window.removeEventListener("pointercancel", endOrbDrag);
  });

  return {
    adjusting,
    heroRef,
    imageRef,
    orbRef,
    pictureStyle,
    orbStyle,
    orbDragging,
    orbSize: computed(() => (narrow.value ? 176 : 250)),
    beginOrbDrag,
    beginPictureDrag,
    movePicture,
    endPictureDrag,
    resetPicture,
    finishPicture,
  };
}
