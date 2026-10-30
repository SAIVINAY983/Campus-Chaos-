// server/game.ts
import { getStore } from "@netlify/blobs";

// server/rules.mjs
function speedBonus(remainingMs, windowMs = 15e3) {
  return Math.max(0, Math.min(500, Math.floor(500 * Math.max(0, remainingMs) / windowMs)));
}
function bluffDelta(choice, riskCount, bankCount) {
  if (choice === "BANK") return 300;
  if (choice !== "RISK") return 0;
  return riskCount < bankCount ? 800 : -400;
}
function memoryPoints(sequence, answer) {
  const matches = answer.reduce((total, symbol, index) => total + (symbol === sequence[index] ? 1 : 0), 0);
  return matches * 200 + (answer.length === sequence.length && matches === sequence.length ? 500 : 0);
}
function winnerIds(players) {
  if (players.length === 0) return [];
  const best = players.reduce((top, player) => {
    if (!top || player.score > top.score) return player;
    if (player.score === top.score && player.rounds.memory > top.rounds.memory) return player;
    if (player.score === top.score && player.rounds.memory === top.rounds.memory && player.rounds.quiz > top.rounds.quiz) return player;
    return top;
  }, null);
  return players.filter((player) => player.score === best.score && player.rounds.memory === best.rounds.memory && player.rounds.quiz === best.rounds.quiz).map((player) => player.id);
}

