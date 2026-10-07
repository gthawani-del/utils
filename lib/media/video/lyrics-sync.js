// Local timed lyrics importer. LRC timestamps are preserved; no speech recognition is implied.
export function parseLrc(input, duration = Infinity) {
  const result = [];
  for (const line of String(input || '').split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = line.replace(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g, '').trim();
    if (!text) continue;
    for (const match of matches) {
      const start = Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || '0'));
      if (Number.isFinite(start) && start >= 0 && start < duration) result.push({ text, start });
    }
  }
  result.sort((a,b) => a.start-b.start);
  return result.map((item,i) => ({ ...item, end: Math.min(duration, result[i+1]?.start ?? item.start+3) })).filter(item => item.end > item.start);
}
export function lyricCuesFromLrc(input, duration) {
  return parseLrc(input, duration).map(item => {
    const words = item.text.split(/\s+/).filter(Boolean);
    const span = (item.end-item.start)/Math.max(1,words.length);
    return { ...item, template:'rhythm', effect:'pulse', beatReactive:true, words:words.map((text,i)=>({text,start:item.start+i*span,end:item.start+(i+1)*span})) };
  });
}
