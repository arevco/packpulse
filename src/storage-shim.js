// Storage shim — maps window.storage to localStorage
// so BOM data persists between sessions in the browser.
window.storage = {
  async get(key) {
    try {
      const val = localStorage.getItem("pp_" + key);
      return val ? { key, value: val } : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem("pp_" + key, value);
      return { key, value };
    } catch {
      return null;
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem("pp_" + key);
      return { key, deleted: true };
    } catch {
      return null;
    }
  },
  async list(prefix) {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith("pp_"))
        .map(k => k.slice(3))
        .filter(k => !prefix || k.startsWith(prefix));
      return { keys };
    } catch {
      return { keys: [] };
    }
  }
};
