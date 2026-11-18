import "dotenv/config";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";

const databasePath = process.env.SQLITE_PATH ?? "data/attendance.sqlite";
const db = openDatabase(databasePath);
const port = Number(process.env.API_PORT ?? 4000);

createApp(db).listen(port, () => {
  console.log(`Attendance API listening on http://localhost:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});
