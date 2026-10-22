import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type StringSelectMenuInteraction,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  getState,
  updateState,
  type Match,
  type MatchFormat,
  type MatchStatus,
  type Team,
  type VetoActionKind,
} from "./store";

export const MAP_POOL = [
  "Ascent",
  "Bind",
  "Haven",
  "Icebox",
  "Lotus",
  "Pearl",
  "Sunset",
] as const;

const FORMAT_CHOICES: MatchFormat[] = ["bo1", "bo3", "bo7"];

const ACTION_KINDS: Record<MatchFormat, VetoActionKind[]> = {
  bo1: ["ban", "ban", "ban", "ban", "ban", "ban"],
  bo3: ["ban", "ban", "pick", "pick", "ban", "ban"],
  bo7: ["pick", "pick", "pick", "pick", "pick", "pick"],
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function findTeam(
  teams: Team[],
  guildId: string,
  teamName: string,
): Team | undefined {
  return teams.find(
    (team) =>
      team.guild_id === guildId &&
      normalizeName(team.team_name) === normalizeName(teamName),
  );
}

function findMatch(
  matches: Match[],
  guildId: string,
  matchId: string,
): Match | undefined {
  return matches.find(
    (match) =>
      match.guild_id === guildId &&
      match.match_id.toLocaleLowerCase() === matchId.trim().toLocaleLowerCase(),
  );
}

function isOrganizer(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

async function replyError(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, ephemeral: true });
}

function requireOrganizer(interaction: ChatInputCommandInteraction): boolean {
  if (isOrganizer(interaction)) return true;
  void replyError(interaction, "You need the Manage Server permission to use this command.");
  return false;
}

function getGuildId(interaction: ChatInputCommandInteraction): string | null {
  return interaction.guildId ?? null;
}

export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (!interaction.guildId || focused.type !== ApplicationCommandOptionType.String) {
    await interaction.respond([]);
    return;
  }

  const state = await getState();
  if (focused.name === "match_id") {
    const query = String(focused.value).trim().toLocaleLowerCase();
    const matches = state.matches
      .filter(
        (match) =>
          match.guild_id === interaction.guildId &&
          (interaction.commandName !== "endmatch" ||
            match.status === "in_progress") &&
          (!query ||
            match.match_id.toLocaleLowerCase().includes(query) ||
            match.team_a.toLocaleLowerCase().includes(query) ||
            match.team_b.toLocaleLowerCase().includes(query)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 25);
    await interaction.respond(
      matches.map((match) => ({
        name: `${match.match_id} · ${match.team_a} vs ${match.team_b} (${match.format.toUpperCase()})`.slice(
          0,
          100,
        ),
        value: match.match_id,
      })),
    );
    return;
  }

  if (focused.name === "dq_team") {
    const query = String(focused.value).trim().toLocaleLowerCase();
    const choices = state.teams
      .filter(
        (team) =>
          team.guild_id === interaction.guildId &&
          team.team_name.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.team_name.localeCompare(b.team_name))
      .slice(0, 25)
      .map((team) => ({ name: team.team_name, value: team.team_name }));
    await interaction.respond(choices);
    return;
  }

  const teamOptionNames = new Set(["team_name", "team_a", "team_b"]);
  if (!teamOptionNames.has(focused.name)) {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value).trim().toLocaleLowerCase();
  const choices = state.teams
    .filter(
      (team) =>
        team.guild_id === interaction.guildId &&
        team.team_name.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => a.team_name.localeCompare(b.team_name))
    .slice(0, 25)
    .map((team) => ({ name: team.team_name, value: team.team_name }));

  await interaction.respond(choices);
}

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = getGuildId(interaction);
  if (!guildId || !interaction.guild) {
    await replyError(interaction, "This command can only be used inside a server.");
    return;
  }

  switch (interaction.commandName) {
    case "createteam":
      await createTeam(interaction, guildId);
      return;
    case "addteam":
      await addTeam(interaction, interaction.guild, guildId);
      return;
    case "removeteam":
      await removeTeam(interaction, guildId);
      return;
    case "teamlist":
      await listTeams(interaction, guildId);
      return;
    case "teaminfo":
      await showTeamInfo(interaction, guildId);
      return;
    case "creatematch":
      await createMatch(interaction, interaction.guild, guildId);
      return;
    case "startmatch":
      await startMatch(interaction, interaction.guild, guildId);
      return;
    case "endmatch":
      await endMatch(interaction, interaction.guild, guildId);
      return;
    case "leaderboard":
      await showLeaderboard(interaction, guildId);
      return;
    case "history":
      await showHistory(interaction, guildId);
      return;
    case "disqualifymatch":
      await disqualifyMatch(interaction, interaction.guild, guildId);
      return;
    case "removematch":
      await removeMatch(interaction, interaction.guild, guildId);
      return;
    default:
      await replyError(interaction, "That command is not supported.");
  }
}

