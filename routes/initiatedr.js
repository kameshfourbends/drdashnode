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
    failoverGroups.push({
      name: failoverGroup.name,
      id: failoverGroup.id,
      replicationRole: serverReplicaRole,
      partnerServers: failoverGroup.partnerServers,
    });
  }
  return failoverGroups;
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

module.exports = router;
