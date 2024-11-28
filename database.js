
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// File path for eventslist.json
const JSON_FILE_PATH = path.join(__dirname, 'eventslist.json');

// Initialize in-memory SQLite database
const db = new sqlite3.Database(':memory:');

// Table creation query
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS eventActions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actionName TEXT NOT NULL,
        eventType TEXT NOT NULL,
        status TEXT NOT NULL
    )
`;

// Insert initial records into the database
function loadInitialData() {
    const events = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf-8'));
    const insertQuery = `
        INSERT INTO eventActions (actionName, eventType, status)
        VALUES (?, ?, ?)
    `;

    db.serialize(() => {
        db.run(createTableQuery);
        db.run('DELETE FROM eventActions'); // Clear existing data
        events.forEach(event => {
            db.run(insertQuery, [event.actionName, event.eventType, event.status]);
        });
    });
}

// Periodically save database content to eventslist.json
function saveDataToFile() {
    const selectQuery = `SELECT actionName, eventType, status FROM eventActions`;
    db.all(selectQuery, [], (err, rows) => {
        if (err) {
            console.error('Error fetching data:', err);
            return;
        }
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(rows, null, 2), 'utf-8');
    });
}

module.exports = {
	db: db,
	loadInitialData: loadInitialData,
	saveDataToFile: saveDataToFile
}