async function createTeam(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const teamName = interaction.options.getString("team_name", true).trim();
  if (!teamName) {
    await replyError(interaction, "Team name cannot be blank.");
    return;
  }

  const result = await updateState((state) => {
    if (findTeam(state.teams, guildId, teamName)) return "exists";
    state.teams.push({
      guild_id: guildId,
      team_name: teamName,
      captain_id: "",
      member_ids: [],
      wins: 0,
      losses: 0,
      created_at: new Date().toISOString(),
    });
    return "created";
  });

  await interaction.reply({
    content:
      result === "created"
        ? `Team **${teamName}** created. Next, use \`/addteam\` to set its captain and roster.`
        : `A team named **${teamName}** already exists.`,
    ephemeral: true,
  });
}

function extractMentionedIds(value: string): string[] {
  const ids = [...value.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
  return [...new Set(ids)];
}

async function addTeam(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const teamName = interaction.options.getString("team_name", true);
  const captain = interaction.options.getUser("team_captain", true);
  const memberText = interaction.options.getString("team_members", true);
  const mentionedIds = extractMentionedIds(memberText);

  if (mentionedIds.length === 0) {
    await replyError(
      interaction,
      "Mention at least one player in `team_members` (for example, @Player1 @Player2).",
    );
    return;
  }
  if (captain.bot) {
    await replyError(interaction, "A bot cannot be assigned as team captain.");
    return;
  }

  const rosterIds = [...new Set([captain.id, ...mentionedIds])];
  if (rosterIds.length > 25) {
    await replyError(interaction, "A team roster can contain at most 25 players.");
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  for (const userId of rosterIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (member.user.bot) {
        await interaction.editReply("Bots cannot be assigned to a tournament roster.");
        return;
      }
    } catch {
      await interaction.editReply(
        "Every captain and roster member must currently be a member of this Discord server.",
      );
      return;
    }
  }

  const result = await updateState((state) => {
    const team = findTeam(state.teams, guildId, teamName);
    if (!team) return "missing-team";
    const hasActiveMatch = state.matches.some(
      (match) =>
        match.guild_id === guildId &&
        match.status === "in_progress" &&
        [match.team_a, match.team_b].some(
          (name) => normalizeName(name) === normalizeName(team.team_name),
        ),
    );
    if (hasActiveMatch) return "active-match";

    const rosterSet = new Set(team.member_ids);
    for (const userId of rosterIds) {
      const anotherTeam = state.teams.find(
        (candidate) =>
          candidate.guild_id === guildId &&
          candidate.team_name !== team.team_name &&
          (candidate.captain_id === userId || candidate.member_ids.includes(userId)),
      );
      if (anotherTeam) return "other-team";
      rosterSet.add(userId);
    }

    team.captain_id = captain.id;
    team.member_ids = [...rosterSet];
    return "updated";
  });

  const messages = {
    "missing-team": `Team **${teamName}** was not found. Create it with \`/createteam\` first.`,
    "active-match": "Roster and captain changes are blocked while the team has an active match.",
    "other-team": "At least one roster member is already assigned to another team.",
    updated: `Captain set to <@${captain.id}>. Added ${rosterIds.length} player(s) to **${teamName}**. Existing roster members were kept.`,
  } as const;
  await interaction.editReply({ content: messages[result], allowedMentions: { parse: [] } });
}

async function removeTeam(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const teamName = interaction.options.getString("team_name", true);
  const result = await updateState((state) => {
    const team = findTeam(state.teams, guildId, teamName);
    if (!team) return "missing-team";
    if (
      state.matches.some(
        (match) =>
          match.guild_id === guildId &&
          [match.team_a, match.team_b].some(
            (name) => normalizeName(name) === normalizeName(team.team_name),
          ),
      )
    ) {
      return "has-matches";
    }
    state.teams = state.teams.filter((candidate) => candidate !== team);
    return "removed";
  });

  const messages = {
    "missing-team": `Team **${teamName}** was not found.`,
    "has-matches": "Remove the team's saved matches before deleting the team.",
    removed: `Team **${teamName}** deleted.`,
  } as const;
  await interaction.reply({ content: messages[result], ephemeral: true });
}

function splitLines(lines: string[], maxLength: number): string[] {
  const pages: string[] = [];
  let page = "";
  for (const line of lines) {
    if (page && page.length + line.length + 1 > maxLength) {
      pages.push(page);
      page = "";
    }
    page = page ? `${page}\n${line}` : line;
  }
  if (page) pages.push(page);
  return pages;
}

async function listTeams(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const state = await getState();
  const teams = state.teams
    .filter((team) => team.guild_id === guildId)
    .sort((a, b) => a.team_name.localeCompare(b.team_name));

  if (teams.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4655)
          .setTitle("Tournament Teams")
          .setDescription("No teams are registered yet. An organizer can create one with `/createteam`."),
      ],
    });
    return;
  }

  const lines = teams.map(
    (team) =>
      `• **${team.team_name}** — ${team.member_ids.length} rostered; captain ${team.captain_id ? `<@${team.captain_id}>` : "not assigned"}`,
  );
  const pages = splitLines(lines, 3900);
  for (let index = 0; index < pages.length; index += 10) {
    const embeds = pages.slice(index, index + 10).map((description, pageIndex) => {
      const pageNumber = index + pageIndex + 1;
      const pageCount = pages.length;
      return new EmbedBuilder()
        .setColor(0xff4655)
        .setTitle(pageCount > 1 ? `Tournament Teams (${pageNumber}/${pageCount})` : "Tournament Teams")
        .setDescription(description);
    });

    if (index === 0) {
      await interaction.reply({ embeds, allowedMentions: { parse: [] } });
    } else {
      await interaction.followUp({ embeds, allowedMentions: { parse: [] } });
    }
  }
}

