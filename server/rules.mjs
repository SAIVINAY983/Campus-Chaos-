export function speedBonus(remainingMs, windowMs = 15_000) {
  return Math.max(0, Math.min(500, Math.floor(500 * Math.max(0, remainingMs) / windowMs)));
}

export function bluffDelta(choice, riskCount, bankCount) {
  if (choice === 'BANK') return 300;
  if (choice !== 'RISK') return 0;
  return riskCount < bankCount ? 800 : -400;
}

export function memoryPoints(sequence, answer) {
  const matches = answer.reduce((total, symbol, index) => total + (symbol === sequence[index] ? 1 : 0), 0);
  return matches * 200 + (answer.length === sequence.length && matches === sequence.length ? 500 : 0);
}

export function winnerIds(players) {
  if (players.length === 0) return [];
  const best = players.reduce((top, player) => {
    if (!top || player.score > top.score) return player;
    if (player.score === top.score && player.rounds.memory > top.rounds.memory) return player;
    if (player.score === top.score && player.rounds.memory === top.rounds.memory && player.rounds.quiz > top.rounds.quiz) return player;
    return top;
  }, null);
  return players.filter(player => player.score === best.score && player.rounds.memory === best.rounds.memory && player.rounds.quiz === best.rounds.quiz).map(player => player.id);
}
