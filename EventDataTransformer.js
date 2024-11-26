require('dotenv').config(); // Load .env variables
const { EnvironmentCredential } = require('@azure/identity');
const url = require("url");
const { DefaultAzureCredential } = require("@azure/identity");
const { SqlManagementClient } = require("@azure/arm-sql");
const db = require('./database');

class EventDataTransformer {
  constructor(originalData) {
    this.originalData = originalData;
	this.eventActions = {}; // Initialize as empty, to be loaded from the database
	this.eventTypes = {}; // Initialize as empty, to be loaded from the database
  }
  
  async loadEventActionsFromDB() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT actionName, eventType, status FROM eventActions`, [], (err, rows) => {
        if (err) {
          console.error('Error loading event actions from DB:', err.message);
          return reject(err);
        }

        rows.forEach(row => {
          this.eventActions[row.actionName] = row.status; // Map eventType to status
		  this.eventTypes[row.actionName] = row.eventType;
        });

        resolve();
      });
    });
  }
  
  async transform() {
	await this.loadEventActionsFromDB(); // Load eventActions from DB
	//console.log(this.eventActions)
	//console.log(this.eventTypes)
	const isArrFlag = Array.isArray(this.originalData);
    if (isArrFlag === true) {
      const eventType = this.originalData[0]?.eventType;
	  const actionName = this.originalData[0]?.data?.operationName;
	  // console.log('this event types :', this.eventTypes[actionName]);
	  // console.log('event Type :', eventType);
      if (this.eventTypes[actionName] == eventType) 
		  return this.transformEventData();
	  else
		  return this.originalData;
    } else {
		return {};
    } 
  }
  
  async getFailoverGroup(subscriptionId, resourceGroupName, serverName, failoverGroupName) {
    const credential = new EnvironmentCredential();
    const client = new SqlManagementClient(credential, subscriptionId);
    const failoverGroup = await client.failoverGroups.get(resourceGroupName, serverName, failoverGroupName);
	return failoverGroup;
  }
  
  async getFailoverData(eventData){
	  let operationName = eventData?.data?.operationName;
      let subject = eventData?.subject;
      let template = "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Sql/servers/{sqlServerName}/failoverGroups/{failoverGroupName}";
	  let regex = new RegExp(
	  "^" + template
		.replace(/\//g, "\\/") // Escape slashes
		.replace(/{subscriptionId}/, "(?<subscriptionId>[^/]+)")
		.replace(/{resourceGroupName}/, "(?<resourceGroupName>[^/]+)")
		.replace(/{sqlServerName}/, "(?<sqlServerName>[^/]+)")
		.replace(/{failoverGroupName}/, "(?<failoverGroupName>[^/]+)") +
	  "$"
	  );
	  let match = subject.match(regex);
	  if (match && match.groups) {
		  let { subscriptionId, resourceGroupName, sqlServerName, failoverGroupName } = match.groups;
		  const failOverGroupData = await this.getFailoverGroup(subscriptionId, resourceGroupName, sqlServerName, failoverGroupName);
          return failOverGroupData;
	  }else{
		  return null; 
	  }
	
  }
  
  async transformEventData(){
    let customData = {}
	const results = await Promise.all(this.originalData.map(async(event) => {
			// Determine action based on the operationName
			let operationName = event.data.operationName;
			let action = this.eventActions?.[operationName];
			
			if(action === undefined){
				return {};
			}else{
				// Extract VM name from the resource URI
				const rsName = event.subject.split('/').pop();
				
				if(operationName === "Microsoft.Sql/servers/failoverGroups/failover/action"){
					let failOverData = await this.getFailoverData(event)
					if(failOverData){
						let failOverId = failOverData?.id;
						let topic1 = failOverId.match(/^(\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Sql\/servers\/[^/]+)/)[0];
						topic1 = topic1 + "/databases/master";
						let topic1Role = failOverData?.replicationRole;
						let topic2Role = failOverData?.partnerServers?.[0].replicationRole;
						let topic2 = failOverData?.partnerServers?.[0].id;
						topic2 = topic2 + "/databases/master";
						customData = {
							"topic1" : topic1,
							"topic1Status" : topic1Role,
							"topic2" : topic2,
							"topic2Status" : topic2Role,
						}
					}
					
				}

				// Construct output object
				return {
						id: event.id,
						subject: event.subject,
						eventType: operationName,
						data: {
							appEventTypeDetail: {
								action: action,
								customData: customData
							},
							name: rsName,
							clientRequestId: "",
							correlationId: event.data.correlationId || "",
							requestId: "",
							address: "",
							verb: ""
						},
						topic: event.data.resourceUri,
						dataVersion: event.dataVersion,
						metadataVersion: event.metadataVersion,
						eventTime: event.eventTime
					};
			}
		}));
	return results;
  }

  
}

// Export the class
module.exports = EventDataTransformer;
