import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { logger } from "../lib/logger";
import { slashCommands } from "./commands";
import {
  handleAutocomplete,
  handleSlashCommand,
  handleVetoSelection,
} from "./handlers";
import { initializeState } from "./store";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error(
    "DISCORD_TOKEN is missing. Add the Discord bot token in Replit Secrets before starting the bot.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const route = guildId
    ? Routes.applicationGuildCommands(readyClient.application.id, guildId)
    : Routes.applicationCommands(readyClient.application.id);

  try {
    await rest.put(route, { body: slashCommands.map((command) => command.toJSON()) });
    logger.info(
      {
        botUser: readyClient.user.tag,
        commandScope: guildId ? "guild" : "global",
        guildId: guildId || undefined,
      },
      "Valorant tournament bot is online and slash commands are registered",
    );
  } catch (error) {
    logger.error({ err: error }, "Could not register Discord slash commands");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    } else if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("veto:")) {
      await handleVetoSelection(interaction);
    }
  } catch (error) {
    logger.error({ err: error }, "Unhandled Discord interaction error");
    if (interaction.isRepliable()) {
      const response = {
        content: "The command could not be completed. Check the bot logs for details.",
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response).catch(() => undefined);
      } else {
        await interaction.reply(response).catch(() => undefined);
      }
    }
  }
});

client.on(Events.Error, (error) => {
  logger.error({ err: error }, "Discord client error");
});

process.on("SIGINT", () => {
  logger.info("Stopping Discord client");
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Stopping Discord client");
  client.destroy();
  process.exit(0);
});

await initializeState();
await client.login(token);
