import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';

const db = openDb(process.env.DB_FILE || 'slotbook.db');
if (process.env.SEED_DEMO) seedDemo(db);
const app = createApp(db, { adminKey: process.env.ADMIN_KEY });
const port = Number(process.env.PORT || 3300);
app.listen(port, () => console.log(`SlotBook on http://localhost:${port}`));