async function showTeamInfo(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const requestedName = interaction.options.getString("team_name");
  const state = await getState();
  const team = requestedName
    ? findTeam(state.teams, guildId, requestedName)
    : state.teams.find(
        (candidate) =>
          candidate.guild_id === guildId &&
          (candidate.captain_id === interaction.user.id ||
            candidate.member_ids.includes(interaction.user.id)),
      );

  if (!team) {
    const message = requestedName
      ? `Team **${requestedName}** was not found.`
      : "You are not listed as a captain or member of a team.";
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const otherMembers = team.member_ids.filter((id) => id !== team.captain_id);
  const embed = new EmbedBuilder()
    .setColor(0xff4655)
    .setTitle(team.team_name)
    .addFields(
      {
        name: "Captain",
        value: team.captain_id ? `<@${team.captain_id}>` : "Not assigned",
      },
      {
        name: "Members",
        value: otherMembers.length
          ? otherMembers.map((id) => `<@${id}>`).join("\n")
          : "No other members registered.",
      },
    );
  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

function createMatchId(): string {
  return `M-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

function createVetoState(): Match["veto_state"] {
  return {
    started: false,
    action_index: 0,
    remaining_maps: [...MAP_POOL],
    steps: [],
    message_id: null,
  };
}

function getAnnouncementEmbed(
  match: Match,
  teamA: Team,
  teamB: Team,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff4655)
    .setTitle(`Tournament Match · ${match.match_id}`)
    .setDescription(`**${match.team_a}** vs **${match.team_b}**`)
    .addFields(
      { name: "Format", value: match.format.toUpperCase(), inline: true },
      {
        name: "Coinflip winner / first turn",
        value: `**${match.first_turn_team}**`,
        inline: true,
      },
      {
        name: "Captains",
        value: `<@${teamA.captain_id}> · <@${teamB.captain_id}>`,
      },
      {
        name: "Start the veto",
        value: `Run \`/startmatch match_id:${match.match_id}\` in this channel.`,
      },
    );
}

