export function normalizeCleanup(input={}) {
  const strokes=Array.isArray(input.strokes)?input.strokes.slice(0,100).map(normalizeStroke).filter((stroke)=>stroke.points.length):[];
  return { enabled:Boolean(input.enabled)&&strokes.length>0, strokes };
}
export function cleanupHasMask(input={}) { const cleanup=normalizeCleanup(input); return cleanup.enabled&&cleanup.strokes.length>0; }
function normalizeStroke(input={}) { const radius=clamp(input.radius,.001,.12,.02); const points=Array.isArray(input.points)?input.points.slice(0,600).map((point)=>({x:clamp(point?.x,0,1,0),y:clamp(point?.y,0,1,0)})):[]; return {radius,points}; }
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
