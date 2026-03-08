# 🦀 ClawScrap

**Browser automation extension** — A Chrome extension that connects to [ClawBridge](https://github.com/benteckxyz/clawbridge) server to automate browser tasks like AI image generation and social media posting.

---

## ✨ Supported Job Types

| Plugin | Job Type | Description |
|--------|----------|-------------|
| 🎨 **Flow Image Gen** | `flow_generate` | Generate AI images via [Google Flow](https://labs.google/fx) |
| 🐦 **Post to X** | `post_x` | Compose and post tweets with text + images |
| 📘 **Post to Facebook** | `post_facebook` | Post to personal profile or Facebook pages with media |

## 📋 Requirements

- **Google Chrome** browser
- **[ClawBridge](https://github.com/benteckxyz/clawbridge)** server running
- Accounts logged in on target websites (X, Facebook, Google Flow)

## 🚀 Setup

### 1. Start ClawBridge server

```bash
cd clawbridge
npm install
node server.js
# or with auth:
API_KEY=your-key node server.js
```

### 2. Load extension in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this `clawscrap/` folder
4. 🦀 icon appears in toolbar

### 3. Connect to ClawBridge

1. Click 🦀 icon
2. Set **ClawBridge Server URL** (default: `http://localhost:3002`)
3. Set **API Key** if bridge requires auth
4. Click **▶ Connect**

Extension registers with ClawBridge and starts polling for jobs.

### 4. Open target websites

Keep tabs open for sites you want to automate:
- **Google Flow**: https://labs.google/fx/vi/tools/flow
- **X/Twitter**: https://x.com
- **Facebook**: https://www.facebook.com

> **Note:** Flow plugin triggers Chrome's debugger bar ("ClawScrap started debugging this browser") — this is normal and used for trusted keyboard input.

---

## 📁 Project Structure

```
clawscrap/
├── manifest.json          # Chrome MV3 manifest
├── background.js          # Bridge connect + plugin router + polling
├── content-flow.js        # Google Flow image gen plugin
├── content-x.js           # X/Twitter posting plugin
├── content-facebook.js    # Facebook posting plugin
├── popup.html / popup.js  # Extension popup UI
└── icons/                 # Extension icons
```

## 🔄 How It Works

```
ClawBridge Server          ClawScrap Extension
━━━━━━━━━━━━━━━━          ━━━━━━━━━━━━━━━━━━
                    connect
                 ◄──────────  "I handle: flow_generate, post_x, post_facebook"
                    ✅ OK
                 ──────────►  extensionId assigned

Client submits job
  POST /api/jobs
  {type: "post_x"}
                    poll
                 ◄──────────  GET /api/jobs/pending?extensionId=xxx
                    job
                 ──────────►  {type: "post_x", payload: {text: "Hello"}}

                               Extension opens X tab
                               Types text, uploads media
                               Clicks post button

                    result
                 ◄──────────  PATCH /api/jobs/:id {status: "completed"}
```

## ⚠️ Disclaimer

For educational and personal use only. Users are responsible for compliance with third-party platform Terms of Service. All actions happen locally in your browser using your own logged-in accounts.

## 📄 License

MIT