async function createMatch(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const teamAInput = interaction.options.getString("team_a", true);
  const teamBInput = interaction.options.getString("team_b", true);
  const state = await getState();
  const teamA = findTeam(state.teams, guildId, teamAInput);
  const teamB = findTeam(state.teams, guildId, teamBInput);

  if (!teamA || !teamB) {
    await replyError(interaction, "Both teams must exist before creating a match.");
    return;
  }
  if (normalizeName(teamA.team_name) === normalizeName(teamB.team_name)) {
    await replyError(interaction, "Choose two different teams.");
    return;
  }
  if (!teamA.captain_id || !teamB.captain_id) {
    await replyError(
      interaction,
      "Assign a captain to each team with `/addteam` before creating a match.",
    );
    return;
  }
  if (
    state.matches.some(
      (match) =>
        match.guild_id === guildId &&
        match.status === "in_progress" &&
        [match.team_a, match.team_b].some(
          (name) =>
            normalizeName(name) === normalizeName(teamA.team_name) ||
            normalizeName(name) === normalizeName(teamB.team_name),
        ),
    )
  ) {
    await replyError(interaction, "One or both teams already have an active match.");
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const matchId = createMatchId();
  const firstTurnTeam =
    randomInt(0, 2) === 0 ? teamA.team_name : teamB.team_name;
  const format = FORMAT_CHOICES[randomInt(0, FORMAT_CHOICES.length)];
  let categoryId: string | null = null;
  let teamAVoiceId: string | null = null;
  let teamBVoiceId: string | null = null;
  let vetoChannelId: string | null = null;
  let saved = false;

  try {
    const category = await guild.channels.create({
      name: `TOURNAMENT MATCH: ${matchId}`,
      type: ChannelType.GuildCategory,
    });
    categoryId = category.id;

    const teamAVoice = await guild.channels.create({
      name: `${teamA.team_name} VC`,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    teamAVoiceId = teamAVoice.id;

    const teamBVoice = await guild.channels.create({
      name: `${teamB.team_name} VC`,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    teamBVoiceId = teamBVoice.id;

    const vetoChannel = await guild.channels.create({
      name: "veto-room",
      type: ChannelType.GuildText,
      parent: category.id,
    });
    vetoChannelId = vetoChannel.id;

    const match: Match = {
      match_id: matchId,
      guild_id: guildId,
      team_a: teamA.team_name,
      team_b: teamB.team_name,
      first_turn_team: firstTurnTeam,
      format,
      category_id: category.id,
      veto_channel_id: vetoChannel.id,
      team_a_vc_id: teamAVoice.id,
      team_b_vc_id: teamBVoice.id,
      status: "in_progress",
      score_team_a: 0,
      score_team_b: 0,
      winner: "",
      completed_at: null,
      disqualified_team: null,
      disqualification_reason: null,
      previous_result: null,
      channels_deleted: false,
      veto_state: createVetoState(),
      created_at: new Date().toISOString(),
    };

    await updateState((currentState) => {
      currentState.matches.push(match);
    });
    saved = true;

    await vetoChannel.send({
      embeds: [getAnnouncementEmbed(match, teamA, teamB)],
      allowedMentions: { parse: [] },
    });
    await interaction.editReply(
      `Match **${matchId}** created as **${format.toUpperCase()}**. **${firstTurnTeam}** won the coinflip and acts first. Start it in <#${vetoChannel.id}>.`,
    );
  } catch (error) {
    logger.error({ err: error, matchId }, "Failed to create match channels or announcement");
    if (saved) {
      await updateState((currentState) => {
        currentState.matches = currentState.matches.filter(
          (match) => match.match_id !== matchId,
        );
      });
    }

    const createdChannelIds = [
      vetoChannelId,
      teamBVoiceId,
      teamAVoiceId,
      categoryId,
    ].filter((channelId): channelId is string => channelId !== null);
    for (const channelId of createdChannelIds) {
      try {
        const channel = await guild.channels.fetch(channelId);
        await channel?.delete("Cleaning up an incomplete tournament match.");
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, channelId, matchId },
          "Could not clean up an incomplete match channel",
        );
      }
    }
    await interaction.editReply(
      "The match could not be created. Check the bot's Manage Channels and Send Messages permissions, then try again.",
    );
  }
}

function getActionsForMatch(match: Match): VetoActionKind[] {
  return ACTION_KINDS[match.format];
}

function getCurrentAction(
  match: Match,
): { team_name: string; kind: VetoActionKind } | null {
  const kind = getActionsForMatch(match)[match.veto_state.action_index];
  if (!kind) return null;
  const otherTeam = match.first_turn_team === match.team_a ? match.team_b : match.team_a;
  return {
    team_name:
      match.veto_state.action_index % 2 === 0
        ? match.first_turn_team
        : otherTeam,
    kind,
  };
}

function getTeamForVetoTurn(state: Awaited<ReturnType<typeof getState>>, match: Match, teamName: string): Team | undefined {
  return findTeam(state.teams, match.guild_id, teamName);
}

function makeVetoEmbed(match: Match): EmbedBuilder {
  const action = getCurrentAction(match);
  const history = match.veto_state.steps.length
    ? match.veto_state.steps
        .map(
          (step) =>
            `• **${step.team_name}** ${step.kind === "ban" ? "banned" : "picked"} ${step.map}`,
        )
        .join("\n")
    : "No maps selected yet.";

  return new EmbedBuilder()
    .setColor(0xff4655)
    .setTitle(`${match.format.toUpperCase()} Map Veto · ${match.match_id}`)
    .setDescription(
      action
        ? `**${action.team_name}** — ${action.kind === "ban" ? "ban" : "pick"} a map.`
        : "The map veto is complete.",
    )
    .addFields(
      { name: "Veto history", value: history },
      {
        name: "Maps remaining",
        value: match.veto_state.remaining_maps.join(", ") || "None",
      },
    );
}

function makeVetoComponents(match: Match): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const action = getCurrentAction(match);
  if (!action) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`veto:${match.match_id}`)
    .setPlaceholder(`${action.team_name}: ${action.kind} a map`)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      match.veto_state.remaining_maps.map((map) => ({ label: map, value: map })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

async function startMatch(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> {
  const matchId = interaction.options.getString("match_id", true);
  const state = await getState();
  const match = findMatch(state.matches, guildId, matchId);
  if (!match) {
    await replyError(interaction, `Match **${matchId}** was not found.`);
    return;
  }
  if (interaction.channelId !== match.veto_channel_id) {
    await replyError(interaction, `Run this command in <#${match.veto_channel_id}>.`);
    return;
  }
  if (match.status !== "in_progress" || match.veto_state.started) {
    await replyError(interaction, "This match's map veto has already started.");
    return;
  }

  const firstTeam = getTeamForVetoTurn(state, match, match.first_turn_team);
  if (!firstTeam?.captain_id) {
    await replyError(interaction, "The first-turn team does not have a captain assigned.");
    return;
  }
  if (interaction.user.id !== firstTeam.captain_id && !isOrganizer(interaction)) {
    await replyError(
      interaction,
      `Only ${match.first_turn_team}'s captain or a server organizer can start this veto.`,
    );
    return;
  }

  const reserved = await updateState((currentState) => {
    const currentMatch = findMatch(currentState.matches, guildId, match.match_id);
    if (
      !currentMatch ||
      currentMatch.status !== "in_progress" ||
      currentMatch.veto_state.started
    ) {
      return false;
    }
    currentMatch.veto_state.started = true;
    return true;
  });
  if (!reserved) {
    await replyError(interaction, "This match has already started.");
    return;
  }

  try {
    await interaction.reply({
      embeds: [makeVetoEmbed(match)],
      components: makeVetoComponents(match),
    });
    const message = await interaction.fetchReply();
    await updateState((currentState) => {
      const currentMatch = findMatch(currentState.matches, guildId, match.match_id);
      if (currentMatch?.status === "in_progress") {
        currentMatch.veto_state.message_id = message.id;
      }
    });
    logger.info({ matchId: match.match_id, guildId: guild.id }, "Match veto started");
  } catch (error) {
    await updateState((currentState) => {
      const currentMatch = findMatch(currentState.matches, guildId, match.match_id);
      if (currentMatch?.status === "in_progress") {
        currentMatch.veto_state.started = false;
        currentMatch.veto_state.message_id = null;
      }
    });
    throw error;
  }
}

function getScheduleLines(match: Match): string[] {
  const picks = match.veto_state.steps.filter((step) => step.kind === "pick");
  const lines = picks.map(
    (step, index) => `**Map ${index + 1} — ${step.team_name}:** ${step.map}`,
  );
  const decider = match.veto_state.remaining_maps[0] ?? "Not available";
  lines.push(`**Map ${picks.length + 1} — Decider:** ${decider}`);
  return lines;
}

export async function handleVetoSelection(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const matchId = interaction.customId.slice("veto:".length);
  const guildId = interaction.guildId;
  if (!guildId || !matchId) {
    await interaction.reply({ content: "This veto menu is invalid.", ephemeral: true });
    return;
  }

  const state = await getState();
  const match = findMatch(state.matches, guildId, matchId);
  if (!match || match.status !== "in_progress" || !match.veto_state.started) {
    await interaction.reply({
      content: "This match is not accepting veto selections.",
      ephemeral: true,
    });
    return;
  }
  if (
    interaction.channelId !== match.veto_channel_id ||
    interaction.message.id !== match.veto_state.message_id
  ) {
    await interaction.reply({
      content: "This is not the active veto menu for this match.",
      ephemeral: true,
    });
    return;
  }

  const action = getCurrentAction(match);
  if (!action) {
    await interaction.reply({ content: "The veto is already complete.", ephemeral: true });
    return;
  }
  const team = getTeamForVetoTurn(state, match, action.team_name);
  if (!team?.captain_id) {
    await interaction.reply({
      content: "The current team does not have a captain assigned.",
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id !== team.captain_id) {
    await interaction.reply({
      content: `It is **${action.team_name}**'s turn. Only that team's captain can select a map.`,
      ephemeral: true,
    });
    return;
  }

  const selectedMap = interaction.values[0];
  if (!match.veto_state.remaining_maps.includes(selectedMap)) {
    await interaction.reply({
      content: "That map is no longer available. Use the current dropdown options.",
      ephemeral: true,
    });
    return;
  }

  const updatedMatch = await updateState((currentState) => {
    const currentMatch = findMatch(currentState.matches, guildId, matchId);
    if (
      !currentMatch ||
      currentMatch.status !== "in_progress" ||
      !currentMatch.veto_state.started
    ) {
      return null;
    }
    const currentAction = getCurrentAction(currentMatch);
    const currentTeam = currentAction
      ? getTeamForVetoTurn(currentState, currentMatch, currentAction.team_name)
      : undefined;
    if (
      !currentAction ||
      currentTeam?.captain_id !== interaction.user.id ||
      !currentMatch.veto_state.remaining_maps.includes(selectedMap)
    ) {
      return null;
    }

    currentMatch.veto_state.steps.push({
      team_name: currentAction.team_name,
      kind: currentAction.kind,
      map: selectedMap,
    });
    currentMatch.veto_state.remaining_maps =
      currentMatch.veto_state.remaining_maps.filter((map) => map !== selectedMap);
    currentMatch.veto_state.action_index += 1;
    if (
      currentMatch.veto_state.action_index >=
      getActionsForMatch(currentMatch).length
    ) {
    }
    return currentMatch;
  });

  if (!updatedMatch) {
    await interaction.reply({
      content: "The veto changed before your selection could be applied. Use the current dropdown.",
      ephemeral: true,
    });
    return;
  }

  const complete =
    updatedMatch.veto_state.action_index >= getActionsForMatch(updatedMatch).length;
  const embed = makeVetoEmbed(updatedMatch);
  if (complete) {
    embed
      .setTitle(`${updatedMatch.format.toUpperCase()} Final Map Schedule · ${updatedMatch.match_id}`)
      .setDescription("The veto is complete. Team members in voice will be moved to their match channels.")
      .addFields({ name: "Final schedule", value: getScheduleLines(updatedMatch).join("\n") });
  }

  await interaction.update({
    embeds: [embed],
    components: complete ? [] : makeVetoComponents(updatedMatch),
  });

  if (complete && interaction.guild) {
    await moveTeamMembers(interaction.guild, updatedMatch);
  }
}

async function moveTeamMembers(guild: Guild, match: Match): Promise<void> {
  const state = await getState();
  const teamA = findTeam(state.teams, match.guild_id, match.team_a);
  const teamB = findTeam(state.teams, match.guild_id, match.team_b);
  const rosters = [
    { ids: teamA?.member_ids ?? [], channelId: match.team_a_vc_id },
    { ids: teamB?.member_ids ?? [], channelId: match.team_b_vc_id },
  ];

  for (const roster of rosters) {
    for (const userId of roster.ids) {
      try {
        const member = await guild.members.fetch(userId);
        if (!member.voice.channelId) continue;
        await member.voice.setChannel(roster.channelId, `Moving roster after ${match.match_id} veto`);
      } catch {
        // Missing members and voice permissions should not stop the rest of the roster moving.
      }
    }
  }
}

function getWinRate(team: Team): number {
  const games = team.wins + team.losses;
  return games === 0 ? 0 : (team.wins / games) * 100;
}

async function showLeaderboard(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const state = await getState();
  const teams = state.teams
    .filter((team) => team.guild_id === guildId)
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        getWinRate(b) - getWinRate(a) ||
        a.team_name.localeCompare(b.team_name),
    )
    .slice(0, 10);

  const description = teams.length
    ? teams
        .map(
          (team, index) =>
            `**${index + 1}. ${team.team_name}** — ${team.wins}-${team.losses} · ${getWinRate(team).toFixed(1)}%`,
        )
        .join("\n")
    : "No teams are registered yet.";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff4655)
        .setTitle("Tournament Leaderboard")
        .setDescription(description),
    ],
  });
}

function formatHistoryMatch(match: Match): string {
  const date = new Date(match.completed_at ?? match.created_at).toLocaleString(
    "en-US",
    { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" },
  );
  if (match.status === "disqualified") {
    const previousScore = match.previous_result
      ? `\nVoided score: ${match.team_a} ${match.previous_result.score_team_a} - ${match.previous_result.score_team_b} ${match.team_b}`
      : "";
    const reason = match.disqualification_reason
      ? `\nReason: ${match.disqualification_reason}`
      : "";
    return `**Default winner:** ${match.winner}\n**Disqualified:** ${match.disqualified_team ?? "Unknown team"}${reason}${previousScore}\n**Date (UTC):** ${date}`;
  }
  return `**Winner:** ${match.winner}\n**Score:** ${match.team_a} ${match.score_team_a} - ${match.score_team_b} ${match.team_b}\n**Date (UTC):** ${date}`;
}

async function showHistory(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const requestedTeam = interaction.options.getString("team_name");
  const state = await getState();
  let matches = state.matches
    .filter(
      (match) =>
        match.guild_id === guildId &&
        (match.status === "completed" || match.status === "disqualified") &&
        (!requestedTeam ||
          normalizeName(match.team_a) === normalizeName(requestedTeam) ||
          normalizeName(match.team_b) === normalizeName(requestedTeam)),
    )
    .sort((a, b) =>
      (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at),
    );

  if (!requestedTeam) matches = matches.slice(0, 10);
  if (matches.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4655)
          .setTitle("Match History")
          .setDescription(
            requestedTeam
              ? `No completed or disqualified matches found for **${requestedTeam}**.`
              : "No completed or disqualified matches have been recorded yet.",
          ),
      ],
    });
    return;
  }

  const pages: Match[][] = [];
  for (let index = 0; index < matches.length; index += 10) {
    pages.push(matches.slice(index, index + 10));
  }
  const title = requestedTeam
    ? `Match History · ${requestedTeam}`
    : "Recent Match History";
  for (let index = 0; index < pages.length; index += 10) {
    const embeds = pages.slice(index, index + 10).map((page, pageOffset) => {
      const pageNumber = index + pageOffset + 1;
      const pageCount = pages.length;
      const embed = new EmbedBuilder()
        .setColor(0xff4655)
        .setTitle(pageCount > 1 ? `${title} (${pageNumber}/${pageCount})` : title);
      for (const match of page) {
        embed.addFields({
          name: `${match.match_id} · ${match.format.toUpperCase()} · ${match.team_a} vs ${match.team_b}`,
          value: formatHistoryMatch(match),
        });
      }
      return embed;
    });

    if (index === 0) {
      await interaction.reply({ embeds, allowedMentions: { parse: [] } });
    } else {
      await interaction.followUp({ embeds, allowedMentions: { parse: [] } });
    }
  }
}

