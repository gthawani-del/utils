import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepairSettings, calculateFrameSchedule, frameBlendWeight, detectSceneCuts, normalizeCaptionCues } from '../lib/media/video/repair.js';
import { estimateTranslation, smoothCameraOffset } from '../lib/media/video/stabilize.js';
test('repair settings clamp to safe limits', () => {
  const x = normalizeRepairSettings({brightness:4,contrast:0,gain:9,stabilization:2,interpolation:'blend'});
  assert.equal(x.brightness,1.5);
  assert.equal(x.contrast,0.5);
  assert.equal(x.gain,2);
  assert.equal(x.stabilization,1);
  assert.equal(x.interpolation,'blend');
});
test('frame schedule uses exact requested timestamps', () => {
  assert.deepEqual(calculateFrameSchedule(0.1,30),[0,1/30,2/30]);
  assert.equal(frameBlendWeight(0.5,0,1),0.5);
});
test('scene detection finds a strong frame change', () => {
  const black = new Uint8ClampedArray(16);
  const white = new Uint8ClampedArray(16).fill(255);
  assert.deepEqual(detectSceneCuts([{time:0,pixels:black},{time:1,pixels:white}]),[1]);
});
test('caption normalization rejects out of range cues', () => {
  assert.deepEqual(normalizeCaptionCues([{start:0,end:1,text:'Hi'},{start:2,end:5,text:'Too long'}],3),[{start:0,end:1,text:'Hi'}]);
});
test('stabilizer stays neutral on identical flat frames', () => {
  const pixels = new Uint8ClampedArray(64*36*4).fill(100);
  const move = estimateTranslation(pixels,pixels,64,36);
  assert.equal(move.dx,0); assert.equal(move.dy,0);
  assert.deepEqual(smoothCameraOffset({x:0,y:0},0,0),{x:0,y:0});
});
