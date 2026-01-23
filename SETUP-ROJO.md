# Gun Whitelist System - Rojo Setup

Discord mods message channel → Bot updates Gist → Local watcher writes .lua → Rojo syncs to Studio

## Architecture

```
Discord: !whitelist add 12345 M1911
              ↓
     Bot (Render) updates GitHub Gist
              ↓
     Local watcher polls Gist every 30s
              ↓
     Writes src/server/UserIDs.lua
              ↓
     Rojo syncs to Studio automatically
```

---

## Step 1: GitHub Gist Setup

1. Go to https://gist.github.com
2. Create a **public** gist:
   - Filename: `whitelist.json`
   - Content: `{}`
3. Copy the **Gist ID** from URL: `https://gist.github.com/You/GIST_ID_HERE`

## Step 2: GitHub Token (for bot)

1. https://github.com/settings/tokens → Generate new token (classic)
2. Select only `gist` scope
3. Copy token

## Step 3: Render Environment Variables

Add to your Discord bot on Render:

| Variable | Value |
|----------|-------|
| `GIST_ID` | Your Gist ID |
| `GITHUB_TOKEN` | Your token |
| `WHITELIST_CHANNEL_ID` | Discord channel ID |

## Step 4: Add to Your Bot

```javascript
const { handleWhitelistCommand, initWhitelist } = require('./whitelist-handler');

client.once('ready', async () => {
    await initWhitelist();
});

client.on('messageCreate', async msg => {
    if (await handleWhitelistCommand(msg)) return;
    // ... existing code
});
```

## Step 5: Rojo Project Structure

Your project should look like:

```
your-game/
├── default.project.json
├── src/
│   └── server/
│       ├── GunGiver.server.lua
│       └── UserIDs.lua          ← Auto-generated
```

**default.project.json:**
```json
{
  "name": "YourGame",
  "tree": {
    "$className": "DataModel",
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "$path": "src/server"
    }
  }
}
```

**GunGiver.server.lua** - Use the version that requires UserIDs:
```lua
local UserIDs = require(script.Parent.UserIDs)
-- rest of script...
```

## Step 6: Run Local Watcher

In your Rojo project folder, run:

```bash
# Windows (PowerShell)
$env:GIST_ID="your_gist_id"; node path/to/whitelist-watcher.js

# Or create a .env file and use:
# Windows
set GIST_ID=your_gist_id && set OUTPUT_PATH=./src/server/UserIDs.lua && node whitelist-watcher.js
```

Or create `watch.bat`:
```batch
@echo off
set GIST_ID=your_gist_id
set OUTPUT_PATH=./src/server/UserIDs.lua
set POLL_INTERVAL=30
node whitelist-watcher.js
```

## Step 7: Run Rojo

In another terminal:
```bash
rojo serve
```

Connect in Studio with Rojo plugin.

---

## Usage

### Discord Commands
```
!whitelist add 12345678 M1911 .38 SNUBNOSE
!whitelist remove 12345678
!whitelist remove 12345678 M1911
!whitelist lookup 12345678
!whitelist list
!whitelist help
```

### Workflow
1. Mod runs command in Discord
2. Watcher detects change within 30s
3. Rojo syncs `UserIDs.lua` to Studio
4. Changes appear automatically

---

## Files Summary

| File | Location | Purpose |
|------|----------|---------|
| `whitelist-handler.js` | Your bot (Render) | Discord commands |
| `whitelist-watcher.js` | Your PC | Polls Gist, writes .lua |
| `UserIDs.lua` | Rojo project | Auto-generated whitelist |
| `GunGiver.server.lua` | Rojo project | Requires UserIDs module |

---

## Available Guns

- `M1911`
- `.38 SNUBNOSE`
- `M1928 TOMMY GUN`
- `M1897 Shotgun`

Edit `VALID_GUNS` in `whitelist-handler.js` to add more.
