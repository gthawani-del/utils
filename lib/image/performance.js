export const PERFORMANCE_FORMATS = Object.freeze(['avif','webp','jpeg']);

export function normalizePerformanceBudget(input = {}) {
  return {
    maxWidth: clampInt(input.maxWidth, 64, 12000, 1920),
    maxBytes: clampInt(input.maxBytes, 8 * 1024, 60 * 1024 * 1024, 180 * 1024),
    minQuality: clamp(input.minQuality, .1, .95, .5)
  };
}

export function performanceCandidateWidths(startWidth) {
  const start = Math.max(64, Math.round(Number(startWidth) || 1920));
  const factors = [1, .85, .7, .55, .4, .3];
  const widths = factors.map((factor) => Math.max(64, Math.round(start * factor)));
  return [...new Set(widths)].sort((a,b) => b-a);
}

export function chooseBudgetCandidate(candidates, inputBudget = {}) {
  const budget = normalizePerformanceBudget(inputBudget);
  const valid = (Array.isArray(candidates) ? candidates : []).filter((candidate) =>
    candidate && Number(candidate.width) <= budget.maxWidth &&
    Number(candidate.size) <= budget.maxBytes &&
    Number(candidate.quality) >= budget.minQuality
  );
  valid.sort((a,b) => {
    if (b.width !== a.width) return b.width - a.width;
    if (b.quality !== a.quality) return b.quality - a.quality;
    if (a.size !== b.size) return a.size - b.size;
    return formatRank(b.kind) - formatRank(a.kind);
  });
  return valid[0] || null;
}

function formatRank(kind) { return kind === 'avif' ? 3 : kind === 'webp' ? 2 : kind === 'jpeg' ? 1 : 0; }
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function clampInt(value,min,max,fallback){return Math.round(clamp(value,min,max,fallback));}
