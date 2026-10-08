import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export function validateProject(p) {
 const errors=[];
 for(const k of ['width','height','fps','durationSeconds']) if(!Number.isFinite(p[k])||p[k]<=0)errors.push(k+' must be positive');
 if(p.width>4096||p.height>4096||p.fps>60||p.durationSeconds>600)errors.push('project exceeds safety limits');
 if(!Array.isArray(p.words)||p.words.length===0||p.words.length>8000)errors.push('words must be a nonempty bounded list');
 else for(const [i,w] of p.words.entries()) {
  if(typeof w.word!=='string'||!w.word.trim()||w.word.length>160) errors.push('invalid word '+i);
  if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start||w.end>p.durationSeconds)errors.push('invalid timing '+i);
 }
 if(p.audio && (typeof p.audio!=='string'||p.audio.startsWith('/')||p.audio.includes('..')||p.audio.includes('://')||!/^audio\/[a-zA-Z0-9_.-]+\.(mp3|wav|m4a)$/.test(p.audio))) errors.push('audio must be a local audio/ filename');
 if(p.beats && (!Array.isArray(p.beats)||p.beats.some(t=>!Number.isFinite(t)||t<0||t>p.durationSeconds)))errors.push('invalid beats');
 if(errors.length)throw new Error(errors.join('; '));
 return p;
}
if(process.argv[1] && resolve(process.argv[1])===new URL(import.meta.url).pathname) {
 try {const file=process.argv[2]||'examples/project.json';validateProject(JSON.parse(await readFile(file,'utf8')));console.log('Project validated:',file);}
 catch(e){console.error(e.message);process.exitCode=1;}
}
