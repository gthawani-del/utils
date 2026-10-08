import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateProject} from '../scripts/validate.mjs';
const sample=JSON.parse(await readFile(new URL('../examples/project.json',import.meta.url),'utf8'));
test('accepts valid demo project',()=>assert.equal(validateProject(sample),sample));
test('rejects word beyond audio timeline',()=>assert.throws(()=>validateProject({...sample,words:[{word:'test',start:0,end:6}]}),/invalid timing/));
test('rejects remote or traversal audio',()=>{for(const audio of ['https://x/a.mp3','../secret.mp3','audio/../secret.mp3'])assert.throws(()=>validateProject({...sample,audio}),/local audio/);});
test('rejects empty words',()=>assert.throws(()=>validateProject({...sample,words:[]}),/bounded list/));
