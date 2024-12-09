require("dotenv").config(); // Load .env variables
var express = require("express");
var router = express.Router();
const { EnvironmentCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { SqlManagementClient } = require("@azure/arm-sql");

async function failOverGroups(
  serverName,
  resourceGroupName,
  subscriptionId,
  credential
) {
  // Initialize SQL Management Client
  const sqlClient = new SqlManagementClient(credential, subscriptionId);

  // Fetch failover groups for the SQL Server
  const failoverGroups = [];
  for await (const failoverGroup of sqlClient.failoverGroups.listByServer(
    resourceGroupName,
    serverName
  )) {
    let partnerReplicaRole =
      failoverGroup.partnerServers[0].replicationRole.toLowerCase();
    let serverReplicaRole =
      partnerReplicaRole == "primary" ? "Secondary" : "Primary";
    let failOverId;
    if (serverReplicaRole == "Secondary") {
      failOverId = failoverGroup.id;
    } else {
      failOverId =
        failoverGroup.partnerServers[0].id +
        "/failoverGroups/" +
        failoverGroup.name;
    }
    failoverGroups.push({
      name: failoverGroup.name,
      failOverId: failOverId,
      id: failoverGroup.id,
      replicationRole: serverReplicaRole,
      partnerServers: failoverGroup.partnerServers,
    });
  }
  return failoverGroups;
}

async function initiateSQLFailover(resourceId) {
  try {
    // Extract details from resource ID
    const regex =
      /subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Sql\/servers\/([^/]+)\/failoverGroups\/([^/]+)/i;
    const match = resourceId.match(regex);

    if (!match) {
      throw new Error("Invalid resource ID format.");
    }

    const [, subscriptionId, resourceGroupName, serverName, failoverGroupName] =
      match;

    // Authenticate using EnvironmentCredential
    const credential = new EnvironmentCredential();
    const sqlClient = new SqlManagementClient(credential, subscriptionId);

    console.log(`Initiating failover for failover group: ${failoverGroupName}`);

    // Get failover group details
    const failoverGroup = await sqlClient.failoverGroups.get(
      resourceGroupName,
      serverName,
      failoverGroupName
    );

    // Ensure the server is the secondary
    if (failoverGroup.replicationRole !== "Secondary") {
      throw new Error(
        `The failover request should be initiated on the secondary server. Current role: ${failoverGroup.replicationRole}`
      );
    }

    // Trigger failover
    await sqlClient.failoverGroups.beginFailoverAndWait(
      resourceGroupName,
      serverName,
      failoverGroupName
    );

    console.log("Failover triggered successfully.");
  } catch (error) {
    console.error("Error initiating failover:", error.message);
    throw error;
  }
}

router.get(
  "/resources/:subscriptionId/:resourceGroupName",
  async (req, res) => {
    // Use EnvironmentCredential for authentication

    const { subscriptionId, resourceGroupName } = req.params;
    try {
      // Initialize the Resource Management Client
      const credential = new EnvironmentCredential();
      const client = new ResourceManagementClient(credential, subscriptionId);

      const resources = [];
      for await (const resource of client.resources.listByResourceGroup(
        resourceGroupName
      )) {
        if (resource.type === "Microsoft.Sql/servers") {
          const failOverGroup = await failOverGroups(
            resource.name,
            resourceGroupName,
            subscriptionId,
            credential
          );
          resource.failOverGroup = failOverGroup;
          resources.push(resource);
        }
      }

      // Filter resources by type
      const filteredResources = resources.filter(
        (resource) => resource.type === "Microsoft.Sql/servers"
        // resource.type === "Microsoft.Sql/servers" ||
        // resource.type === "Microsoft.Compute/virtualMachines" ||
        // resource.type === "Microsoft.Storage/storageAccounts"
      );

      // Map resources into a simplified format
      const resourceList = filteredResources.map((resource) => ({
        name: resource.name,
        type: resource.type,
        location: resource.location,
        id: resource.id,
        failOverGroups: resource.failOverGroup,
      }));

      res.status(200).json({ resourceGroupName, resources: resourceList });
    } catch (error) {
      console.error("Error fetching resources:", error.message);
      res
        .status(500)
        .json({ error: "Failed to fetch resources", details: error.message });
    }
  }
);

router.post("/failover", async (req, res, next) => {
  const { failoverList } = req.body;
  const first = failoverList[0];
  await initiateSQLFailover(first).catch((err) => {
    res.status(500).json({ error: "Failover Failed", details: err.message });
  });
  res.status(200).json({
    status: "success",
  });
});

module.exports = router;
