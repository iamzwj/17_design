import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFilmLocations,filmSettingGroups,validateFilmLocations} from '../server/filmLocations.js';
import {editFilmClips,filmClipDuration} from '../shared/filmTimelineEditing.js';
const plan={locations:[{id:'home',masterSceneId:'gate',sceneIds:['gate','hall'],layout:'大门经道路到门厅',anchors:['红砖','灰色大门'],connections:[{from:'gate',to:'hall',description:'向内直行'}]}]};
test('old scenes retain outputs while acquiring shared-location references and deterministic dependency order',()=>{
 const p={scenes:[{id:'gate'},{id:'hall'}],resources:[{id:'hall-environment',output:{file:'hall.png'}},{id:'gate-environment',output:{file:'gate.png'}}],shots:[{sceneId:'hall',resourceIds:['hall-environment']}]};
 applyFilmLocations(p,plan);
 assert.equal(p.resources[0].output.file,'hall.png');
 assert.deepEqual(p.shots[0].resourceIds,['hall-environment','gate-environment']);
 assert.deepEqual(filmSettingGroups(p.resources).map(group=>group.map(r=>r.id)),[['gate-environment'],['hall-environment']]);
 assert.throws(()=>validateFilmLocations({locations:[{...plan.locations[0],sceneIds:['gate']}]},p.scenes));
 assert.throws(()=>filmSettingGroups([{id:'a',dependencies:['b']},{id:'b',dependencies:['a']}]));
});
test('trimming and reordering move manual captions and attached audio with retained source footage',()=>{
 const timeline={captionMode:'manual',clips:[{shotId:'a',trimIn:0,duration:5},{shotId:'b',trimIn:0,duration:5}],captions:[{start:1,end:4,text:'甲'},{start:6,end:8,text:'乙'}],tracks:[{id:'voice',start:6}]};
 const next=editFilmClips(timeline,[{shotId:'b',trimIn:1,duration:4},{shotId:'a',trimIn:2,duration:3}]);
 assert.deepEqual(next.captions,[{start:0,end:2,text:'乙'},{start:4,end:6,text:'甲'}]);
 assert.equal(next.tracks[0].start,0);
 const split=editFilmClips(timeline,[{shotId:'a',trimIn:0,duration:2},{shotId:'a',trimIn:2,duration:3},{shotId:'b',trimIn:0,duration:5}]);
 assert.equal(split.captions.filter(c=>c.text==='甲').reduce((sum,c)=>sum+c.end-c.start,0),3);
 assert.equal(filmClipDuration({duration:5,video:{file:'v'},audio:{source:'v',duration:5.2}}),5.2);
});

test('recovers a saved location plan with named landmarks without calling another model', async () => {
  const {createFilmAgents}=await import('../server/filmAgents.js');
  const {createHash}=await import('node:crypto');
  const scenes=['S1','S2','S3'].map(id=>({id}));
  const key='location-layout-v1-'+createHash('sha256').update(JSON.stringify(scenes)).digest('hex').slice(0,12);
  const route={from:'金属电梯门及轿厢',to:'楼上家门外的楼道口',description:'电梯上行后连接公共楼道'};
  const candidate={locations:[{id:'L1',sceneIds:['S1','S2','S3'],masterSceneId:'S2',layout:'小区入口到家门',anchors:['电梯'],connections:[route]}]};
  const p={scenes,resources:scenes.map(({id})=>({id:id+'-environment',type:'environment'})),shots:[],events:[],tasks:[{
    id:key+':location:v1',agent:'location',input:{name:key},status:'failed',lastStructuredOutput:candidate,
  }]};
  const agents=createFilmAgents({api(){assert.fail('Saved valid plan should be reused');},save(){},check(){}});
  await agents.scenes(p);
  assert.equal(p.tasks[0].status,'succeeded');
  assert.deepEqual(p.locations[0].connections,[]);
  assert.deepEqual(p.locations[0].routeNotes,[route]);
  assert.deepEqual(p.resources[0].dependencies,['S2-environment']);
  assert.match(p.resources[0].locationConstraint,/金属电梯门及轿厢/);
});
