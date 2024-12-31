require("dotenv").config(); // Load .env variables
const { EnvironmentCredential } = require("@azure/identity");
const { SqlManagementClient } = require("@azure/arm-sql");
const { LogicManagementClient } = require("@azure/arm-logic");
const { db } = require("./database");
const axios = require("axios");
class EventDataTransformer {
  constructor(originalData) {
    this.originalData = originalData;
    this.eventsList = {};
  }

  async loadEventActionsFromDB() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT LOWER(actionName) AS actionName, LOWER(eventType) AS eventType, status FROM eventActions`,
        [],
        (err, rows) => {
          if (err) {
            console.error("Error loading event actions from DB:", err.message);
            return reject(err);
          }

          rows.forEach((row) => {
            if (!this.eventsList[row.actionName]) {
              this.eventsList[row.actionName] = {};
            }
            this.eventsList[row.actionName][row.eventType] = row.status;
          });

          resolve();
        }
      );
    });
  }

  async transform() {
    await this.loadEventActionsFromDB(); // Load eventActions from DB

    const isArrFlag = Array.isArray(this.originalData);
    if (isArrFlag === true) {
      const eventType = this.originalData[0]?.eventType?.toLowerCase() ?? "";
      const actionName =
        this.originalData[0]?.data?.operationName?.toLowerCase() ?? "";

      if (this.eventsList[actionName] && this.eventsList[actionName][eventType])
        return this.transformEventData();
      else return this.originalData;
    } else {
      return {};
    }
  }

  async getFailoverGroup(
    subscriptionId,
    resourceGroupName,
    serverName,
    failoverGroupName
  ) {
    const credential = new EnvironmentCredential();
    const client = new SqlManagementClient(credential, subscriptionId);
    const failoverGroup = await client.failoverGroups.get(
      resourceGroupName,
      serverName,
      failoverGroupName
    );
    return failoverGroup;
  }

  async getFailoverData(eventData) {
    let operationName = eventData?.data?.operationName;
    let subject = eventData?.subject;
    let template =
      "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Sql/servers/{sqlServerName}/failoverGroups/{failoverGroupName}";
    let regex = new RegExp(
      "^" +
        template
          .replace(/\//g, "\\/") // Escape slashes
          .replace(/{subscriptionId}/, "(?<subscriptionId>[^/]+)")
          .replace(/{resourceGroupName}/, "(?<resourceGroupName>[^/]+)")
          .replace(/{sqlServerName}/, "(?<sqlServerName>[^/]+)")
          .replace(/{failoverGroupName}/, "(?<failoverGroupName>[^/]+)") +
        "$",
      "i" // Case-insensitive flag
    );
    let match = subject.match(regex);
    console.log(match);
    if (match && match.groups) {
      let {
        subscriptionId,
        resourceGroupName,
        sqlServerName,
        failoverGroupName,
      } = match.groups;
      const failOverGroupData = await this.getFailoverGroup(
        subscriptionId,
        resourceGroupName,
        sqlServerName,
        failoverGroupName
      );
      return failOverGroupData;
    } else {
      return null;
    }
  }

  async fetchLogicAppDetails(subscriptionId, resourceGroupName, logicAppName) {
    // Authenticate using EnvironmentCredential
    try {
      const credential = new EnvironmentCredential();
      const client = new LogicManagementClient(credential, subscriptionId);

      // Fetch the Logic App details
      const logicAppDetails = await client.workflows.get(
        resourceGroupName,
        logicAppName
      );

      return logicAppDetails;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async createOrUpdateLogicApp(
    subscriptionId,
    resourceGroupName,
    logicAppName,
    location,
    definition,
    parameters
  ) {
    const credential = new EnvironmentCredential();
    const client = new LogicManagementClient(credential, subscriptionId);

    // Logic App properties
    const logicAppProperties = {
      location: location,
      definition: definition,
      parameters: parameters,
      state: "Enabled",
    };

    // Create or update Logic App
    const result = await client.workflows.createOrUpdate(
      resourceGroupName,
      logicAppName,
      logicAppProperties
    );
    console.log(`Created Logic App ${JSON.stringify(result, null, 2)}`);
    return result;
  }

  async logicAppFailover(subject) {
    let template =
      "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Logic/workflows/{logicAppName}";
    let regex = new RegExp(
      "^" +
        template
          .replace(/\//g, "\\/") // Escape slashes
          .replace(/{subscriptionId}/, "(?<subscriptionId>[^/]+)")
          .replace(/{resourceGroupName}/, "(?<resourceGroupName>[^/]+)")
          .replace(/{logicAppName}/, "(?<logicAppName>[^/]+)") +
        "$",
      "i" // Case-insensitive flag
    );
    let match = subject.match(regex);

    if (match && match.groups) {
      const { subscriptionId, resourceGroupName, logicAppName } = match.groups;
      const dLocation = "Central US";
      const dresourceGroupName = "DRD-Failover-rg";

      try {
        if (resourceGroupName.toLowerCase() == "az-fb-rg-drd") {
          const logicAppDetails = await this.fetchLogicAppDetails(
            subscriptionId,
            resourceGroupName,
            logicAppName
          );
          await this.createOrUpdateLogicApp(
            subscriptionId,
            dresourceGroupName,
            logicAppName,
            dLocation,
            logicAppDetails.definition,
            logicAppDetails.parameters
          );
        }
      } catch (error) {
        console.error("Error fetching Logic App details:", error.message);
      }
    }
  }

  async sendPostRequest(url, body) {
    try {
      const response = await axios.post(url, body, {
        headers: {
          "Content-Type": "application/json", // Ensure JSON payload
        },
      });
      console.log("Response:", response.data);
    } catch (error) {
      console.error(
        "Java API Error:",
        error.response ? error.response.data : error.message
      );
    }
  }

  async transformEventData() {
    let customData = {};
    const results = await Promise.all(
      this.originalData.map(async (event) => {
        // Determine action based on the operationName
        const operationName = event.data.operationName.toLowerCase();
        const eventType = event.eventType.toLowerCase();
        const action = this.eventsList[operationName][eventType];

        if (action === undefined) {
          return {};
        } else {
          // Extract VM name from the resource URI
          const rsName = event.subject.split("/").pop();

          if (
            operationName ===
            "microsoft.sql/servers/failovergroups/failover/action"
          ) {
            let failOverData = await this.getFailoverData(event);
            if (failOverData) {
              let failOverId = failOverData?.id;
              let topic1 = failOverId.match(
                /^(\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Sql\/servers\/[^/]+)/
              )[0];
              topic1 = topic1 + "/databases/master";
              let topic1Role = failOverData?.replicationRole;
              let topic2Role =
                failOverData?.partnerServers?.[0].replicationRole;
              let topic2 = failOverData?.partnerServers?.[0].id;
              topic2 = topic2 + "/databases/master";
              customData = {
                topic1: topic1,
                topic1Status: topic1Role,
                topic2: topic2,
                topic2Status: topic2Role,
              };
            }
          }

          if (
            operationName === "microsoft.logic/workflows/disable/action" &&
            eventType == "microsoft.resources.resourceactionsuccess"
          ) {
            // await this.logicAppFailover(event.subject);
            const logicAppApiURL =
              "https://devapi.drtestdash.com/disaster-recovery/api/cloud/AZURE/failover/logic-app";
            const logicAppBody = {
              subject: event.subject,
            };
            await this.sendPostRequest(logicAppApiURL, logicAppBody);
          }

          // Construct output object
          return {
            id: event.id,
            subject: event.subject,
            eventType: operationName,
            data: {
              appEventTypeDetail: {
                action: action,
                customData: customData,
              },
              name: rsName,
              clientRequestId: "",
              correlationId: event.data.correlationId || "",
              requestId: "",
              address: "",
              verb: "",
            },
            topic: event.data.resourceUri,
            dataVersion: event.dataVersion,
            metadataVersion: event.metadataVersion,
            eventTime: event.eventTime,
          };
        }
      })
    );
    return results;
  }
}

// Export the class
module.exports = EventDataTransformer;
