import test from 'node:test';import assert from 'node:assert/strict';
import {cleanChromaPixels} from '../server/chromaMatte.js';
test('screen removal preserves alpha and neutral subjects without green halos',()=>{
 const pixels=Uint8Array.from([0,255,0,255,30,90,30,255,220,150,100,255,255,255,255,255,20,20,20,255]);
 cleanChromaPixels(pixels,[0,255,0]);assert.equal(pixels[3],0);
 assert.ok(pixels[5]<=Math.max(pixels[4],pixels[6]));
 assert.deepEqual([...pixels.slice(8)],[220,150,100,255,255,255,255,255,20,20,20,255]);
});
test('existing transparent pixels remain transparent',()=>{const p=Uint8Array.from([20,40,20,0]);cleanChromaPixels(p,[0,255,0]);assert.equal(p[3],0)});
