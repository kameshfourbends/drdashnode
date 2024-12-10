const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const cors = require("cors");
const fs = require("fs");
const { db, loadInitialData, saveDataToFile } = require("./database");
const EventDataTransformer = require("./EventDataTransformer");
const initiateDRRoute = require("./routes/initiatedr");
const webhookRoute = require("./routes/webhook");

const app = express();

// Environment variables
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3002;

let server;

// Configure CORS
const corsOptions = {
  origin: "*", // Replace '*' with your client origin URL if you want to restrict access
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
};

// Use CORS middleware for Express
app.use(cors(corsOptions));

// Parse application/json
app.use(bodyParser.json());

if (NODE_ENV === "production") {
  //SSL Certificates
  const options = {
    key: fs.readFileSync("/var/www/html/cert/privkey.pem"),
    cert: fs.readFileSync("/var/www/html/cert/cert.pem"),
  };
  // Create HTTPS server
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ server });

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error("Error sending message to client:", error);
      }
    }
  });
}

// Custom destroy method to clean up resources
function destroySocket(socket) {
  try {
    socket.terminate(); // Safely terminate the WebSocket
  } catch (error) {
    console.error("Error terminating socket:", error);
  }
  console.log("Socket destroyed");
}

app.use("/initiatedr", initiateDRRoute(broadcast));
app.use("/webhook", webhookRoute(broadcast));

app.get("/test", (req, res) => {
  res.status(200).send("Welcome to the Test Page...");
});

app.get("/", (req, res) => {
  res.status(200).send("Welcome Home Page ...");
});

// API to fetch all events
app.get("/events", (req, res) => {
  const selectQuery = `SELECT * FROM eventActions`;
  db.all(selectQuery, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// API to add a new event
app.post("/events", express.json(), (req, res) => {
  const { actionName, eventType, status } = req.body;
  const insertQuery = `
        INSERT INTO eventActions (actionName, eventType, status)
        VALUES (?, ?, ?)
    `;
  db.run(insertQuery, [actionName, eventType, status], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    saveDataToFile();
    res.json({ id: this.lastID });
  });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  res.status(err.status || 500);
  res.send({
    message: err.message,
    type: "error",
    status: err.status || 500,
    stack: req.app.get("env") === "development" ? err.stack : undefined,
  });
});

//initializeWebSocketServer(server);

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Set up a ping-pong mechanism for keep-alive
  const keepAliveInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping(); // Send a ping message to the client
    }
  }, 45000); // Ping every 45 seconds, adjust as necessary

  // Listen for "pong" responses from the client
  ws.on("pong", () => {
    // console.log("Pong received from client");
  });

  ws.on("message", (message) => {
    if (message == "ping" || message == "pong") {
      ws.send(`${message}`);
    } else {
      ws.send(`Server received: ${message}`);
      console.log(`Received: ${message}`);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    clearInterval(keepAliveInterval); // Clear interval on disconnect
  });

  ws.on("error", (err) => {
    console.error("Socket error:", err);
    destroySocket(ws); // Call the destroy function to clean up
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  loadInitialData();
});
