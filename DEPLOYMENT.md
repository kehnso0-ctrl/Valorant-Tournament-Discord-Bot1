# Self-hosting the Valorant Tournament Discord Bot

This guide explains how to run this repository's Discord bot on your own computer or keep it online on a cloud host.

## Before you start

- You need a Discord account with permission to add an app to the tournament server.
- The repository is a **pnpm workspace**. Run workspace commands from the repository root, not from `artifacts/api-server`.
- Use **Node.js 22 LTS or newer** and **pnpm 10**. Node 22+ is also needed for the `--env-file` command shown below.
- The bot connects to Discord over an outbound WebSocket. It does **not** serve a website or need an inbound network port.
- Run one bot process per bot token. Multiple copies can handle the same interactions and their local JSON data will not stay in sync.

## 1. Set up the Discord application

### Create the app and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and sign in.
2. Select **New Application**, enter a name, and create it.
3. On **General Information**, copy the **Application ID**. Discord also calls this the Client ID. It is used when inviting the bot; it is not a secret.
4. Open **Bot** in the left menu. If a bot user has not been created yet, select **Add Bot**.
5. On the Bot page, select **Reset Token** (or **View Token**, if shown) and copy the bot token. Store it privately. Anyone with this token can control the bot, so never commit it to Git or post it in chat.

### Gateway intents

The current code requests these intents:

| Intent             | Requested by this bot? | Privileged in Discord? | What to do                                                                                                                                     |
| ------------------ | ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Guilds`           | Yes                    | No                     | No Developer Portal toggle is needed.                                                                                                          |
| `GuildVoiceStates` | Yes                    | No                     | No Developer Portal toggle is needed. This is used for voice-channel moves.                                                                    |
| `GuildMembers`     | Yes                    | **Yes**                | On the app's **Bot** page, enable **Server Members Intent** under **Privileged Gateway Intents**.                                              |
| `GuildMessages`    | No                     | No                     | The bot currently uses slash commands and interaction components, not regular message events. It does not need this intent or a portal toggle. |

Only **Server Members Intent** is required from that list. `Guilds`, `GuildVoiceStates`, and `GuildMessages` are regular gateway intents, not privileged portal toggles. The bot also does not read message contents, so do not enable **Message Content Intent** for this code.

If you later add a feature that listens to ordinary messages, update the Discord.js `Client` intents in `artifacts/api-server/src/bot/index.ts`. If that feature needs the text of messages, it will also need the privileged **Message Content Intent** and the matching code intent.

See Discord's [Gateway intent documentation](https://docs.discord.com/developers/events/gateway) for current details.

### Invite the bot to your server

1. In the Developer Portal, open **OAuth2 → URL Generator**.
2. Under **Scopes**, select `bot` and `applications.commands`.
3. Under **Bot Permissions**, select only the permissions this bot needs:
   - Manage Channels
   - Move Members
   - View Channels
   - Send Messages
   - Embed Links
4. Open the generated URL, select your server, and authorize the bot.
5. In Discord, make sure the bot's role is allowed to see the channels it creates. Its role must also be high enough in the role list to move the tournament players you want it to move.

The Application ID / Client ID is used by the invite flow. The bot reads its application ID from Discord when it logs in, so **this project does not require a `CLIENT_ID` environment variable**.

To get your server ID for testing, enable **User Settings → Advanced → Developer Mode**, then right-click the server icon and choose **Copy Server ID**.

## 2. Configure environment variables

The bot reads these names:

| Variable           | Required? | Purpose                                                                                                                                                                       |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`    | Yes       | The bot token from the Developer Portal.                                                                                                                                      |
| `DISCORD_GUILD_ID` | No        | If set, the bot registers slash commands only in this server. Useful while testing because server-scoped commands update quickly. If unset, commands are registered globally. |

Names such as `TOKEN`, `CLIENT_ID`, and `GUILD_ID` are common in generic bot tutorials, but this code does not read those names. Use `DISCORD_TOKEN` and `DISCORD_GUILD_ID`. Do not add a Client ID unless you change the code to use one.

Create a file named `.env` in the **repository root**:

```dotenv
DISCORD_TOKEN=paste_your_bot_token_here

# Optional: uncomment and replace this with your test server's ID.
# When set, slash commands are registered only in this server.
# DISCORD_GUILD_ID=123456789012345678
```