async function endMatch(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const matchId = interaction.options.getString("match_id", true);
  const scoreA = interaction.options.getInteger("score_team_a", true);
  const scoreB = interaction.options.getInteger("score_team_b", true);
  if (scoreA === scoreB) {
    await replyError(interaction, "A match score cannot be tied. Enter the final winning score.");
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await updateState((state) => {
    const match = findMatch(state.matches, guildId, matchId);
    if (!match) return { kind: "missing" as const };
    if (match.status !== "in_progress") {
      return { kind: "not-in-progress" as const };
    }
    const teamA = findTeam(state.teams, guildId, match.team_a);
    const teamB = findTeam(state.teams, guildId, match.team_b);
    if (!teamA || !teamB) return { kind: "missing-team" as const };

    const winner = scoreA > scoreB ? teamA : teamB;
    const loser = winner === teamA ? teamB : teamA;
    winner.wins += 1;
    loser.losses += 1;
    match.score_team_a = scoreA;
    match.score_team_b = scoreB;
    match.winner = winner.team_name;
    match.status = "completed";
    match.completed_at = new Date().toISOString();
    return { kind: "completed" as const, match };
  });

  if (result.kind === "missing") {
    await interaction.editReply(`Match **${matchId}** was not found.`);
    return;
  }
  if (result.kind === "not-in-progress") {
    await interaction.editReply("Only an in-progress match can be ended.");
    return;
  }
  if (result.kind === "missing-team") {
    await interaction.editReply("The match's teams could not be found; no result was recorded.");
    return;
  }

  const match = result.match;
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`Match Result · ${match.match_id} · ${match.format.toUpperCase()}`)
    .addFields(
      {
        name: "Final score",
        value: `**${match.team_a}** ${scoreA} - ${scoreB} **${match.team_b}**`,
      },
      { name: "Winner", value: `🏆 **${match.winner}**` },
      {
        name: "Cleanup",
        value: `An administrator can run \`/removematch match_id:${match.match_id}\` to delete the match channels.`,
      },
    );

  try {
    const channel = await guild.channels.fetch(match.veto_channel_id);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error("The match veto channel is missing or is not a text channel.");
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await interaction.editReply(`Result saved. **${match.winner}** won; team records were updated.`);
  } catch (error) {
    logger.error({ err: error, matchId }, "Could not post the match result embed");
    await interaction.editReply(
      `Result saved and team records updated, but the result embed could not be posted to the match's veto-room.`,
    );
  }
}

