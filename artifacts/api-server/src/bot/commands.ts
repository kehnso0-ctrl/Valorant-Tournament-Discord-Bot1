import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const organizerPermission = PermissionFlagsBits.ManageGuild;
const disqualifyPermission = PermissionFlagsBits.ManageChannels;

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("createteam")
    .setDescription("Create a tournament team.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("team_name")
        .setDescription("A unique team name.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMinLength(1)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("addteam")
    .setDescription("Set a team's captain and add its roster members.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("team_name")
        .setDescription("The team to update.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    )
    .addUserOption((option) =>
      option
        .setName("team_captain")
        .setDescription("The team's captain.")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("team_members")
        .setDescription("Mention the team members, for example @Player1 @Player2.")
        .setRequired(true)
        .setMaxLength(1000),
    ),
  new SlashCommandBuilder()
    .setName("removeteam")
    .setDescription("Delete a tournament team.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("team_name")
        .setDescription("The team to delete.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("teamlist")
    .setDescription("List tournament teams in this server."),
  new SlashCommandBuilder()
    .setName("teaminfo")
    .setDescription("Show a team's captain and roster, or your own team.")
    .addStringOption((option) =>
      option
        .setName("team_name")
        .setDescription("Optional team to look up.")
        .setRequired(false)
        .setAutocomplete(true)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("creatematch")
    .setDescription("Create a match with a random turn order and format.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("team_a")
        .setDescription("Team A.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    )
    .addStringOption((option) =>
      option
        .setName("team_b")
        .setDescription("Team B.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("startmatch")
    .setDescription("Start the map veto in the match's veto-room.")
    .addStringOption((option) =>
      option
        .setName("match_id")
        .setDescription("The match ID shown when the match was created.")
        .setRequired(true)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("endmatch")
    .setDescription("Record the final score and update the team records.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("match_id")
        .setDescription("An in-progress match.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    )
    .addIntegerOption((option) =>
      option
        .setName("score_team_a")
        .setDescription("Team A's final score.")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99),
    )
    .addIntegerOption((option) =>
      option
        .setName("score_team_b")
        .setDescription("Team B's final score.")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99),
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show this server's tournament standings."),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recent completed or disqualified matches.")
    .addStringOption((option) =>
      option
        .setName("team_name")
        .setDescription("Optional team to filter by.")
        .setRequired(false)
        .setAutocomplete(true)
        .setMaxLength(32),
    ),
  new SlashCommandBuilder()
    .setName("disqualifymatch")
    .setDescription("Disqualify a team and award the match to its opponent.")
    .setDefaultMemberPermissions(disqualifyPermission)
    .addStringOption((option) =>
      option
        .setName("match_id")
        .setDescription("The match to disqualify.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    )
    .addStringOption((option) =>
      option
        .setName("dq_team")
        .setDescription("The team being disqualified.")
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(32),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Optional reason for the disqualification.")
        .setRequired(false)
        .setMaxLength(300),
    ),
  new SlashCommandBuilder()
    .setName("removematch")
    .setDescription("Delete a match and its generated Discord channels.")
    .setDefaultMemberPermissions(organizerPermission)
    .addStringOption((option) =>
      option
        .setName("match_id")
        .setDescription("The match ID to clean up.")
        .setRequired(true)
        .setMaxLength(32),
    ),
].map((command) => command.setDMPermission(false));
