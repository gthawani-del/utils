import test from 'node:test';
import assert from 'node:assert/strict';
import {linesFromWords,reviseLine,validateLines,chooseDirection,analyzeAudio,imageSceneAt,scriptReviewNote} from '../lib/lyrical/project.js';
import {fitLines} from '../lib/lyrical/renderer.js';
test('only actual bounded word timestamps become lines; mixed scripts survive',()=>{
 const lines=linesFromWords([{text:' तूने',timestamp:[1,1.3]},{text:'game',timestamp:[1.3,1.6]},{text:'खेली।',timestamp:[1.6,2]},{text:'missing',timestamp:[3,null]},{text:'end',timestamp:[4,8]}],5);
 assert.equal(lines[0].text,'तूने game खेली।');assert.equal(lines.length,2);assert.equal(lines[1].end,5);assert.equal(validateLines(lines,5),'');
});
test('editing wording discards stale word timing but retains reviewable line boundaries',()=>{
 const original={text:'old words',start:1,end:2,words:[{text:'old',start:1,end:1.5}],timing:'detected'};
 assert.equal(reviseLine(original,'old words'),original);const edited=reviseLine(original,'new words');
 assert.deepEqual(edited.words,[]);assert.equal(edited.start,1);assert.equal(edited.end,2);assert.equal(edited.timing,'edited');assert.equal(original.words.length,1);
});
test('untimed, overlapping and out-of-song lines cannot be confirmed',()=>{
 assert.match(validateLines([{text:'manual',start:null,end:null}],5),/start and end/);
 assert.match(validateLines([{text:'a',start:0,end:2},{text:'b',start:1,end:3}],5),/overlaps/);
 assert.match(validateLines([{text:'b',start:1,end:6}],5),/start and end/);
});
test('automatic direction responds to lyric pace and audio energy without pretending to infer genre',()=>{
 assert.equal(chooseDirection([{text:'one two three four five six',start:0,end:1}],{duration:10}).style,'bold');
 assert.equal(chooseDirection([{text:'one',start:0,end:4}],{duration:10}).style,'cinematic');
 assert.equal(chooseDirection([{text:'one two three four',start:0,end:2}],{duration:10}).style,'clean');
 const silence=analyzeAudio(new Float32Array(16000),16000);assert.equal(silence.onsets.length,0);assert.ok(silence.envelope.every(n=>Number.isFinite(n)&&n===0));
});
test('images span the full song, including a seek to the exact ending',()=>{
 assert.equal(imageSceneAt(0,12,3).index,0);assert.equal(imageSceneAt(11.99,12,3).index,2);assert.equal(imageSceneAt(12,12,3).index,2);assert.equal(imageSceneAt(4.1,12,3,[{start:4.2}]).index,0);assert.equal(imageSceneAt(4.3,12,3,[{start:4.2}]).index,1);
});
test('long unbroken text wraps without splitting a Devanagari grapheme',()=>{
 const ctx={font:'',measureText(text){const size=Number(this.font.match(/([\d.]+)px/)?.[1]||24);return {width:[...text].length*size*.5};}};
 const word='क्षि'.repeat(40);const result=fitLines(ctx,word,300,'sans-serif',40,600);
 assert.ok(result.lines.every(l=>ctx.measureText(l).width<=300));assert.equal(result.lines.join(''),word);assert.ok(result.lines.every(l=>l.length%4===0));
});

test('wrong-script recognition is flagged while mixed-language text remains allowed',()=>{
 assert.match(scriptReviewNote('hi',[{text:'میں نے دیکھا'}]),/different script/);
 assert.equal(scriptReviewNote('hi',[{text:'तूने game खेली'}]),'');
 assert.equal(scriptReviewNote('en',[{text:'My next move'}]),'');
});
