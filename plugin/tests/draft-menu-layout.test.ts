import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftMenuGeometry} from '../client/draft-menu-layout.mjs';

test('top vault composer exposes the full native command menu below its card',()=>{
  assert.deepEqual(draftMenuGeometry({top:140,bottom:270,height:130},800),{top:'134px',bottom:'auto',maxHeight:'400px'});
});
test('a low or scrolled composer fits the native menu upward and bounds small viewports',()=>{
  assert.deepEqual(draftMenuGeometry({top:600,bottom:730,height:130},800),{top:'auto',bottom:'calc(100% + 4px)',maxHeight:'400px'});
  const small=draftMenuGeometry({top:100,bottom:230,height:130},330);
  assert.equal(small.maxHeight,'84px');
  assert.equal(small.top,'134px');
});
