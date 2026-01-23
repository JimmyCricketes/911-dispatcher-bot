# Gun Whitelist - Hybrid System

**Edit in Studio + Update via Discord at runtime**

No PC required after initial setup. Works 24/7.

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR GAME                            │
│  ┌──────────────────┐    ┌──────────────────────────┐  │
│  │  Hardcoded List  │ +  │  Runtime DataStore       │  │
│  │  (Edit in Studio)│    │  (Updated via Discord)   │  │
│  └──────────────────┘    └──────────────────────────┘  │
│            ↓                        ↓                   │
│        MERGED → Player gets guns from both              │
└─────────────────────────────────────────────────────────┘
                              ↑
                    Discord bot updates
                    DataStore via Open Cloud
```

---

## Setup Instructions

### Step 1: Create Roblox Open Cloud API Key

1. Go to https://create.roblox.com/credentials
2. Click **Create API Key**
3. Name: `WhitelistBot`
4. Access Permissions:
   - Click **Add API System** → **data-stores**
   - Select your game/experience
   - Check these operations:
     - ✅ **Read Entry**
     - ✅ **Create Entry** 
     - ✅ **Update Entry**
     - ✅ **Delete Entry**
     - ✅ **List Entry Keys** (optional, for future features)
5. Security: Add `0.0.0.0/0` for IP (allows all - or use Render's IP range)
6. Click **Save and Generate Key** and **copy the API key immediately** (shown only once)

### Step 2: Get Your Universe ID

1. Go to https://create.roblox.com/dashboard/creations
2. Click your game → **Configure** (⚙️)
3. Copy the **Universe ID** from the URL or settings

### Step 3: Get Discord Channel ID

1. Discord → User Settings → Advanced → Enable **Developer Mode**
2. Right-click your whitelist channel → **Copy Channel ID**

### Step 4: Add Environment Variables on Render

Add to your Discord bot service:

| Variable | Value |
|----------|-------|
| `ROBLOX_UNIVERSE_ID` | Your Universe ID |
| `ROBLOX_DATASTORE_KEY` | Your Open Cloud API key |
| `WHITELIST_CHANNEL_ID` | Your Discord channel ID |

### Step 5: Add to Your Bot Code

Copy `whitelist-opencloud.js` to your bot folder.

Add to your main bot file:

```javascript
// At top
const { handleWhitelistCommand, initWhitelist } = require('./whitelist-opencloud');

// In ready event
client.once('ready', async () => {
    console.log(`Ready as ${client.user.tag}`);
    await initWhitelist();
});

// At START of messageCreate
client.on('messageCreate', async msg => {
    if (await handleWhitelistCommand(msg)) return;
    // ... your existing code
});
```

### Step 6: Update Your Roblox Script

Replace your current GunGiver script with `GunGiver-Hybrid.server.lua`.

The hardcoded `UserIDs` table stays in the script - edit it in Studio as usual.

---

## Usage

### Discord Commands (in whitelist channel)

| Command | What it does |
|---------|--------------|
| `!whitelist add 12345678 M1911 .38 SNUBNOSE` | Add user (live!) |
| `!whitelist remove 12345678` | Remove user |
| `!whitelist remove 12345678 M1911` | Remove specific gun |
| `!whitelist lookup 12345678` | Check user's runtime guns |
| `!whitelist list` | Show all runtime entries |
| `!whitelist help` | Show commands |

### In Studio

Edit the `UserIDs` table directly in the script for permanent entries.

---

## How Guns Merge

| Source | Priority |
|--------|----------|
| Hardcoded (Studio) | Always applied |
| Runtime (Discord) | Added on top |

If user `12345` has `M1911` in hardcoded list, and you run:
```
!whitelist add 12345 .38 SNUBNOSE
```

They get **both** guns (merged, no duplicates).

---

## Files Summary

| File | Where | Purpose |
|------|-------|---------|
| `whitelist-opencloud.js` | Your bot (Render) | Discord commands → DataStore |
| `GunGiver-Hybrid.server.lua` | Roblox game | Reads both hardcoded + DataStore |

---

## Available Guns

- `M1911`
- `.38 SNUBNOSE`
- `M1928 TOMMY GUN`
- `M1897 Shotgun`

Edit `VALID_GUNS` in `whitelist-opencloud.js` to add more.

---

## FAQ

**Q: Do I need my PC on?**
A: No. Bot runs on Render, DataStore is in Roblox cloud.

**Q: How fast do runtime updates apply?**
A: Within 60 seconds (script refreshes DataStore every minute).

**Q: Can I still edit the script in Studio?**
A: Yes! The hardcoded `UserIDs` table works exactly as before.

**Q: What if someone is in both lists?**
A: Guns merge. They get everything from both lists.
