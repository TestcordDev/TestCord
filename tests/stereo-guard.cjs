const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),esbuild=require('esbuild');
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
const helper=fs.readFileSync(path.join(__dirname,'../src/testcordplugins/StereoGuard/protection.ts'),'utf8').replace('export class VolumeHold','class VolumeHold');
const source=fs.readFileSync(path.join(__dirname,'../src/testcordplugins/StereoGuard/index.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default definePlugin(','const plugin = definePlugin(');
const code=esbuild.transformSync(helper+'\n'+source+'\nglobalThis.api={poll,settings,meters,mutedByUs,volumeHolds,savedVolume,unmute,plugin};',{loader:'tsx'}).code;

// Levels as the native bridge reports them: L, R, mid and side RMS.
const KINDS={
 mono:{rmsLeft:.3,rmsRight:.3,rmsMid:.3,rmsSide:0},
 left:{rmsLeft:.3,rmsRight:0,rmsMid:.15,rmsSide:.15},
 wide:{rmsLeft:.3,rmsRight:.3,rmsMid:.05,rmsSide:.29},
 reverb:{rmsLeft:.3,rmsRight:.29,rmsMid:.28,rmsSide:.06},
 slightL:{rmsLeft:.3,rmsRight:.2,rmsMid:.25,rmsSide:.05},
 slightR:{rmsLeft:.2,rmsRight:.3,rmsMid:.25,rmsSide:.05},
 quiet:{rmsLeft:.001,rmsRight:0,rmsMid:.0005,rmsSide:.0005},
};

function setup({bridge=true,web=false}={}){
 let now=100000,stamp=0;const volumes=new Map([['alice',175],['bob',100]]),writes=[],saved=new Map(),toasts=[];
 const levels=new Map(),inChannel=new Set(['self','alice','bob']);let connId=1;
 const conn={context:'default'};
 const sandbox={console,Date:{now:()=>now},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,plugins:{},UserAreaButton(){},openPluginModal(){},React:{},Button:{},
  Logger:class{debug(){}warn(){}info(){}error(...args){throw Error(args.join(' '));}},
  DataStore:{set:(k,v)=>{saved.set(k,v);return Promise.resolve();},get:async k=>saved.get(k),del:async k=>saved.delete(k)},
  definePlugin:p=>p,makeRange:(a,b,step=1)=>Array.from({length:Math.floor((b-a)/step)+1},(_,i)=>a+i*step),OptionType:{BOOLEAN:3,SELECT:4,SLIDER:5,STRING:0},
  definePluginSettings:def=>({def,store:Object.fromEntries(Object.entries(def).map(([k,d])=>[k,d.default??d.options?.find(x=>x.default)?.value]))}),
  findByPropsLazy:()=>({setLocalVolume:(id,value)=>{assert(Number.isFinite(value));volumes.set(id,value);writes.push({id,value,at:now});}}),
  MediaEngineStore:{getMediaEngine:()=>({connections:[conn]}),isLocalMute:()=>false,getLocalVolume:id=>volumes.get(id)??100},
  SelectedChannelStore:{getVoiceChannelId:()=>'vc'},
  VoiceStateStore:{getVoiceStatesForChannel:()=>Object.fromEntries([...inChannel].map(id=>[id,{userId:id}]))},
  UserStore:{getCurrentUser:()=>({id:'self'}),getUser:id=>({id})},RelationshipStore:{isFriend:()=>false},showToast:m=>toasts.push(m),Toasts:{Type:{MESSAGE:1}},
  DiscordNative:bridge?{nativeModules:{requireModule:()=>({getParticipantStereoLevels:()=>({installed:true,connection:connId,levels:[...levels].map(([userId,l])=>({userId,channels:2,ageMs:0,...l}))})})}}:undefined,
 };
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const api=sandbox.api;api.settings.store.autoUnmute=3;
 // One poll per 50 ms, like the plugin's interval. Each poll carries a new decoded frame.
 function frame(kind,user='alice'){now+=50;if(kind==='silence')levels.delete(user);else levels.set(user,{...KINDS[kind],rtpTimestamp:++stamp});api.poll();}
 function run(kind,n,user){for(let i=0;i<n;i++)frame(kind,user);}
 function settle(){run('mono',25);}
 return {sandbox,api,volumes,writes,toasts,levels,inChannel,frame,run,settle,now:()=>now,advance:ms=>{now+=ms;},newCall:()=>{connId++;}};
}

test('Centered mono voice is never touched, however long',()=>{const t=setup();t.run('mono',600);assert.equal(t.volumes.get('alice'),175);assert.equal(t.api.mutedByUs.size,0);});
test('Silence and a noise-gated trickle never score',()=>{const t=setup();t.run('quiet',200);t.run('silence',200);assert.equal(t.volumes.get('alice'),175);});
test('Hard panning is silenced on Discord Desktop',()=>{const t=setup();t.settle();t.run('left',5);assert.equal(t.volumes.get('alice'),0);assert(t.toasts.some(m=>/muted alice/.test(m)));});
test('Stereo width with equal channel levels is silenced',()=>{const t=setup();t.settle();t.run('wide',5);assert.equal(t.volumes.get('alice'),0);});
test('Reverb tails over the default threshold are silenced',()=>{const t=setup();t.settle();t.run('reverb',8);assert.equal(t.volumes.get('alice'),0);});
test('Panning around is caught by the swing window',()=>{const t=setup();t.settle();for(let i=0;i<6;i++){t.frame('slightL');t.frame('slightR');}assert.equal(t.volumes.get('alice'),0);});
test('Join grace keeps a new arrival audible for one second',()=>{const t=setup();t.run('left',18);assert.equal(t.volumes.get('alice'),175);t.run('left',6);assert.equal(t.volumes.get('alice'),0);});
test('Short pauses between stereo words do not reset the evidence',()=>{const t=setup();t.api.settings.store.sensitivity=3;t.settle();for(let i=0;i<6;i++){t.run('left',2);t.run('silence',1);}assert.equal(t.volumes.get('alice'),0);});
test('Only the stereo participant is silenced',()=>{const t=setup();t.settle();t.run('mono',20,'bob');for(let i=0;i<6;i++){t.frame('left','alice');t.frame('mono','bob');}assert.equal(t.volumes.get('alice'),0);assert.equal(t.volumes.get('bob'),100);});
test('Sustained stereo stays silenced with no timer reopenings',()=>{const t=setup();t.settle();t.run('left',5);t.run('left',400);assert.equal(t.volumes.get('alice'),0);assert(t.writes.filter(w=>w.id==='alice').every(w=>w.value===0));});
test('Mono after a hold returns the exact baseline volume smoothly',()=>{const t=setup();t.settle();t.run('left',5);t.run('mono',200);assert.equal(t.volumes.get('alice'),175);const ramp=t.writes.filter(w=>w.id==='alice'&&w.value>0&&w.value<175);assert(ramp.length>3);assert(t.toasts.some(m=>/auto-unmuted alice after 3 seconds/.test(m)));});
test('Going silent after a hold also releases it',()=>{const t=setup();t.settle();t.run('left',5);t.run('silence',200);assert.equal(t.volumes.get('alice'),175);});
test('A stereo relapse during recovery closes it again',()=>{const t=setup();t.settle();t.run('left',5);t.run('silence',75);assert(t.volumes.get('alice')>0&&t.volumes.get('alice')<175);t.run('left',2);assert.equal(t.volumes.get('alice'),0);});
test('Auto unmute Off keeps the hold until restored by hand',()=>{const t=setup();t.api.settings.store.autoUnmute=0;t.settle();t.run('left',5);t.run('silence',400);assert.equal(t.volumes.get('alice'),0);t.api.unmute('alice','manual');assert.equal(t.volumes.get('alice'),175);});
test('A manual volume change is respected and not fought for five seconds',()=>{const t=setup();t.settle();t.run('left',5);t.volumes.set('alice',80);t.frame('left');assert.equal(t.api.volumeHolds.size,0);t.run('left',90);assert.equal(t.volumes.get('alice'),80);t.run('left',30);assert.equal(t.volumes.get('alice'),0);});
test('Ignored users are never silenced',()=>{const t=setup();t.sandbox.RelationshipStore.isFriend=()=>true;t.settle();t.run('left',100);assert.equal(t.volumes.get('alice'),175);});
test('MicSpamGuard holding the user keeps its baseline and blocks recovery',()=>{const t=setup();t.sandbox.plugins.MicSpamGuard={isHolding:()=>true,getHeldBaseline:()=>137};t.settle();t.run('left',5);assert.equal(t.api.savedVolume.get('alice'),137);t.run('mono',200);assert.equal(t.volumes.get('alice'),0);});
test('Leaving the call releases the hold',()=>{const t=setup();t.settle();t.run('left',5);t.inChannel.delete('alice');t.levels.delete('alice');t.advance(600);t.frame('silence');assert.equal(t.volumes.get('alice'),175);assert.equal(t.api.volumeHolds.size,0);});
test('A new native connection starts every participant fresh',()=>{const t=setup();t.settle();t.run('left',3);t.newCall();t.run('left',5);assert.equal(t.volumes.get('alice'),175);});
test('Disabling the guard releases everyone silently',()=>{const t=setup();t.settle();t.run('left',5);t.api.settings.store.enabled=false;t.api.settings.def.enabled.onChange();assert.equal(t.volumes.get('alice'),175);});
test('Without the native bridge nothing is measured or silenced',()=>{const t=setup({bridge:false});t.run('left',200);assert.equal(t.api.meters.size,0);assert.equal(t.volumes.get('alice'),175);});
test('Held volumes persist for crash recovery and clear on release',()=>{const t=setup();t.settle();t.run('left',5);assert.equal(t.api.savedVolume.get('alice'),175);t.run('mono',200);assert.equal(t.api.savedVolume.size,0);});
console.log(count+' stereo guard checks passed.');
