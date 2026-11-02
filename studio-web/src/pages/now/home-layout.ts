import { reactive, watch } from "vue";
import { localized, N_ } from "../../i18n";
import { toast } from "../../api";
import { t } from "../../i18n";

export const HOME_CARDS = localized([
  { id: "profile", label: N_("角色状态") },
  { id: "today", label: N_("今天的 TA") },
  { id: "ahead", label: N_("在等的事") },
  { id: "words", label: N_("TA 最近说") },
  { id: "thought", label: N_("放在心上") },
  { id: "attention", label: N_("还没细看的消息") },
  { id: "budget", label: N_("今天的注意力") },
  { id: "counts", label: N_("TA 的这一生") },
] as const);
export type HomeCard = (typeof HOME_CARDS)[number]["id"];
const KEY = "luckytri-home-layout-v1";
const defaults = () => ({
  order: HOME_CARDS.map((c) => c.id) as HomeCard[],
  hidden: [] as HomeCard[],
  density: "comfortable",
});
function read() {
  const fallback = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden))
      return fallback;
    const valid = (id: unknown): id is HomeCard =>
      fallback.order.includes(id as HomeCard);
    const order = [
      ...new Set<HomeCard>([...saved.order.filter(valid), ...fallback.order]),
    ];
    const hidden = [...new Set<HomeCard>(saved.hidden.filter(valid))];
    return {
      order,
      hidden: hidden.length < order.length ? hidden : [],
      density: saved.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return fallback;
  }
}
export const homeLayout = reactive(read());
watch(homeLayout, (value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    toast(t("无法保存首页布局，请检查浏览器存储权限。"), true);
  }
});
export function resetHome() {
  Object.assign(homeLayout, defaults());
}
export function moveHome(id: HomeCard, delta: number) {
  const index = homeLayout.order.indexOf(id),
    target = index + delta;
  if (target < 0 || target >= homeLayout.order.length) return;
  const next = [...homeLayout.order];
  [next[index], next[target]] = [next[target], next[index]];
  homeLayout.order = next;
}
export function toggleHome(id: HomeCard) {
  if (homeLayout.hidden.includes(id))
    homeLayout.hidden = homeLayout.hidden.filter((key) => key !== id);
  else if (homeLayout.hidden.length < homeLayout.order.length - 1)
    homeLayout.hidden = [...homeLayout.hidden, id];
}
