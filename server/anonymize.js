export function makeSeededRandom(seed = 'llm-council') {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function anonymizeResponses(responses, seedOrRandom) {
  const random = typeof seedOrRandom === 'function' ? seedOrRandom : makeSeededRandom(seedOrRandom);
  const shuffled = [...responses];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((response, index) => ({
    ...response,
    anonymousId: `Response ${String.fromCharCode(65 + index)}`
  }));
}
