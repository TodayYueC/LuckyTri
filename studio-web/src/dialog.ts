import { reactive } from "vue";

interface Request {
  kind: "confirm" | "prompt";
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  secret: boolean;
  placeholder: string;
  value: string;
  resolve: (value: string | null) => void;
}

interface Options {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  secret?: boolean;
  placeholder?: string;
  value?: string;
}

// One at a time, in order: a token prompt and a confirm never collide.
export const dialogs = reactive({ queue: [] as Request[] });

function open(kind: Request["kind"], message: string, options: Options) {
  return new Promise<string | null>((resolve) =>
    dialogs.queue.push({
      kind,
      message,
      title: options.title ?? (kind === "confirm" ? "想确认一下" : "请填写"),
      confirmText: options.confirmText ?? "确定",
      cancelText: options.cancelText ?? "取消",
      danger: Boolean(options.danger),
      secret: Boolean(options.secret),
      placeholder: options.placeholder ?? "",
      value: options.value ?? "",
      resolve,
    }),
  );
}

export async function ask(message: string, options: Options = {}) {
  return (await open("confirm", message, options)) !== null;
}

export function askText(message: string, options: Options = {}) {
  return open("prompt", message, options);
}

export function settle(value: string | null) {
  dialogs.queue.shift()?.resolve(value);
}
