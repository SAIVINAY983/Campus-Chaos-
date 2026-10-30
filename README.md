# Campus Chaos — Last Player Standing

A responsive, three-round multiplayer party game built with React, TypeScript, Vite, Netlify Functions, and Netlify Blobs.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run netlify:dev`.
4. Open the local URL printed by Netlify Dev. Open it in another browser or device to join with the room code.

Netlify Dev provides an isolated local Blobs sandbox. The hosted site uses the same Netlify Function code with the site-wide `campus-chaos-rooms` Blobs store. To speed up local match testing, set `CAMPUS_CHAOS_TIMER_SCALE=0.5` before starting `npm run netlify:dev`; the override is ignored outside Netlify Dev. Production timers remain at their full lengths.

## Build and check

- `npm run build` compiles the server function, type-checks the React app, and creates `dist/`.
- `npm run test` checks the scoring and tiebreak rules.
- `npm run netlify:dev` runs the actual function route and local Blobs sandbox.
- `npm run test:integration` runs the two-session, three-round integration match against a running local Netlify Dev server. The script checks shared state, reconnection, duplicate rejection, private choices, quiz bounds, two-player Bluff scoring, partial Memory timeout scoring, winner selection, rematch reset, and deadlines during disconnects. If Netlify Dev selected a different port, set `GAME_URL` to that server’s `/.netlify/functions/game` URL before running the script.

## Deploy to Netlify

The ZIP contains the full source project, build scripts, function, configuration, tests, and lockfile. Extract it first. In a Netlify account, create or open a site and use the logged-in build-aware drag-and-drop deploy flow with the extracted project folder. Netlify uses `netlify.toml` to run `npm run build`, publish `dist/`, and deploy `netlify/functions/`. Do not deploy only `dist/`: that would omit the server function. Netlify CLI deployment with a build is another supported option.

After deployment, open the site URL, create a room, join it from a separate device, and play through a match. Netlify Blobs provisioning and hosted conditional-write behavior require the deployed site context; local sandbox tests do not verify a particular Netlify account or public deployment.

## Rules summary

- **Speed Quiz:** Five questions, 15 seconds each. Correct = 500 base + `floor(500 × remaining milliseconds ÷ 15,000)`, clamped to a 0–500 speed bonus. Wrong or unanswered = 0.
- **Bluff or Bank:** BANK = +300. RISK = +800 only if fewer players chose RISK than BANK; a tie or RISK majority = −400. Unanswered players score zero and count toward neither choice.
- **Memory Blitz:** Three sequences of 4, 6, and 8 items. Each item displays for one second; response windows are 15, 20, and 25 seconds. Each correct position = 200; a perfect sequence adds 500. Correctly entered positions can still score if time expires.
- **Ties:** Final score, then Memory points, then Quiz points. Remaining ties share the win.
