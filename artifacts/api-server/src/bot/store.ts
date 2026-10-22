import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";

export type MatchFormat = "bo1" | "bo3" | "bo7";
export type MatchStatus = "in_progress" | "completed" | "disqualified";
export type VetoActionKind = "ban" | "pick";

export interface Team {
  guild_id: string;
  team_name: string;
  captain_id: string;
  member_ids: string[];
  wins: number;
  losses: number;
  created_at: string;
}

export interface VetoStep {
  team_name: string;
  kind: VetoActionKind;
  map: string;
}

export interface PreviousResult {
  score_team_a: number;
  score_team_b: number;
  winner: string;
}

export interface Match {
  match_id: string;
  guild_id: string;
  team_a: string;
  team_b: string;
  first_turn_team: string;
  format: MatchFormat;
  category_id: string;
  veto_channel_id: string;
  team_a_vc_id: string;
  team_b_vc_id: string;
  status: MatchStatus;
  score_team_a: number;
  score_team_b: number;
  winner: string;
  completed_at: string | null;
  disqualified_team: string | null;
  disqualification_reason: string | null;
  previous_result: PreviousResult | null;
  channels_deleted: boolean;
  veto_state: {
    started: boolean;
    action_index: number;
    remaining_maps: string[];
    steps: VetoStep[];
    message_id: string | null;
  };
  created_at: string;
}

export interface BotState {
  version: 3;
  teams: Team[];
  matches: Match[];
}

const statePath = fileURLToPath(
  new URL("../../data/valorant-bot-state.json", import.meta.url),
);
const backupPath = fileURLToPath(
  new URL("../../data/valorant-bot-state.pre-results-backup.json", import.meta.url),
);

