import { reactive } from "vue";
import homeWallpaper from "./assets/luckytri-home.jpeg";

const DB_NAME = "luckytri-wallpapers";
const STORE = "files";
const OPACITY_KEY = "luckytri-sky-opacity-v1";
const DEFAULT_OPACITY = 0.22;
const CUSTOM_OPACITY = 0.4;

export const wallpapers = reactive({
  hero: homeWallpaper,
  sky: "",
  skyOpacity: readOpacity(),
});

let loading: Promise<void> | null = null;

function readOpacity() {
  try {
    const saved = Number(localStorage.getItem(OPACITY_KEY));
    if (!Number.isFinite(saved)) return DEFAULT_OPACITY;
    return clampOpacity(saved);
  } catch {
    return DEFAULT_OPACITY;
  }
}

function clampOpacity(value: number) {
  return Math.min(0.82, Math.max(0.08, value));
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readBlob(key: string) {
  return openDb().then(
    (db) =>
      new Promise<Blob | null>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve((request.result as Blob) || null);
        request.onerror = () => reject(request.error);
      }),
  );
}

function writeBlob(key: string, blob: Blob | null) {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const store = db.transaction(STORE, "readwrite").objectStore(STORE);
        const request = blob ? store.put(blob, key) : store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
  );
}

function useBlob(kind: "hero" | "sky", blob: Blob | null) {
  const previous = wallpapers[kind];
  if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
  wallpapers[kind] = blob ? URL.createObjectURL(blob) : kind === "hero" ? homeWallpaper : "";
}

async function fitImage(file: File, maxEdge: number) {
  if (!file.type.startsWith("image/")) throw Error("请选择一张图片");
  if (file.size > 20 * 1024 * 1024) throw Error("图片太大了，请换一张 20MB 以内的");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("无法处理这张图片");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob) throw Error("无法处理这张图片");
    return blob;
  } catch (error) {
    if (error instanceof Error && error.message !== "请选择一张图片") {
      if (file.size <= 6 * 1024 * 1024) return file;
    }
    throw error instanceof Error ? error : Error("无法处理这张图片");
  }
}

export function loadWallpapers() {
  loading ??= (async () => {
    try {
      const [hero, sky] = await Promise.all([readBlob("hero"), readBlob("sky")]);
      if (hero) useBlob("hero", hero);
      if (sky) useBlob("sky", sky);
    } catch {
      // Keep the built-in pictures if this browser cannot store one.
    }
  })();
  return loading;
}

export async function setHeroWallpaper(file: File) {
  const blob = await fitImage(file, 1600);
  await writeBlob("hero", blob);
  useBlob("hero", blob);
}

export async function resetHeroWallpaper() {
  await writeBlob("hero", null);
  useBlob("hero", null);
}

export async function setSkyWallpaper(file: File) {
  const blob = await fitImage(file, 1920);
  await writeBlob("sky", blob);
  useBlob("sky", blob);
  let saved = null;
  try {
    saved = localStorage.getItem(OPACITY_KEY);
  } catch {
    saved = null;
  }
  if (!saved) setSkyOpacity(CUSTOM_OPACITY);
}

export async function resetSkyWallpaper() {
  await writeBlob("sky", null);
  useBlob("sky", null);
}

export function setSkyOpacity(value: number) {
  const next = clampOpacity(value);
  wallpapers.skyOpacity = next;
  try {
    localStorage.setItem(OPACITY_KEY, String(next));
  } catch {
    // The slider still works for this visit.
  }
}
