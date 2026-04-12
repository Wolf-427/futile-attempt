# Scriptum

Writing desktop app for Mac — rich text editor, infinite canvas boards, Git/GitHub version control.

## Quick start

```bash
# Install Node.js from https://nodejs.org (LTS version) if you haven't already
npm install
npm run dev
```

## First launch
1. Click "New project"
2. Enter a name, then choose a folder on your Mac
3. Start writing in the Editor, or switch to Canvas to add notes

## GitHub sync
1. Create an empty private repo on GitHub
2. In Terminal, inside your project folder: `git remote add origin https://github.com/YOU/REPO.git`
3. Generate a token: GitHub → Settings → Developer settings → Personal access tokens → New token (classic) → tick `repo`
4. In Scriptum titlebar: click "Commit" then "Push ↑" — it will prompt for the token

## Canvas controls
- Alt+drag or middle-click = pan
- Scroll wheel = zoom
- Drag image from Finder = image pin
- Double-click sub-board = open it
- Breadcrumb "← Back" = return to master board
