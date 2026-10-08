import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateProject} from './validate.mjs';

const args=process.argv.slice(2);
const pick=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const projectFile=resolve(pick('--project','examples/project.json'));
const outputFile=resolve(pick('--out','out/hero-proof.mp4'));
const root=resolve(new URL('../',import.meta.url).pathname);
if(!relative(root,outputFile).startsWith('out/'))throw new Error('Output must be inside lyric-motion-renderer/out/');
const project=validateProject(JSON.parse(await readFile(projectFile,'utf8')));
await mkdir(dirname(outputFile),{recursive:true});
const props=JSON.stringify({project});
const res=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['remotion','render','src/index.ts','LyricHero',outputFile,'--props',props,'--codec','h264'],{cwd:root,stdio:'inherit'});
if(res.error)throw res.error;
if(res.status!==0)process.exit(res.status||1);
await writeFile(outputFile+'.manifest.json',JSON.stringify({project:projectFile,output:outputFile,width:project.width,height:project.height,fps:project.fps,durationSeconds:project.durationSeconds,audioIncluded:!!project.audio,wordCount:project.words.length},null,2));
console.log('Rendered:',outputFile);
