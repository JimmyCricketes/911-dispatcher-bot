# Gun Whitelist System Setup

Discord mods message a channel → Updates GitHub Gist → Studio plugin fetches and updates script

## Step 1: Create GitHub Gist

1. Go to https://gist.github.com
2. Create a **public** gist with filename: `whitelist.json`
3. Initial content:
```json
{}
```
4. Save and copy the **Gist ID** from the URL:
   `https://gist.github.com/YourUsername/THIS_IS_THE_GIST_ID`

## Step 2: Create GitHub Token

1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. Check **only** the `gist` scope
4. Copy the token

## Step 3: Add Environment Variables on Render

Add these to your bot's environment:

| Variable | Value |
|----------|-------|
| `GIST_ID` | Your Gist ID from step 1 |
| `GITHUB_TOKEN` | Your token from step 2 |
| `WHITELIST_CHANNEL_ID` | Discord channel ID for whitelist commands |

## Step 4: Integrate with Your Bot

Add to your existing bot code:

```javascript
// At the top with other requires
const { handleWhitelistCommand, initWhitelist } = require('./whitelist-handler');

// In your ready event
client.once('ready', async () => {
    console.log(`Ready as ${client.user.tag}`);
    await initWhitelist();
});

// In your messageCreate handler, add at the start:
client.on('messageCreate', async msg => {
    // Handle whitelist commands first
    if (await handleWhitelistCommand(msg)) return;
    
    // ... rest of your existing handler
});
```

## Step 5: Install Studio Plugin

1. Copy `WhitelistSyncPlugin.lua` to:
   ```
   %localappdata%\Roblox\Plugins\WhitelistSyncPlugin.lua
   ```
2. Open the plugin file and set your `GIST_ID`:
   ```lua
   local GIST_ID = "abc123yourGistId"
   ```
3. Set `SCRIPT_PATH` to match your script location:
   ```lua
   local SCRIPT_PATH = "ServerScriptService.GunGiver"
   ```
4. Restart Studio

## Usage

### Discord Commands (in whitelist channel)

```
!whitelist help                              - Show commands
!whitelist add 12345678 M1911 .38 SNUBNOSE  - Add user with guns
!whitelist remove 12345678                   - Remove user entirely
!whitelist remove 12345678 M1911             - Remove specific gun
!whitelist lookup 12345678                   - Check user's guns
!whitelist list                              - Show all entries
```

### Studio

1. Open your game in Studio
2. Click **"Sync Whitelist"** in the plugin toolbar
3. Script updates automatically with undo support

Or use **"Preview"** to see changes before applying.

## Available Guns

- `M1911`
- `.38 SNUBNOSE`
- `M1928 TOMMY GUN`
- `M1897 Shotgun`

To add more, edit `VALID_GUNS` in `whitelist-handler.js`.
