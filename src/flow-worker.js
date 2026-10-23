import { computeFlow } from './flow.js';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const flow = computeFlow(job);
    self.postMessage({ id, flow }, [flow.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
