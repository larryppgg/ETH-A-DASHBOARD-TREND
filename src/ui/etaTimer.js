export function createEtaTimer() {
  const phases = new Map();

  function start(name, ts = Date.now()) {
    phases.set(name, { start: ts, end: null });
  }

  function end(name, ts = Date.now()) {
    const phase = phases.get(name) || { start: ts, end: null };
    phase.end = ts;
    phases.set(name, phase);
  }

  function totalMs() {
    let total = 0;
    phases.forEach((phase) => {
      if (phase.start != null && phase.end != null) {
        total += Math.max(0, phase.end - phase.start);
      }
    });
    return total;
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms)) return "--";
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${seconds}s`;
  }

  return { start, end, totalMs, formatMs };
}