Keep `.env` private. It is ignored by the repository's `.gitignore`; do not remove that protection or commit the file. For cloud hosting, enter these values in the provider's private environment-variable/secrets settings instead of committing `.env`.

## 3. Run the bot on your own computer

### Install the tools and project dependencies

1. Install Git and Node.js 22 LTS or newer from [nodejs.org](https://nodejs.org/).
2. Open Terminal (macOS/Linux) or PowerShell (Windows).
3. Clone the repository and enter its root folder:

   ```sh
   git clone <your-repository-url>
   cd <repository-folder>
   ```

   If you already have the repository on your computer, open a terminal in its root folder instead.

4. Install pnpm 10:

   ```sh
   npm install --global pnpm@10
   ```

5. Install the workspace dependencies from the repository root:

   ```sh
   pnpm install --frozen-lockfile --prod=false
   ```

   Keep development dependencies installed: this bot's start script uses `tsx`, which is listed as a development dependency.

6. Create the root `.env` file using the example above.

### Start it

From the repository root, start the bot and load `.env` with Node:

**macOS/Linux**

```sh
node --env-file=.env ./artifacts/api-server/node_modules/tsx/dist/cli.mjs ./artifacts/api-server/src/bot/index.ts
```

**Windows PowerShell**

```powershell
node --env-file=.env .\artifacts\api-server\node_modules\tsx\dist\cli.mjs .\artifacts\api-server\src\bot\index.ts
```

The project does not automatically load `.env` when you run its pnpm scripts. The commands above use Node's `--env-file` option so you do not have to paste the token into the terminal command.

When the logs say **“Valorant tournament bot is online and slash commands are registered”**, it has connected successfully. Keep the terminal open while you want the bot online. Press **Ctrl+C** to stop it.

For development with automatic restarts after code edits, run the same command with `watch`:

```sh
node --env-file=.env ./artifacts/api-server/node_modules/tsx/dist/cli.mjs watch ./artifacts/api-server/src/bot/index.ts
```

### Local computer limitations

The bot is online only while the computer is on, connected to the internet, and the process is running. Closing the terminal, sleeping the computer, or losing internet disconnects it. Use a cloud host for continuous uptime.

## 4. Keep it online in the cloud

### Important setup rules for every provider

- Connect/deploy the **repository root**. Do not set the service root to `artifacts/api-server`; the pnpm workspace and lockfile are at the repository root.
- Install with `pnpm install --frozen-lockfile --prod=false`.
- Use this start command:

  ```sh
  pnpm --filter @workspace/api-server run bot:start
  ```

- Set `DISCORD_TOKEN` and, if wanted, `DISCORD_GUILD_ID` in the provider's environment-variable settings.
- Run a **single replica/instance**. The bot stores records in a local JSON file and is not designed to coordinate multiple running copies.
- Do not configure a web-service port or open an inbound app port. Discord connections are outbound.

### Railway

Railway is a managed option that can deploy from GitHub and attach persistent storage.

1. Push the repository to a private or public GitHub repository.
2. In Railway, create a project and deploy the GitHub repository.
3. Keep the service's root directory at the repository root.
4. Configure the install/build step to install the full workspace:

   ```sh
   pnpm install --frozen-lockfile --prod=false
   ```

5. Set the start command to:

   ```sh
   pnpm --filter @workspace/api-server run bot:start
   ```

6. Add `DISCORD_TOKEN` and optional `DISCORD_GUILD_ID` under the service's **Variables**. Do not put the token in the build or start command.
7. Attach a volume to the bot service and set its mount path to:

   ```text
   /app/artifacts/api-server/data
   ```

   Railway places service files under `/app`; this volume path preserves the bot's JSON state across redeploys and restarts. Confirm the path if you change the service's working directory.

8. Deploy and check the service logs for the online/command-registration message.

**Free and paid:** Railway's current Free plan includes limited monthly usage credit; a continuously connected bot may use more than the included amount. The Hobby plan currently has a **$5/month** base fee, which includes $5 of resource usage; usage beyond that is billed separately. Check [Railway plans and pricing](https://docs.railway.com/pricing/plans) and set spending limits/alerts before leaving the bot online.

### Render

Create a **Background Worker**, not a web service. A background worker is intended for a process that runs continuously without serving HTTP requests.

1. In Render, choose **New → Background Worker** and connect the GitHub repository.
2. Leave the root directory at the repository root.
3. Set the build command to:

   ```sh
   pnpm install --frozen-lockfile --prod=false
   ```

4. Set the start command to:

   ```sh
   pnpm --filter @workspace/api-server run bot:start
   ```

5. Add `DISCORD_TOKEN` and optional `DISCORD_GUILD_ID` under **Environment**.
6. Add a persistent disk to the worker. Set its mount path to:

   ```text
   /opt/render/project/src/artifacts/api-server/data
   ```

   This is the bot's data directory when the repository root is `/opt/render/project/src`. Only files under the disk mount path persist after deploys/restarts. See Render's [persistent disk guide](https://docs.render.com/disks).

7. Deploy and inspect the worker logs.

**Free and paid:** Render's free web services can sleep and are not suitable for a continuously connected Discord bot. Render background workers use paid compute; the current smallest worker plan is listed at **$7/month** for 0.5 CPU / 512 MB, and persistent disk storage is currently **$0.25/GB/month**. Confirm current rates on [Render pricing](https://render.com/pricing). Render's [background worker guide](https://docs.render.com/background-workers) explains the service type.

### DigitalOcean Droplet

A Droplet is a small Linux virtual machine. It gives you a normal server with a persistent disk and is a good fit for PM2.

1. In DigitalOcean, choose **Create → Droplets**.
2. Choose Ubuntu 24.04 (or a current supported Ubuntu LTS), a nearby data-center region, and a Basic/shared CPU plan. Choose at least **1 GB RAM** for comfortable installation and operation.
3. Add an SSH key during creation instead of enabling password login if possible.
4. In the cloud firewall, allow SSH (TCP port 22) only from your own IP address. You do not need to open any port for the Discord bot.
5. Connect to the server using SSH, then follow **Common Ubuntu VPS setup** below.

DigitalOcean Droplets are paid virtual machines; new-account credits or promotions can change. Check the [Droplet pricing page](https://www.digitalocean.com/pricing/droplets) before creating one.

### AWS: Lightsail or EC2

For a first AWS deployment, **Lightsail** is usually simpler than configuring EC2 networking. An EC2 instance also works if you are comfortable with AWS security groups and billing.

1. In AWS Lightsail, create an instance using a current Ubuntu LTS image. Choose a plan with at least **1 GB RAM** if available.
2. Choose a region near you, create/download an SSH key, and connect to the instance. For EC2, create an Ubuntu instance and allow SSH on port 22 only from your IP address in its security group.
3. Do not open an inbound application port; the bot makes outbound connections to Discord.
4. Connect to the instance using SSH, then follow **Common Ubuntu VPS setup** below.

Lightsail and EC2 are paid services. AWS Free Tier/trial eligibility depends on account age and current offer terms; it is not a promise of permanent free hosting. Check [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/), the [Lightsail instance plans](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), and [AWS Free Tier usage rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html). Set an AWS billing budget/alert before launch.

### Common Ubuntu VPS setup (DigitalOcean or AWS)

Use a non-root Linux account to run the bot. If your provider already gave you a regular account with `sudo` access, use it and skip creating another account. Otherwise, while signed in to the initial server account, create one:

```sh
sudo adduser bot
sudo usermod -aG sudo bot
sudo su - bot
```

Install Git and curl:

```sh
sudo apt update
sudo apt install -y curl git
```

Install Node.js 22 with the official [nvm installer](https://github.com/nvm-sh/nvm#installing-and-updating), then install pnpm and PM2:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
npm install --global pnpm@10 pm2
```

Clone the repository, install all dependencies, and create the `.env` file:

```sh
git clone <your-repository-url>
cd <repository-folder>
pnpm install --frozen-lockfile --prod=false
nano .env
```

Paste the `DISCORD_TOKEN` line from the environment-variable example, save (`Ctrl+O`, then Enter), and exit (`Ctrl+X`). If you use a test server, add `DISCORD_GUILD_ID` on another line. Protect the file, then continue to the **PM2** section:

```sh
chmod 600 .env
```

## 5. Keep a VPS process alive with PM2

Railway and Render supervise their own service processes, so PM2 is normally unnecessary there. On a VPS, PM2 can restart the bot after a crash and restore it after a server reboot.

Install PM2 on the VPS:

```sh
npm install --global pm2
```

Create `ecosystem.config.js` in the repository root:

```js
module.exports = {
  apps: [
    {
      name: "valorant-tournament-bot",
      cwd: `${__dirname}/artifacts/api-server`,
      script: "./node_modules/tsx/dist/cli.mjs",
      args: "src/bot/index.ts",
      node_args: "--env-file=../../.env",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
```

The config loads `.env` from the repository root and starts the same TypeScript bot entry point as the pnpm command. Make sure `pnpm install --frozen-lockfile --prod=false` has completed and `.env` is in the root. On Linux, restrict access to the token file:

```sh
chmod 600 .env
```

Start it and check the logs:

```sh
pm2 start ecosystem.config.js
pm2 status
pm2 logs valorant-tournament-bot
```

Configure PM2 to start after a reboot:

```sh
pm2 startup
```

PM2 prints a command for your operating system. Copy and run that command, then save the process list:

```sh
pm2 save
```

Useful commands:

```sh
pm2 restart valorant-tournament-bot
pm2 stop valorant-tournament-bot
pm2 logs valorant-tournament-bot
```

After changing `.env`, restart the process so it reloads the file. PM2's startup integration is intended for Linux/macOS service managers; for Windows, use a Windows service manager or Task Scheduler rather than assuming `pm2 startup` is available.

## 6. Protect and move tournament data

The bot stores teams and matches in:

```text
artifacts/api-server/data/valorant-bot-state.json
```

This file is intentionally excluded from Git. A fresh cloud deployment cloned from GitHub will **not** automatically contain your existing Replit teams or match history.

- If you want to move existing records, stop the current bot, securely copy the JSON state file into the same relative path on the new host, and then start only one copy of the bot.
- Railway and Render need a persistent volume/disk mounted at the data path described above. Without it, a deploy or restart can erase the JSON file.
- A VPS keeps files on its disk through a normal process restart, but a disk failure or server deletion can still lose them. Keep a separate backup.
- Before manually copying or restoring the JSON file, stop the bot so it cannot write at the same time.

## Troubleshooting

- **`DISCORD_TOKEN is missing`** — confirm the variable is named `DISCORD_TOKEN`, and that the root `.env` is being loaded locally or the variable is set in the cloud dashboard.
- **Discord says the token is invalid** — reset/copy the bot token from Developer Portal → Bot and update the secret. Never use the Application ID as the token.
- **Privileged intent error** — enable **Server Members Intent** on the Developer Portal Bot page. The current bot does not need `GuildMessages` or Message Content Intent.
- **Commands do not appear** — check the logs for successful command registration. For development, set `DISCORD_GUILD_ID` to the server where the bot was invited. If that variable is set to the wrong server, commands will be registered there instead.
- **The bot is online but cannot create channels or move players** — check its server/channel permissions and role position. It needs Manage Channels and Move Members for those features.
- **Team data disappeared after deploy** — confirm the volume/disk is mounted at the exact `artifacts/api-server/data` path and restore from a backup if needed.
- **The host keeps starting multiple copies** — reduce the service to one replica/instance.

## Official hosting references

- [Discord Gateway intents](https://docs.discord.com/developers/events/gateway)
- [Discord OAuth2 scopes and permissions](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- [Railway pricing](https://docs.railway.com/pricing/plans) and [volumes](https://docs.railway.com/guides/volumes)
- [Render background workers](https://docs.render.com/background-workers), [persistent disks](https://docs.render.com/disks), and [pricing](https://render.com/pricing)
- [DigitalOcean Droplet creation](https://docs.digitalocean.com/products/droplets/how-to/create/) and [pricing](https://www.digitalocean.com/pricing/droplets)
- [AWS Lightsail plans](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html) and [Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
- [PM2 ecosystem files](https://pm2.keymetrics.io/docs/usage/application-declaration/) and [startup scripts](https://pm2.keymetrics.io/docs/usage/startup/)

Cloud prices and free-tier rules change. The provider links above are the source of truth before you create a service.
