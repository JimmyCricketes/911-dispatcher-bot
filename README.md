# 🚨 911 Dispatcher Bot

A complete Discord-to-Roblox communication system that allows Discord dispatchers to send messages to players who call 911 in a Roblox payphone game.

## 📋 Table of Contents
- [Architecture](#architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
  - [1. Discord Bot Setup](#1-discord-bot-setup)
  - [2. Roblox API Key Setup](#2-roblox-api-key-setup)
  - [3. Deploy to Railway](#3-deploy-to-railway)
  - [4. Add Roblox Server Code](#4-add-roblox-server-code)
- [Command Reference](#command-reference)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture

```
┌─────────────┐         ┌──────────────┐         ┌────────────────┐
│   Discord   │         │  Discord Bot │         │ Roblox Open    │
│ (Dispatcher)│ ───────>│  (Node.js)   │ ───────>│ Cloud API      │
└─────────────┘         └──────────────┘         └────────────────┘
                                                           │
                                                           v
                        ┌──────────────┐         ┌────────────────┐
                        │  Player's    │<────────│ MessagingService│
                        │  Phone UI    │         │  (Roblox Game) │
                        └──────────────┘         └────────────────┘
```

**Flow:**
1. Dispatcher types `!d <callId> <message>` in Discord
2. Discord bot receives command and validates it
3. Bot sends message to Roblox Open Cloud MessagingService API
4. Roblox game receives message via MessagingService
5. Message is delivered to the player's phone UI in-game
6. Bot reacts with ✅ (success) or ❌ (failure)

## ✨ Features

- **Simple Command Interface**: Use `!d <callId> <message>` to send messages
- **Real-time Communication**: Messages delivered instantly via Roblox MessagingService
- **Visual Feedback**: Bot reacts with ✅ or ❌ to confirm delivery
- **Call ID Tracking**: Each emergency call has a unique ID for dispatcher replies
- **Transcript Logging**: All dispatcher messages are logged in the call transcript
- **Free Hosting**: Deploy on Railway.app for free (no credit card required)

## 📦 Prerequisites

- **Node.js 18+** (if running locally)
- **Discord Bot** with Message Content intent enabled
- **Roblox Game** with MessagingService and HttpService enabled
- **Roblox Open Cloud API Key** with MessagingService permissions
- **Railway Account** (free tier available)

## 🚀 Setup Instructions

### 1. Discord Bot Setup

1. **Create a Discord Application:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application"
   - Give it a name (e.g., "911 Dispatcher Bot")
   - Go to the "Bot" section
   - Click "Add Bot" and confirm

2. **Configure Bot Settings:**
   - Under "Privileged Gateway Intents", enable:
     - ✅ Message Content Intent
     - ✅ Server Members Intent (optional)
   - Click "Save Changes"

3. **Get Bot Token:**
   - In the "Bot" section, click "Reset Token"
   - Copy the token (save it for later - you won't see it again!)
   - **Keep this token secret!**

4. **Invite Bot to Your Server:**
   - Go to "OAuth2" > "URL Generator"
   - Select scopes:
     - ✅ `bot`
   - Select bot permissions:
     - ✅ Read Messages/View Channels
     - ✅ Send Messages
     - ✅ Add Reactions
   - Copy the generated URL and open it in your browser
   - Select your Discord server and authorize

### 2. Roblox API Key Setup

1. **Get Your Universe ID:**
   - Go to [Roblox Creator Dashboard](https://create.roblox.com/dashboard/creations)
   - Open your game
   - The URL will look like: `https://create.roblox.com/dashboard/creations/experiences/123456789/...`
   - The number `123456789` is your Universe ID

2. **Create an Open Cloud API Key:**
   - Go to [Roblox Creator Dashboard](https://create.roblox.com/dashboard/credentials)
   - Click "Create API Key"
   - Name it: "911 Dispatcher Bot"
   - Select "Messaging Service" from the API System dropdown
   - Add your game under "Experience"
   - Select your Universe ID
   - Set Access Permissions: **Publish**
   - (Optional) Set IP whitelist for extra security
   - Click "Save & Generate Key"
   - **Copy the API key immediately** (you won't see it again!)

### 3. Deploy to Railway

**Note:** Railway is the recommended hosting platform since Glitch's free tier ended in July 2025. Railway offers free hosting with no credit card required.

1. **Create Railway Account:**
   - Go to [Railway.app](https://railway.app)
   - Click "Login" and sign in with GitHub

2. **Deploy This Repository:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub
   - Select this repository (`911-dispatcher-bot`)
   - Railway will automatically detect Node.js and deploy

3. **Add Environment Variables:**
   - In your Railway project, click on your service
   - Go to "Variables" tab
   - Add the following variables:
     ```
     DISCORD_TOKEN=your_discord_bot_token_here
     ROBLOX_API_KEY=your_roblox_api_key_here
     UNIVERSE_ID=123456789
     ```
   - Click "Add" for each variable

4. **Verify Deployment:**
   - Go to "Deployments" tab
   - Wait for deployment to complete (green checkmark)
   - Go to "Settings" tab
   - Click "Generate Domain" under "Networking" to get a public URL
   - Visit the URL - you should see "Bot Online"
   - Check the logs - you should see "Bot ready!"

**Alternative Hosting Options:**
- **Render.com**: Free tier available, similar to Railway
- **Heroku**: Paid plans only (free tier removed in Nov 2022)
- **Local Hosting**: Run `npm install && npm start` on your own computer

### 4. Add Roblox Server Code

1. **Enable Required Services:**
   - Open your Roblox game in Studio
   - Go to "Home" > "Game Settings" > "Security"
   - Enable "Allow HTTP Requests"
   - Enable "Enable Studio Access to API Services"

2. **Add Dispatcher Listener:**
   - Open your PayphoneServer script
   - Copy the code from `roblox/PayphoneServerAdditions.lua`
   - Paste it at the bottom of your PayphoneServer script
   - Make sure `HttpService` is referenced at the top of your script

3. **Update Emergency Embed:**
   - Find your `buildEmergencyEmbed` function
   - Replace it with the code from `roblox/UpdatedEmergencyEmbed.lua`
   - This adds the Call ID to the Discord webhook footer

4. **Test in Studio:**
   - Run the game in Studio
   - Check the Output window for: `[Payphone Server] Dispatcher listener active`
   - Make a test 911 call
   - Check that the Discord webhook shows the Call ID

5. **Publish to Production:**
   - Publish your game to Roblox
   - Test with a real 911 call
   - Try sending a message from Discord using `!d <callId> <message>`

## 📖 Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `!d <callId> <message>` | Send a message to an active 911 call | `!d 555-0123 Officers are on the way` |

**Notes:**
- `<callId>` can be either the log ID or the caller's phone number
- The bot will react with ✅ if the message was sent successfully
- The bot will react with ❌ if there was an error
- Messages appear in the caller's phone UI as "911 Dispatch"

## 🔧 Troubleshooting

### Bot doesn't respond to commands

**Solution:**
- Make sure "Message Content Intent" is enabled in Discord Developer Portal
- Verify the bot has permission to read messages in the channel
- Check Railway logs for errors
- Ensure environment variables are set correctly

### Bot reacts with ❌

**Possible causes:**
1. **Invalid Roblox API Key**
   - Verify the API key is correct
   - Check that MessagingService permission is enabled
   - Ensure the Universe ID is correct

2. **MessagingService Rate Limit**
   - Roblox limits MessagingService to 150 requests per minute
   - Wait a minute and try again

3. **Call ID not found**
   - Verify the call is still active
   - Check that the Call ID matches the webhook footer
   - Try using the phone number instead

### Messages not appearing in-game

**Solution:**
- Check Roblox Studio Output for errors
- Verify MessagingService is enabled
- Ensure HttpService is enabled
- Check that the `setupDispatcherListener()` function is called
- Verify the call is in "connected" status

### Bot is offline

**Solution:**
- Check Railway deployment status
- View logs in Railway dashboard
- Verify `DISCORD_TOKEN` environment variable is set
- Try redeploying the project

### Railway deployment fails

**Solution:**
- Ensure `package.json` has correct Node.js version (18+)
- Check build logs for specific errors
- Verify all files are committed to GitHub
- Try triggering a manual redeploy

## 📝 File Structure

```
911-dispatcher-bot/
├── index.js                           # Discord bot (main file)
├── package.json                       # Node.js dependencies
├── .env.example                       # Environment variables template
├── .gitignore                         # Git ignore rules
├── README.md                          # This file
└── roblox/
    ├── PayphoneServerAdditions.lua    # Server code for receiving messages
    └── UpdatedEmergencyEmbed.lua      # Updated webhook embed with Call ID
```

## 🤝 Contributing

This is an open-source project. Feel free to submit issues or pull requests!

## 📄 License

MIT License - feel free to use this code for your own projects.

## ⚠️ Security Notes

- Never commit your `.env` file to Git
- Keep your Discord bot token secret
- Keep your Roblox API key secret
- Use IP whitelisting on your Roblox API key if possible
- Regularly rotate your API keys

## 💡 Tips

- Test the bot in a private Discord channel first
- Monitor Railway logs during initial setup
- Keep your Roblox game's MessagingService usage under the rate limit
- Consider adding command permissions to restrict who can use `!d`
- Add logging to track dispatcher activity

## 🆘 Support

If you encounter issues:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review Railway logs for error messages
3. Check Roblox Studio Output for Lua errors
4. Open an issue on GitHub with details

---

**Made with ❤️ for emergency roleplay games**
