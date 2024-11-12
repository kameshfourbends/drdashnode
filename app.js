const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const cors = require("cors");
const fs = require("fs");

const app = express();
//const PORT = process.env.PORT || 3002;
const PORT = 443;

//SSL Certificates
const options = {
  key: fs.readFileSync("/var/www/html/cert/privkey.pem"),
  cert: fs.readFileSync("/var/www/html/cert/cert.pem"),
};

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

// Create HTTP server and WebSocket server
const server = https.createServer(options, app);
const wss = new WebSocket.Server({ server });

// // Broadcast to all connected WebSocket clients
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Webhook endpoint for Azure Event Grid
app.post("/eventgrid", (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  // Check for Subscription Validation Event
  const validationEvent = events.find(
    (event) =>
      event.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent"
  );

  if (validationEvent) {
    // Send response for subscription validation
    const validationResponse = {
      validationResponse: validationEvent.data.validationCode,
    };
    return res.status(200).json(validationResponse);
  }

  // Process other events in the request
  events.forEach((event) => {
    console.log("Received Event:", event.eventType, event.data);
    broadcast({ eventType: event.eventType, data: event.data }); // Emit to WebSocket clients
  });

  res.status(200).send("Events processed");
});

// Endpoint to receive Event Grid events
app.post("/webhook", (req, res) => {
  if (
    req.body &&
    req.body[0] &&
    req.body[0].data &&
    req.body[0].data.validationCode
  ) {
    const validationCode = req.body[0].data.validationCode;
    console.log(
      "Validation request received, responding with validation code:",
      validationCode
    );

    res.status(200).send({ validationResponse: validationCode });
  } else {
    console.log("Received Event Grid event:", req.body);

    // Broadcast the event data to WebSocket clients
    broadcast(req.body);

    res.sendStatus(200); // Acknowledge the receipt of the event
  }
});

// Endpoint to handle validation requests from Event Grid
app.get("/webhook", (req, res) => {
  const validationCode = req.query.validationCode;

  if (validationCode) {
    console.log("Validation successful, code received:", validationCode);
    res.status(200).send(validationCode);
  } else {
    console.log("Validation failed: No validation code found.");
    res.status(400).send("Validation failed");
  }
});

app.get("/test", (req, res) => {
  res.status(200).send("Welcome to the Test Page...");
});

app.get("/", (req, res) => {
  res.status(200).send("Welcome Home Page ...");
});

wss.on("connection", (ws) => {
  console.log("Client connected");
  ws.on("message", (message) => {
    console.log("Received:", message);
    ws.send(`Server received: ${message}`);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