function canDisqualify(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels),
  );
}

async function disqualifyMatch(
  interaction: ChatInputCommandInteraction,
  _guild: Guild,
  guildId: string,
): Promise<void> {
  if (!canDisqualify(interaction)) {
    await replyError(
      interaction,
      "You need Administrator or Manage Channels permission to disqualify a match.",
    );
    return;
  }

  const matchId = interaction.options.getString("match_id", true);
  const disqualifiedTeamName = interaction.options.getString("dq_team", true);
  const reason = interaction.options.getString("reason")?.trim() || null;
  await interaction.deferReply();

  const result = await updateState((state) => {
    const match = findMatch(state.matches, guildId, matchId);
    if (!match) return { kind: "missing" as const };
    if (match.status === "disqualified") return { kind: "already-disqualified" as const };
    if (match.status !== "in_progress" && match.status !== "completed") {
      return { kind: "invalid-status" as const };
    }

    const teamA = findTeam(state.teams, guildId, match.team_a);
    const teamB = findTeam(state.teams, guildId, match.team_b);
    const dqTeam = findTeam(state.teams, guildId, disqualifiedTeamName);
    if (!teamA || !teamB || !dqTeam) return { kind: "missing-team" as const };
    if (
      normalizeName(dqTeam.team_name) !== normalizeName(teamA.team_name) &&
      normalizeName(dqTeam.team_name) !== normalizeName(teamB.team_name)
    ) {
      return { kind: "not-in-match" as const };
    }

    const winner = dqTeam === teamA ? teamB : teamA;
    let previousResult: Match["previous_result"] = null;
    if (match.status === "completed") {
      const previousWinner =
        normalizeName(match.winner) === normalizeName(teamA.team_name)
          ? teamA
          : normalizeName(match.winner) === normalizeName(teamB.team_name)
            ? teamB
            : null;
      if (!previousWinner) return { kind: "invalid-previous-result" as const };
      const previousLoser = previousWinner === teamA ? teamB : teamA;
      if (previousWinner.wins < 1 || previousLoser.losses < 1) {
        return { kind: "stats-inconsistent" as const };
      }

      previousResult = {
        score_team_a: match.score_team_a,
        score_team_b: match.score_team_b,
        winner: match.winner,
      };
      previousWinner.wins -= 1;
      previousLoser.losses -= 1;
    }

    winner.wins += 1;
    dqTeam.losses += 1;
    match.status = "disqualified";
    match.score_team_a = 0;
    match.score_team_b = 0;
    match.winner = winner.team_name;
    match.completed_at = new Date().toISOString();
    match.disqualified_team = dqTeam.team_name;
    match.disqualification_reason = reason;
    match.previous_result = previousResult;
    return { kind: "disqualified" as const, match };
  });

  if (result.kind === "missing") {
    await interaction.editReply(`Match **${matchId}** was not found.`);
    return;
  }
  if (result.kind === "already-disqualified") {
    await interaction.editReply("This match is already marked as disqualified; stats were not changed again.");
    return;
  }
  if (result.kind === "invalid-status") {
    await interaction.editReply("This match cannot be disqualified from its current status.");
    return;
  }
  if (result.kind === "missing-team") {
    await interaction.editReply("The match's teams could not be found; no stats were changed.");
    return;
  }
  if (result.kind === "not-in-match") {
    await interaction.editReply("Choose Team A or Team B from this match as the disqualified team.");
    return;
  }
  if (result.kind === "invalid-previous-result") {
    await interaction.editReply("The completed match has no valid recorded winner; no stats were changed.");
    return;
  }
  if (result.kind === "stats-inconsistent") {
    await interaction.editReply("Team records do not match the saved result; no stats were changed.");
    return;
  }

  const match = result.match;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`Match Disqualification · ${match.match_id}`)
    .setDescription(`**${match.disqualified_team}** has been disqualified from this match.`)
    .addFields(
      { name: "Format", value: match.format.toUpperCase(), inline: true },
      { name: "Default winner", value: `🏆 **${match.winner}**`, inline: true },
      {
        name: "Reason",
        value: match.disqualification_reason ?? "No reason provided.",
      },
    );
  if (match.previous_result) {
    embed.addFields({
      name: "Prior result voided",
      value: `${match.team_a} ${match.previous_result.score_team_a} - ${match.previous_result.score_team_b} ${match.team_b}`,
    });
  }
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

