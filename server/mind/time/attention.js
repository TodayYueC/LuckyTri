// One main activity can coexist with one conversation, never two conversations
// or two activity steps. Waiting on another room does not invent another self.
export class Attention {
  constructor() {
    this.tail = Promise.resolve();
    this.activityBusy = false;
    this.closed = false;
  }
  async chat(run) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (!this.closed) return await run();
    } finally {
      release();
    }
  }
  async activity(run) {
    if (this.activityBusy || this.closed) return null;
    this.activityBusy = true;
    try {
      return await run();
    } finally {
      this.activityBusy = false;
    }
  }
  close() {
    this.closed = true;
  }
}
