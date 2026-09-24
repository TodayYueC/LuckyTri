import { createApp } from "vue";
import App from "./App.vue";
import { toast } from "./api";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

const app = createApp(App);
app.config.errorHandler = (error) => {
  toast(error instanceof Error ? error.message : "操作失败，请重试", true);
};
app.mount("#app");
