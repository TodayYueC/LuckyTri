export class ConversationManager {
  constructor(run, { windowMs = 1200, maxWaitMs = 4000 } = {}) {
    this.run = run;
    this.windowMs = windowMs;
    this.maxWaitMs = maxWaitMs;
    this.lanes = new Map();
    this.closed = false;
  }
  enqueue(m, policy = {}) {
    if (this.closed) return;
    let lane = this.lanes.get(m.sessionId);
    if (!lane) {
      lane = { pending: [], running: false, first: Date.now() };
      this.lanes.set(m.sessionId, lane);
    }
    if (!lane.pending.length) lane.first = Date.now();
    lane.pending.push(m);
    clearTimeout(lane.timer);
    const delay = Math.max(
      0,
      Math.min(
        policy.aggregateMs ?? this.windowMs,
        (policy.maxWaitMs ?? this.maxWaitMs) - (Date.now() - lane.first),
      ),
    );
    lane.timer = setTimeout(() => this.flush(m.sessionId), delay);
  }
  async flush(session) {
    const lane = this.lanes.get(session);
    if (!lane || lane.running || !lane.pending.length || this.closed) return;
    clearTimeout(lane.timer);
    lane.running = true;
    const batch = lane.pending.splice(0);
    try {
      await this.run(session, batch);
    } finally {
      lane.running = false;
      if (lane.pending.length && !this.closed)
        lane.timer = setTimeout(() => this.flush(session), this.windowMs);
      else this.lanes.delete(session);
    }
  }
  retain(session, batch) {
    const lane = this.lanes.get(session);
    if (!lane || this.closed) return;
    lane.pending = [
      ...new Map([...batch, ...lane.pending].map((m) => [m.seq, m])).values(),
    ].sort((a, b) => a.seq - b.seq);
  }
  clear(session) {
    const lane = this.lanes.get(session);
    if (!lane) return;
    clearTimeout(lane.timer);
    lane.pending = [];
    if (!lane.running) this.lanes.delete(session);
  }
  close() {
    this.closed = true;
    for (const lane of this.lanes.values()) clearTimeout(lane.timer);
  }
}
