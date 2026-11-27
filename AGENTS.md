# Phone 3D UI Studio Working Agreement

Read [README.md](README.md) and [package.json](package.json) before making substantial changes.

## Standard Verification Gate

Run lint, typecheck, and unit tests before committing or opening a PR:

```sh
npm run lint && npm run typecheck && npx tsc -p worker/tsconfig.json --noEmit && npm test
```

## Major-Update Formal State-Machine Check

Before finalizing a major update or any change touching WebPlay room signaling, Durable Object WebSocket lifecycle, or P2P takeover (`worker/src/index.ts`, `src/webplay/roomConnection.ts`, `scripts/webplay-room-relay.mjs`, `shared/webPlayProtocol.mjs`):

1. Run `.agents/skills/verify-webplay-room/SKILL.md` (mirrored at `.claude/skills/verify-webplay-room/SKILL.md`) via the installed `/statechart` skill, writing outputs under `/tmp` only.
2. If covered files changed past the skill's recorded `sync_commit`, update `formal/WebPlayRoomProtocol.tla` using `maintain-formal-verification-skill` before trusting a pass, verify a scratch mutation fails, and advance `sync_commit` in its own commit.
3. Replay every counterexample against `worker/src/index.test.ts` or `src/webplay/roomConnection.test.ts` to separate real bugs from model drift.

## Privacy & Repository Hygiene

- Never commit machine-specific paths, secrets, local asset packs, or temporary `/tmp` verification outputs.
