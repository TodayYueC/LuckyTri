// The only way a plugin page, sealed in its sandbox, may speak to LuckyTri.
// It cannot see the admin token. The studio page makes the request for it,
// and only to this plugin's own routes.
(function () {
  const pending = new Map();
  window.luckytri = {
    request(method, path, body) {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        parent.postMessage(
          { luckytri: 1, id, method, path, body },
          location.origin,
        );
      });
    },
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.luckytri === "theme" && data.css) {
      document.documentElement.setAttribute("style", data.css);
      return;
    }
    const wait = pending.get(data.id);
    if (!wait) return;
    pending.delete(data.id);
    data.ok ? wait.resolve(data.result) : wait.reject(new Error(data.error || "failed"));
  });
})();
