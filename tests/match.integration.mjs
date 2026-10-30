import assert from 'node:assert/strict';

const endpoint = process.env.GAME_URL || 'http://localhost:8888/.netlify/functions/game';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function request(action, session, extra = {}) {
  const response = await fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...(session||{}),...extra})});
  const data = await response.json();
  if (!response.ok) throw new Error(`${action} failed: ${data.error}`);
  return data;
}
async function waitFor(session, predicate, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    const result = await request('state', session);
    last = result.state;
    if (predicate(result.state)) return result.state;
    await pause(60);
  }
  throw new Error(`Timed out waiting for game phase; last state: ${last?.phase} ${last?.question?.index ?? ''} ${last?.level ?? ''}`);
}

const hostJoin = await request('create', null, {name:'Host'});
const host = {code:hostJoin.state.code,playerId:hostJoin.playerId,token:hostJoin.token};
const guestJoin = await request('join', null, {code:host.code,name:'Guest'});
const guest = {code:host.code,playerId:guestJoin.playerId,token:guestJoin.token};
assert.equal(guestJoin.state.players.length, 2, 'second independent session joins the shared room');
assert.equal((await request('state', guest)).state.players.length, 2, 'second session can reconnect and read shared state');
await request('start', host);

const correct = [1,2,3,1,2];
for (let i=0;i<5;i++) {
  await waitFor(host, s => s.phase === 'quiz' && s.question.index === i+1);
  await request('quiz', host, {answer:correct[i]});
  if (i===0) {
    const duplicate = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'quiz',...host,answer:correct[i]})});
    assert.equal(duplicate.status,400,'duplicate quiz submission is rejected');
  }
  await request('quiz', guest, {answer:0});
}
const bluff = await waitFor(host, s => s.phase === 'bluff');
assert.equal(bluff.players.find(p=>p.id===host.playerId).score > 0,true,'quiz points synchronize');
await request('risk',host,{choice:'RISK'});
const privateState=await request('state',guest);
assert.equal(privateState.state.players.find(p=>p.id===host.playerId).choice,undefined,'another player cannot see a private choice before reveal');
await request('risk',guest,{choice:'BANK'});
let show=await waitFor(host,s=>s.phase==='memory-show'&&s.level===1);
for(let level=0;level<3;level++){
  const sequence=show.sequence;
  const input=await waitFor(host,s=>s.phase==='memory-input'&&s.level===level+1);
  assert.equal(input.sequence,undefined,'memory sequence is hidden during response');
  await request('memory',host,{answer:sequence});
  await request('memoryDraft',guest,{answer:sequence.slice(0,1)});
  if(level<2)show=await waitFor(host,s=>s.phase==='memory-show'&&s.level===level+2);
}
const results=await waitFor(host,s=>s.phase==='results',20_000);
const winner=results.players.find(p=>p.id===(results.winnerIds||[])[0]);
const hostFinal=results.players.find(p=>p.id===host.playerId);
const guestFinal=results.players.find(p=>p.id===guest.playerId);
assert.ok(hostFinal.rounds.quiz>=2500 && hostFinal.rounds.quiz<=5000,'quiz scoring stays within the agreed base and speed bounds');
assert.equal(hostFinal.rounds.bluff,-400,'strict RISK minority fails for a 2-player RISK + BANK outcome');
assert.equal(guestFinal.rounds.bluff,300,'BANK scores 300 against RISK in a 2-player game');
assert.equal(hostFinal.rounds.memory,5100,'perfect memory levels earn accuracy points and three perfect bonuses');
assert.equal(guestFinal.rounds.memory,600,'timed-out partial memory drafts earn only correctly entered positions');
assert.equal(winner?.id,host.playerId,'complete match announces the correctly scored winner');
await request('again',host);
const rematch=await request('state',guest);
assert.equal(rematch.state.phase,'lobby','host can reset the completed room for a rematch');
assert.ok(rematch.state.players.every(p=>p.score===0),'rematch resets scores without changing the roster');
const idleJoin=await request('create',null,{name:'IdleHost'});
const idleHost={code:idleJoin.state.code,playerId:idleJoin.playerId,token:idleJoin.token};
await request('join',null,{code:idleHost.code,name:'IdleGuest'});
const idleStart=await request('start',idleHost);
await pause((idleStart.state.deadline-idleStart.state.serverNow)*2+500);
const afterDisconnect=await request('state',idleHost);
assert.equal(afterDisconnect.state.question.index,3,'timers advance through disconnected players’ unanswered questions');
assert.ok(afterDisconnect.state.players.every(p=>p.score===0),'unanswered questions do not award points after reconnect');
console.log(JSON.stringify({code:host.code,players:results.players.map(p=>({name:p.name,score:p.score,rounds:p.rounds})),winner:winner?.name,phases:['lobby','quiz','bluff','memory-show/input','results','rematch'],duplicateRejected:true,privateChoicesVerified:true,reconnectRead:true,disconnectTimersVerified:true},null,2));
