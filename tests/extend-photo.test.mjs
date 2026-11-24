import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionFrame, extensionStrip, modelFrame, modelSize } from '../lib/image/extend-photo.js';

test('model and output use disjoint original and generated regions for all four directions', () => {
  for (const [width, height] of [[3000, 4000], [4000, 3000], [1, 9000], [3, 2]]) {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const output = extensionFrame(width, height, side, .2);
      const added = extensionStrip(output, width, height, side);
      assert.equal(width * height + added.width * added.height, output.width * output.height);
      const model = modelFrame(width, height, side, .2);
      const fill = model.result;
      for (const region of [model, fill]) {
        assert.ok(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0);
        assert.ok(region.x + region.width <= modelSize && region.y + region.height <= modelSize);
      }
      if (side === 'left') assert.equal(fill.x + fill.width, model.x);
      if (side === 'right') assert.equal(model.x + model.width, fill.x);
      if (side === 'top') assert.equal(fill.y + fill.height, model.y);
      if (side === 'bottom') assert.equal(model.y + model.height, fill.y);
    }
  }
});
