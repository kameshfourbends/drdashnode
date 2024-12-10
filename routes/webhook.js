var express = require("express");
var router = express.Router();
const EventDataTransformer = require("../EventDataTransformer");

module.exports = (broadcast) => {
  // Endpoint to receive Event Grid events
  router.post("/", async (req, res) => {
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
      console.log(
        "Received Event Grid event:",
        JSON.stringify(req.body, null, 2)
      );

      const EventDataTransformerObj = new EventDataTransformer(req.body);
      const restructuredData = await EventDataTransformerObj.transform();
      console.log(
        "Restructured Data:",
        JSON.stringify(restructuredData, null, 2)
      );
      try {
        // Broadcast the event data to WebSocket clients
        broadcast(restructuredData);
        res.sendStatus(200); // Acknowledge the receipt of the event
      } catch (error) {
        console.error("Error broadcasting event:", error);
        res.status(500).send({ success: false, error: "Broadcast failed" });
      }
    }
  });

  // Endpoint to handle validation requests from Event Grid
  router.get("/", (req, res) => {
    const validationCode = req.query.validationCode;

    if (validationCode) {
      console.log("Validation successful, code received:", validationCode);
      res.status(200).send(validationCode);
    } else {
      console.log("Validation failed: No validation code found.");
      res.status(400).send("Validation failed");
    }
  });

  return router;
};
