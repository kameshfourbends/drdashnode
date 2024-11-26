const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./data.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Create table if it doesn't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS eventActions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actionName TEXT NOT NULL,
                eventType TEXT NOT NULL,
				status TEXT NOT NULL
            )
        `);
    }
});

module.exports = db;
