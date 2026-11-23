import test from 'node:test';
import assert from 'node:assert/strict';
import {maleUniformAccessory} from '../src/pulinUniformRules.js';
test('male outerwear hides lower tie while summer shirt keeps natural tie',()=>{
 for(const season of ['spring','spring-half','winter','winter-half'])assert.match(maleUniformAccessory(season),/下半段和尖端必须被西装前襟遮住/);
 for(const season of ['summer','summer-half']){assert.match(maleUniformAccessory(season),/衬衫前/);assert.doesNotMatch(maleUniformAccessory(season),/扣好/);}
});
