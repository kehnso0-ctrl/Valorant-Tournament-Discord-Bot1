# Valorant Tournament Discord Bot

Discord.js bot for managing Valorant team rosters, randomized match formats and turn order, captain-led map vetoes, match results, leaderboards, and history.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run bot:dev` — run the Discord tournament bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Bot secret: `DISCORD_TOKEN`; optional non-secret setting: `DISCORD_GUILD_ID` for faster guild-scoped slash-command updates
- API server env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/` — Discord bot commands, interaction handlers, and JSON-backed state
- `docs/valorant-discord-bot.md` — setup instructions, permissions, and command reference

## Architecture decisions

- Tournament state uses a local JSON file. (will upgrade to an SQL database soon); it is not shared between multiple bot instances.
- Slash commands register globally by default; set `DISCORD_GUILD_ID` for development-time guild registration.

## Product

Organizers create teams and matches. Captains conduct a validated Bo1, Bo3, or Bo7 map veto through Discord dropdowns. Organizers record results or disqualifications, and the bot tracks team records, leaderboards, and match history.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Enable Discord's Server Members and Voice States intents in the Developer Portal; the bot also needs Manage Channels and Move Members permissions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