function isUnknownChannelError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number(error.code) === 10003
  );
}

async function deleteIfPresent(guild: Guild, channelId: string): Promise<void> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel) await channel.delete("Tournament match cleanup.");
  } catch (error) {
    if (!isUnknownChannelError(error)) throw error;
  }
}

async function removeMatch(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> {
  if (!requireOrganizer(interaction)) return;
  const matchId = interaction.options.getString("match_id", true);
  const match = findMatch((await getState()).matches, guildId, matchId);
  if (!match) {
    await replyError(interaction, `Match **${matchId}** was not found.`);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await deleteIfPresent(guild, match.team_a_vc_id);
    await deleteIfPresent(guild, match.team_b_vc_id);
    await deleteIfPresent(guild, match.veto_channel_id);
    await deleteIfPresent(guild, match.category_id);
    const cleanupResult = await updateState((state) => {
      const currentMatch = findMatch(state.matches, guildId, match.match_id);
      if (!currentMatch) return "removed";
      currentMatch.channels_deleted = true;
      if (
        currentMatch.status === "completed" ||
        currentMatch.status === "disqualified"
      ) {
        return "history-retained";
      }
      state.matches = state.matches.filter(
        (candidate) =>
          candidate.match_id !== match.match_id ||
          candidate.guild_id !== guildId,
      );
      return "removed";
    });
    await interaction.editReply(
      cleanupResult === "history-retained"
        ? `Match **${match.match_id}** channels were removed; its result remains in match history.`
        : `Match **${match.match_id}** and its generated channels were removed.`,
    );
  } catch (error) {
    logger.error({ err: error, matchId: match.match_id }, "Failed to remove match channels");
    await interaction.editReply(
      "Some match channels could not be deleted. The saved match remains so cleanup can be retried.",
    );
  }
}