const MAP_POOL = ["Ascent", "Bind", "Haven", "Icebox", "Lotus", "Pearl", "Sunset"];
const emptyState = (): BotState => ({ version: 3, teams: [], matches: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function legacyTeamKey(guildId: string, teamName: string): string {
  return `${guildId}:${normalizeName(teamName)}`;
}

function makeVetoState(
  oldValue: unknown,
  legacySides?: { teamA: string; teamB: string },
): Match["veto_state"] {
  const old = isRecord(oldValue) ? oldValue : {};
  const oldSteps = Array.isArray(old.steps) ? old.steps : [];
  const steps: VetoStep[] = oldSteps.flatMap((value) => {
    if (!isRecord(value)) return [];
    const kind = value.kind;
    const map = value.map;
    if ((kind !== "ban" && kind !== "pick") || typeof map !== "string") return [];

    if (typeof value.team_name === "string") {
      return [{ team_name: value.team_name, kind, map }];
    }
    if (
      legacySides &&
      (value.side === "A" || value.side === "B")
    ) {
      return [
        {
          team_name: value.side === "A" ? legacySides.teamA : legacySides.teamB,
          kind,
          map,
        },
      ];
    }
    return [];
  });

  const remainingMaps = stringArray(old.remaining_maps ?? old.remainingMaps);
  const actionIndex =
    typeof old.action_index === "number"
      ? old.action_index
      : typeof old.actionIndex === "number"
        ? old.actionIndex
        : steps.length;

  return {
    started:
      old.started === true ||
      typeof old.message_id === "string" ||
      typeof old.messageId === "string" ||
      actionIndex > 0,
    action_index: Math.max(0, Math.min(6, actionIndex)),
    remaining_maps: remainingMaps.length ? remainingMaps : [...MAP_POOL],
    steps,
    message_id:
      typeof old.message_id === "string"
        ? old.message_id
        : typeof old.messageId === "string"
          ? old.messageId
          : null,
  };
}

function migrateVersionOne(value: Record<string, unknown>): BotState {
  const legacyTeams = Array.isArray(value.teams) ? value.teams.filter(isRecord) : [];
  const legacyMatches = Array.isArray(value.matches) ? value.matches.filter(isRecord) : [];
  const configuredGuildId = process.env.DISCORD_GUILD_ID?.trim() ?? "";
  const captainByTeam = new Map<string, string>();

  for (const legacyMatch of legacyMatches) {
    const guildId = stringValue(legacyMatch, "guildId") || configuredGuildId;
    const teamA = stringValue(legacyMatch, "teamAName");
    const teamB = stringValue(legacyMatch, "teamBName");
    const captainA = stringValue(legacyMatch, "captainAId");
    const captainB = stringValue(legacyMatch, "captainBId");
    if (teamA && captainA) captainByTeam.set(legacyTeamKey(guildId, teamA), captainA);
    if (teamB && captainB) captainByTeam.set(legacyTeamKey(guildId, teamB), captainB);
  }

  const teams: Team[] = legacyTeams.map((legacyTeam) => {
    const teamName = stringValue(legacyTeam, "name");
    const guildId = stringValue(legacyTeam, "guildId") || configuredGuildId;
    if (!teamName) throw new Error("Cannot migrate a saved team without a team name.");

    const memberIds = stringArray(legacyTeam.playerIds);
    const captainId =
      stringValue(legacyTeam, "captainId") ||
      captainByTeam.get(legacyTeamKey(guildId, teamName)) ||
      "";
    if (captainId && !memberIds.includes(captainId)) memberIds.unshift(captainId);

    return {
      guild_id: guildId,
      team_name: teamName,
      captain_id: captainId,
      member_ids: [...new Set(memberIds)],
      wins: 0,
      losses: 0,
      created_at: stringValue(legacyTeam, "createdAt") || new Date().toISOString(),
    };
  });

  const matches: Match[] = legacyMatches.map((legacyMatch) => {
    const teamA = stringValue(legacyMatch, "teamAName");
    const teamB = stringValue(legacyMatch, "teamBName");
    const guildId =
      stringValue(legacyMatch, "guildId") ||
      teams.find((team) => normalizeName(team.team_name) === normalizeName(teamA))?.guild_id ||
      configuredGuildId;
    const id = stringValue(legacyMatch, "id");
    const oldStatus = stringValue(legacyMatch, "status");

    return {
      match_id: id,
      guild_id: guildId,
      team_a: teamA,
      team_b: teamB,
      first_turn_team: teamA,
      format: "bo3",
      category_id: stringValue(legacyMatch, "categoryId"),
      veto_channel_id: stringValue(legacyMatch, "vetoChannelId"),
      team_a_vc_id: stringValue(legacyMatch, "teamAVoiceChannelId"),
      team_b_vc_id: stringValue(legacyMatch, "teamBVoiceChannelId"),
      // Earlier versions used "completed" to mean only that the veto finished.
      status: "in_progress",
      score_team_a: 0,
      score_team_b: 0,
      winner: "",
      completed_at: null,
      disqualified_team: null,
      disqualification_reason: null,
      previous_result: null,
      channels_deleted: false,
      veto_state: makeVetoState(legacyMatch.veto, { teamA, teamB }),
      created_at: stringValue(legacyMatch, "createdAt") || new Date().toISOString(),
    };
  });

  logger.info(
    { migratedLegacyMatchCount: matches.length },
    "Migrated legacy match records",
  );
  return { version: 3, teams, matches };
}

function migrateVersionTwo(value: Record<string, unknown>): BotState {
  const oldTeams = Array.isArray(value.teams) ? value.teams.filter(isRecord) : [];
  const oldMatches = Array.isArray(value.matches) ? value.matches.filter(isRecord) : [];

  const teams: Team[] = oldTeams.map((team) => ({
    guild_id: stringValue(team, "guild_id"),
    team_name: stringValue(team, "team_name"),
    captain_id: stringValue(team, "captain_id"),
    member_ids: stringArray(team.member_ids),
    wins: numberValue(team, "wins"),
    losses: numberValue(team, "losses"),
    created_at: stringValue(team, "created_at") || new Date().toISOString(),
  }));

  const matches: Match[] = oldMatches.map((match) => {
    const teamA = stringValue(match, "team_a");
    const teamB = stringValue(match, "team_b");
    const oldVeto = isRecord(match.veto_state) ? match.veto_state : {};
    const status = stringValue(match, "status");
    return {
      match_id: stringValue(match, "match_id"),
      guild_id: stringValue(match, "guild_id"),
      team_a: teamA,
      team_b: teamB,
      first_turn_team: stringValue(match, "first_turn_team") || teamA,
      format:
        match.format === "bo1" || match.format === "bo7" ? match.format : "bo3",
      category_id: stringValue(match, "category_id"),
      veto_channel_id: stringValue(match, "veto_channel_id"),
      team_a_vc_id: stringValue(match, "team_a_vc_id"),
      team_b_vc_id: stringValue(match, "team_b_vc_id"),
      // V2's completed status meant "veto finished", not a recorded match result.
      status: "in_progress",
      score_team_a: 0,
      score_team_b: 0,
      winner: "",
      completed_at: null,
      disqualified_team: null,
      disqualification_reason: null,
      previous_result: null,
      channels_deleted: false,
      veto_state: makeVetoState(oldVeto),
      created_at: stringValue(match, "created_at") || new Date().toISOString(),
    };
  });

  logger.info(
    { teamCount: teams.length, matchCount: matches.length, previousVersion: 2 },
    "Migrated tournament state to include results and team records",
  );
  return { version: 3, teams, matches };
}

function validateCurrentState(value: unknown): BotState {
  if (
    !isRecord(value) ||
    value.version !== 3 ||
    !Array.isArray(value.teams) ||
    !Array.isArray(value.matches)
  ) {
    throw new Error("The tournament bot state file has an unsupported format.");
  }

  const validTeams = value.teams.every(
    (team) =>
      isRecord(team) &&
      typeof team.guild_id === "string" &&
      typeof team.team_name === "string" &&
      typeof team.captain_id === "string" &&
      Array.isArray(team.member_ids) &&
      team.member_ids.every((id) => typeof id === "string") &&
      typeof team.wins === "number" &&
      typeof team.losses === "number",
  );
  const validMatches = value.matches.every(
    (match) =>
      isRecord(match) &&
      typeof match.match_id === "string" &&
      typeof match.guild_id === "string" &&
      typeof match.team_a === "string" &&
      typeof match.team_b === "string" &&
      typeof match.first_turn_team === "string" &&
      (match.format === "bo1" || match.format === "bo3" || match.format === "bo7") &&
      typeof match.category_id === "string" &&
      typeof match.veto_channel_id === "string" &&
      typeof match.team_a_vc_id === "string" &&
      typeof match.team_b_vc_id === "string" &&
      (match.status === "in_progress" ||
        match.status === "completed" ||
        match.status === "disqualified") &&
      typeof match.score_team_a === "number" &&
      typeof match.score_team_b === "number" &&
      typeof match.winner === "string" &&
      (typeof match.completed_at === "string" || match.completed_at === null) &&
      typeof match.channels_deleted === "boolean" &&
      isRecord(match.veto_state) &&
      typeof match.veto_state.started === "boolean" &&
      typeof match.veto_state.action_index === "number" &&
      Array.isArray(match.veto_state.remaining_maps) &&
      Array.isArray(match.veto_state.steps),
  );

  if (!validTeams || !validMatches) {
    throw new Error("The tournament bot state file contains invalid team or match data.");
  }
  return value as unknown as BotState;
}

async function writeStateAtomically(state: BotState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${dirname(statePath)}/.${basename(statePath)}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

function isRecordCode(error: unknown, code: string): boolean {
  return isRecord(error) && "code" in error && error.code === code;
}

let migrationInFlight: Promise<void> | null = null;

async function migrateAndPersist(
  legacyState: Record<string, unknown>,
): Promise<BotState> {
  const migratedState =
    legacyState.version === 1
      ? migrateVersionOne(legacyState)
      : migrateVersionTwo(legacyState);

  if (!migrationInFlight) {
    const migration = (async () => {
      try {
        await copyFile(statePath, backupPath, 1);
      } catch (error) {
        if (!isRecordCode(error, "EEXIST")) throw error;
      }
      await writeStateAtomically(migratedState);
      logger.info(
        { teamCount: migratedState.teams.length, matchCount: migratedState.matches.length },
        "Tournament state migration completed",
      );
    })();
    const tracked = migration.finally(() => {
      if (migrationInFlight === tracked) migrationInFlight = null;
    });
    migrationInFlight = tracked;
  }

  await migrationInFlight;
  return readStateFromDisk();
}

async function readStateFromDisk(): Promise<BotState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (isRecordCode(error, "ENOENT")) return emptyState();
    throw error;
  }

  if (isRecord(parsed) && (parsed.version === 1 || parsed.version === 2)) {
    return migrateAndPersist(parsed);
  }
  return validateCurrentState(parsed);
}

let stateQueue: Promise<void> = Promise.resolve();

export async function getState(): Promise<BotState> {
  await stateQueue;
  return readStateFromDisk();
}

export async function initializeState(): Promise<void> {
  await stateQueue;
  await readStateFromDisk();
}

export async function updateState<T>(
  update: (state: BotState) => T | Promise<T>,
): Promise<T> {
  const operation = stateQueue.then(async () => {
    const state = await readStateFromDisk();
    const result = await update(state);
    await writeStateAtomically(state);
    return result;
  });

  stateQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}