// server/game.ts
var store = getStore({ name: "campus-chaos-rooms", consistency: "strong" });
var QUIZ = [
  { q: "Which campus spot is most likely to become an unofficial study hall?", a: ["The cafeteria", "The library", "The parking lot", "The gym"], correct: 1 },
  { q: "What does a syllabus usually contain?", a: ["Only final grades", "Campus map", "Course plan and policies", "Lunch menu"], correct: 2 },
  { q: "Which is the best first move when a group project stalls?", a: ["Ghost the group", "Start a new group chat", "Wait until finals", "Agree on one small next step"], correct: 3 },
  { q: "A 9 AM lecture starts at\u2026", a: ["Whenever the coffee hits", "9:00 AM", "10:00 AM", "Next semester"], correct: 1 },
  { q: "Which item is most useful during a surprise all-nighter?", a: ["A megaphone", "A beach ball", "Water", "A foghorn"], correct: 2 }
];
var SYMBOLS = ["\u{1F535}", "\u{1F7E3}", "\u{1F7E1}", "\u{1F7E2}", "\u{1F53A}", "\u2B50", "\u{1F4A0}", "\u{1F7E0}"];
var response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
var fail = (message, status = 400) => response({ error: message }, status);
var rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
var scaled = (ms) => {
  const localDev = process.env.NETLIFY_DEV === "true" || process.env.CONTEXT === "dev";
  const factor = localDev ? Math.min(1, Math.max(0.01, Number(process.env.CAMPUS_CHAOS_TIMER_SCALE) || 1)) : 1;
  return Math.max(25, Math.round(ms * factor));
};
var makeCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[rand(32)]).join("");
var cleanName = (value) => typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, 18) : "";
var awardMemory = (room, p, answer) => {
  const points = memoryPoints(room.sequence, answer);
  p.score += points;
  p.rounds.memory += points;
  p.memoryAnswers[String(room.memoryLevel)] = answer;
  room.memorySubmissions.push(p.id);
};
var settleMemory = (room) => {
  for (const p of room.players) if (!room.memorySubmissions.includes(p.id)) awardMemory(room, p, p.memoryDrafts[String(room.memoryLevel)] || []);
};
var readRoom = async (code) => {
  const entry = await store.getWithMetadata(`room:${code}`, { consistency: "strong" });
  if (!entry) return null;
  const room = JSON.parse(entry.data);
  if (Date.now() - room.updatedAt > 24 * 60 * 60 * 1e3) {
    await store.delete(`room:${code}`);
    return null;
  }
  return { room, etag: entry.etag };
};
var writeRoom = async (room, etag) => {
  const result = etag ? await store.setJSON(`room:${room.code}`, room, { onlyIfMatch: etag }) : await store.setJSON(`room:${room.code}`, room, { onlyIfNew: true });
  return result?.modified ?? true;
};
function advance(room, now) {
  for (let step = 0; step < 16 && room.phase !== "results" && room.deadline > 0 && now >= room.deadline; step++) {
    const boundary = room.deadline;
    if (room.phase === "quiz") {
      room.question++;
      if (room.question >= QUIZ.length) {
        room.phase = "bluff";
        room.deadline = boundary + scaled(12e3);
        room.players.forEach((p) => p.risk = void 0);
        room.event = "Bluff or Bank is open";
      } else {
        room.deadline = boundary + scaled(15e3);
        room.quizSubmissions = [];
        room.event = `Question ${room.question + 1} of ${QUIZ.length}`;
      }
    } else if (room.phase === "bluff") {
      const risks = room.players.filter((p) => p.risk === "RISK").length;
      const banks = room.players.filter((p) => p.risk === "BANK").length;
      for (const p of room.players) {
        const delta = bluffDelta(p.risk, risks, banks);
        p.score += delta;
        p.rounds.bluff += delta;
      }
      room.phase = "memory-show";
      room.memoryLevel = 0;
      room.sequence = Array.from({ length: 4 }, () => SYMBOLS[rand(SYMBOLS.length)]);
      room.deadline = boundary + scaled(4e3);
      room.memorySubmissions = [];
      room.event = "Choices revealed";
    } else if (room.phase === "memory-show") {
      room.phase = "memory-input";
      room.deadline = boundary + scaled([15e3, 2e4, 25e3][room.memoryLevel] || 15e3);
      room.memorySubmissions = [];
      room.event = `Memory level ${room.memoryLevel + 1}: enter the sequence`;
    } else if (room.phase === "memory-input") {
      settleMemory(room);
      room.memoryLevel++;
      if (room.memoryLevel >= 3) {
        finish(room);
      } else {
        room.phase = "memory-show";
        room.sequence = Array.from({ length: [4, 6, 8][room.memoryLevel] }, () => SYMBOLS[rand(SYMBOLS.length)]);
        room.deadline = boundary + scaled([6e3, 8e3][room.memoryLevel - 1]);
        room.memorySubmissions = [];
        room.event = `Level ${room.memoryLevel + 1} sequence`;
      }
    } else break;
  }
}
function finish(room) {
  room.phase = "results";
  room.deadline = 0;
  room.winnerIds = winnerIds(room.players);
  room.event = "The match is complete";
}
function snapshot(room, playerId) {
  const self = room.players.find((p) => p.id === playerId);
  const now = Date.now();
  return { code: room.code, phase: room.phase, deadline: room.deadline, serverNow: now, hostId: room.hostId, event: room.event, question: room.phase === "quiz" ? { index: room.question + 1, total: QUIZ.length, ...QUIZ[room.question], correct: void 0 } : void 0, players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, rounds: p.rounds, connected: now - p.connectedAt < 3e4, hasActed: room.phase === "quiz" ? room.quizSubmissions.includes(p.id) : room.phase === "bluff" ? p.risk !== void 0 : room.phase === "memory-input" ? room.memorySubmissions.includes(p.id) : false, choice: room.phase !== "bluff" ? p.risk : void 0 })), self: self ? { id: self.id, token: self.token, hasActed: room.phase === "quiz" ? room.quizSubmissions.includes(self.id) : room.phase === "bluff" ? self.risk !== void 0 : room.phase === "memory-input" ? room.memorySubmissions.includes(self.id) : false, memoryAnswer: self.memoryAnswers[String(room.memoryLevel)] || [] } : void 0, sequence: room.phase === "memory-show" ? room.sequence : void 0, level: room.phase.startsWith("memory") ? room.memoryLevel + 1 : void 0, winnerIds: room.phase === "results" ? room.winnerIds : void 0 };
}
async function mutate(code, fn) {
  for (let i = 0; i < 12; i++) {
    const found = await readRoom(code);
    if (!found) return null;
    const room = found.room;
    advance(room, Date.now());
    fn(room);
    room.updatedAt = Date.now();
    if (await writeRoom(room, found.etag)) return room;
  }
  throw new Error("Room is busy. Please retry.");
}
var game_default = async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
  const headers = { "access-control-allow-origin": "*" };
  try {
    const body = req.method === "POST" ? await req.json() : {};
    const action = String(body.action || new URL(req.url).searchParams.get("action") || "");
    const code = String(body.code || new URL(req.url).searchParams.get("code") || "").toUpperCase();
    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return fail("Enter a nickname.");
      let room;
      let player;
      for (let i = 0; i < 10; i++) {
        const candidate = makeCode();
        const found = await readRoom(candidate);
        if (found) continue;
        const now = Date.now();
        player = { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), name, joinedAt: now, connectedAt: now, score: 0, rounds: { quiz: 0, bluff: 0, memory: 0 }, answers: {}, memoryAnswers: {}, memoryDrafts: {} };
        room = { code: candidate, hostId: player.id, createdAt: now, updatedAt: now, phase: "lobby", players: [player], deadline: 0, question: 0, quizSubmissions: [], revealAt: 0, memoryLevel: 0, sequence: [], memorySubmissions: [], event: "Waiting for your crew" };
        if (await writeRoom(room)) break;
        room = void 0;
      }
      if (!room || !player) return fail("Could not create a room. Try again.", 503);
      return response({ state: snapshot(room, player.id), token: player.token, playerId: player.id });
    }
    if (!/^[A-Z2-9]{5}$/.test(code)) return fail("Enter a valid five-character room code.");
    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return fail("Enter a nickname.");
      let joined;
      const updated2 = await mutate(code, (r) => {
        if (r.phase !== "lobby") throw new Error("This game has already started.");
        if (r.players.length >= 8) throw new Error("This room is full.");
        if (r.players.some((p2) => p2.name.toLowerCase() === name.toLowerCase())) throw new Error("That nickname is already in use.");
        const now = Date.now();
        joined = { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), name, joinedAt: now, connectedAt: now, score: 0, rounds: { quiz: 0, bluff: 0, memory: 0 }, answers: {}, memoryAnswers: {}, memoryDrafts: {} };
        r.players.push(joined);
        r.event = `${name} joined the room`;
      });
      if (!updated2) return fail("Room not found.", 404);
      const p = joined;
      return response({ state: snapshot(updated2, p.id), token: p.token, playerId: p.id });
    }
    const playerId = String(body.playerId || new URL(req.url).searchParams.get("playerId") || "");
    const token = String(body.token || "");
    if (action === "state") {
      for (let attempt = 0; attempt < 12; attempt++) {
        const found = await readRoom(code);
        if (!found) return fail("Room not found.", 404);
        const room = found.room;
        const before = JSON.stringify(room);
        const now = Date.now();
        advance(room, now);
        const p = room.players.find((x) => x.id === playerId);
        if (!p || !token || p.token !== token) return fail("Session expired. Rejoin with your room code.");
        if (now - p.connectedAt >= 1e4) p.connectedAt = now;
        const changed = JSON.stringify(room) !== before;
        if (!changed) return response({ state: snapshot(room, playerId) });
        room.updatedAt = now;
        if (await writeRoom(room, found.etag)) return response({ state: snapshot(room, playerId) });
      }
      return fail("Room is busy. Please retry.", 503);
    }
    const updated = await mutate(code, (r) => {
      const p = r.players.find((x) => x.id === playerId);
      if (!p || !token || p.token !== token) throw new Error("Session expired. Rejoin with your room code.");
      p.connectedAt = Date.now();
      if (action === "start") {
        if (r.hostId !== p.id) throw new Error("Only the host can start.");
        if (r.phase !== "lobby" || r.players.length < 2) throw new Error("At least two players are needed.");
        r.phase = "quiz";
        r.question = 0;
        r.deadline = Date.now() + scaled(15e3);
        r.quizSubmissions = [];
        r.event = "Speed Quiz is live";
        return;
      }
      if (action === "quiz") {
        if (r.phase !== "quiz" || Date.now() > r.deadline) throw new Error("This question has closed.");
        if (r.quizSubmissions.includes(p.id)) throw new Error("Answer already locked.");
        const answer = Number(body.answer);
        if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error("Invalid answer.");
        p.answers[String(r.question)] = answer;
        r.quizSubmissions.push(p.id);
        if (answer === QUIZ[r.question].correct) {
          const window = scaled(15e3);
          const remaining = Math.max(0, r.deadline - Date.now());
          const points = 500 + speedBonus(remaining, window);
          p.score += points;
          p.rounds.quiz += points;
        }
        r.event = `${p.name} locked in`;
        return;
      }
      if (action === "risk") {
        if (r.phase !== "bluff" || Date.now() > r.deadline) throw new Error("This decision window has closed.");
        if (p.risk) throw new Error("Your choice is already locked.");
        if (body.choice !== "BANK" && body.choice !== "RISK") throw new Error("Choose BANK or RISK.");
        p.risk = body.choice;
        r.event = `${p.name} locked in`;
        return;
      }
      if (action === "memory") {
        if (r.phase !== "memory-input" || Date.now() > r.deadline) throw new Error("This sequence has closed.");
        if (r.memorySubmissions.includes(p.id)) throw new Error("Sequence already locked.");
        if (!Array.isArray(body.answer) || body.answer.length !== r.sequence.length || body.answer.some((x) => typeof x !== "string" || !SYMBOLS.includes(x))) throw new Error("Enter the complete sequence.");
        awardMemory(r, p, body.answer);
        r.event = `${p.name} submitted the sequence`;
        return;
      }
      if (action === "memoryDraft") {
        if (r.phase !== "memory-input" || Date.now() > r.deadline) throw new Error("This sequence has closed.");
        if (r.memorySubmissions.includes(p.id)) throw new Error("Sequence already locked.");
        if (!Array.isArray(body.answer) || body.answer.length > r.sequence.length || body.answer.some((x) => typeof x !== "string" || !SYMBOLS.includes(x))) throw new Error("Invalid sequence progress.");
        p.memoryDrafts[String(r.memoryLevel)] = body.answer;
        return;
      }
      if (action === "again") {
        if (r.phase !== "results" || r.hostId !== p.id) throw new Error("Only the host can start again after the match.");
        for (const q of r.players) {
          q.score = 0;
          q.rounds = { quiz: 0, bluff: 0, memory: 0 };
          q.answers = {};
          q.memoryAnswers = {};
          q.memoryDrafts = {};
          q.risk = void 0;
        }
        r.phase = "lobby";
        r.question = 0;
        r.deadline = 0;
        r.quizSubmissions = [];
        r.memoryLevel = 0;
        r.sequence = [];
        r.memorySubmissions = [];
        r.winnerIds = [];
        r.event = "Rematch ready";
        return;
      }
      throw new Error("Unknown action.");
    });
    if (!updated) return fail("Room not found.", 404);
    return new Response(JSON.stringify({ state: snapshot(updated, playerId) }), { headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return response({ error: message }, message.includes("Unexpected") ? 500 : 400);
  }
};
export {
  game_default as default
};
