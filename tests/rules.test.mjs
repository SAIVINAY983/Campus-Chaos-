import test from 'node:test';
import assert from 'node:assert/strict';
import {bluffDelta, memoryPoints, speedBonus, winnerIds} from '../server/rules.mjs';

test('speed bonus is clamped to 0–500 and rewards remaining time', () => {
  assert.equal(speedBonus(15_000), 500);
  assert.equal(speedBonus(7_500), 250);
  assert.equal(speedBonus(0), 0);
  assert.equal(speedBonus(-1_000), 0);
  assert.equal(speedBonus(30_000), 500);
});

test('Bluff or Bank applies strict minority rules, including 2-player outcomes', () => {
  assert.equal(bluffDelta('BANK', 0, 2), 300);
  assert.equal(bluffDelta('BANK', 1, 1), 300);
  assert.equal(bluffDelta('RISK', 1, 1), -400);
  assert.equal(bluffDelta('RISK', 2, 0), -400);
  assert.equal(bluffDelta('RISK', 1, 2), 800);
  assert.equal(bluffDelta(undefined, 0, 2), 0);
});

test('Memory awards exact positions and a perfect-sequence bonus only', () => {
  assert.equal(memoryPoints(['🔵','🟣','🟡'], ['🔵','🟣','🟡']), 1_100);
  assert.equal(memoryPoints(['🔵','🟣','🟡'], ['🔵','🟡','🟡']), 400);
  assert.equal(memoryPoints(['🔵','🟣','🟡'], ['🔵']), 200);
});

test('ties break by Memory, then Quiz, then remain shared', () => {
  const players=[
    {id:'a',score:1000,rounds:{memory:200,quiz:600}},
    {id:'b',score:1000,rounds:{memory:400,quiz:100}},
    {id:'c',score:1000,rounds:{memory:400,quiz:500}},
  ];
  assert.deepEqual(winnerIds(players),['c']);
  players[2].rounds.quiz=100;
  assert.deepEqual(winnerIds(players),['b','c']);
});
