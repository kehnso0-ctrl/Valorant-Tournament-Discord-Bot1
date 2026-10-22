# Valorant Tournament Discord Bot

This Discord.js v14 bot manages Valorant team rosters, match channels, randomized match formats and turn order, captain-only map vetoes, and automatic voice-channel moves.

## Start the bot

The bot token is stored as the `DISCORD_TOKEN` Replit Secret. Start the **Valorant Tournament Bot** workflow, or run:

```sh
pnpm --filter @workspace/api-server run bot:dev
```

By default, slash commands are registered globally. For faster command updates while developing, set the non-secret environment variable `DISCORD_GUILD_ID` to the server ID. Remove it to return to global registration.

## Discord application setup

1. Create an application and bot in the Discord Developer Portal.
2. Enable the **Server Members Intent** and **Voice States Intent** under Bot settings. The bot requests the `Guilds`, `GuildMembers`, and `GuildVoiceStates` gateway intents.
3. Invite it with the `bot` and `applications.commands` OAuth scopes. Grant it **Manage Channels**, **Move Members**, **View Channels**, **Send Messages**, **Embed Links**, and **Use Application Commands** permissions.
4. Add the bot token to Replit Secrets as `DISCORD_TOKEN`. Never put the token in source code or commit it.

## Commands

Organizer commands require the Discord **Manage Server** permission:

- `/createteam team_name` — create an empty team record.
- `/addteam team_name team_captain team_members` — set the captain and add mentioned members. Mention the roster in `team_members`; the captain is automatically included. Existing members are retained, and a player cannot be on multiple teams.
- `/removeteam team_name` — delete a team that has no saved matches.
- `/creatematch team_a team_b` — create a match category, two team voice channels, and a `veto-room` text channel. The bot randomly chooses `bo1`, `bo3`, or `bo7`, flips the first turn, and posts an announcement. Both teams need a captain.
- `/endmatch match_id score_team_a score_team_b` — record a non-tied final score in the match's `veto-room` and update both teams' wins/losses.
- `/disqualifymatch match_id dq_team [reason]` — disqualify a participant team and award the opponent the default win. Requires **Administrator** or **Manage Channels**.
- `/removematch match_id` — delete the match channels. Completed and disqualified records stay saved for history and stats; an in-progress match record is removed.

Roster commands:

- `/teamlist` — show the registered teams and their roster counts.
- `/teaminfo [team_name]` — show a team's captain and members. Leave the option blank to look up your own team.
- `/leaderboard` — show the top 10 teams by wins, with win rate as the tiebreaker.
- `/history [team_name]` — show completed and disqualified matches. Without a team filter, shows the 10 most recent results; with a team filter, shows all matching results.

`team_name`, `team_a`, and `team_b` offer autocomplete suggestions from this server's saved teams.

`/startmatch match_id` — start the map veto inside that match's `veto-room`. The captain of the coinflip winner or a server organizer can start it. The captain whose turn it is must make each dropdown selection.

Veto sequences:

- **Bo1:** six alternating bans; the final remaining map is the decider.
- **Bo3:** two alternating bans, two alternating picks, then two alternating bans; the final remaining map is the decider.
- **Bo7:** six alternating picks; the final remaining map is the decider.

Once the veto is complete, the bot posts the schedule and moves all roster members who are currently in a voice channel to their team's match voice channel. Players not connected to voice are skipped.

`/endmatch` accepts the final series score and rejects ties. `/disqualifymatch` can be used on an in-progress or completed match, but not a match already disqualified. If it reverses a completed result, the previous win/loss is removed before the default result is applied. The original score is retained in the history record as voided.

## Data and recovery

Teams and matches are stored in `artifacts/api-server/data/valorant-bot-state.json`. Older state versions are migrated automatically and backed up before being rewritten. Existing player rosters are retained; assign a captain to each existing team with `/addteam` before creating a match. Completed and disqualified records remain after `/removematch` deletes their channels, so leaderboard and history data are preserved. The state files are excluded from Git. Channel creation and deletion require the bot's **Manage Channels** permission; voice moves require **Move Members** and a role hierarchy that permits moving those players.
