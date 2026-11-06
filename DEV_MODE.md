# Development Mode with Auto-Reload

## Auto-Reload Setup

The project now supports automatic reloading during development using nodemon and browser-sync.

### Available Scripts

1. **`npm start`** - Production mode (no auto-reload)
   ```bash
   npm start
   ```

2. **`npm run dev`** - Development mode with server auto-reload
   ```bash
   npm run dev
   ```
   - Nodemon watches server files and automatically restarts the server on changes
   - Watches: `serverg.js`, `timetable/**/*.js`, `authMiddleware.js`, `db.js`
   - Config: See `nodemon.json`

3. **`npm run dev:ui`** - Development mode with browser-sync (UI auto-reload)
   ```bash
   npm run dev:ui
   ```
   - Run this in a separate terminal after starting the server
   - Browser-sync watches HTML, CSS, and JS files in `public/` and `timetable/tt2/public/`
   - Automatically refreshes the browser when frontend files change
   - Access the app at `http://localhost:3001` (proxied to `http://localhost:3000`)

### Full Development Workflow

For the best development experience with both server and UI auto-reload:

**Terminal 1 - Server:**
```bash
npm run dev
```

**Terminal 2 - Browser Sync:**
```bash
npm run dev:ui
```

Then open `http://localhost:3001` in your browser.

### What Gets Watched

**Server (nodemon):**
- `serverg.js`
- `timetable/**/*.js`
- `authMiddleware.js`
- `db.js`

**Frontend (browser-sync):**
- `public/**/*`
- `timetable/tt2/public/**/*`
- `admin.html`
- `coordinator.html`
- `student.html`
- `super-admin.html`
- `teacher.html`

### Notes

- Changes to server files trigger an automatic server restart
- Changes to frontend files trigger an automatic browser refresh
- No need to manually refresh the browser after editing frontend code
- No need to manually restart the server after editing backend code
