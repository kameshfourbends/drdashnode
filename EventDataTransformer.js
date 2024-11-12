const url = require("url");

class EventDataTransformer {
  constructor(originalData) {
    this.originalData = originalData;
  }

  transform() {
    const isArrFlag = Array.isArray(this.originalData);
    if (isArrFlag === true) {
      const eventType = this.originalData[0]?.eventType;
      if (eventType) return this.originalData;
    } else {
		return this.transformVMEventData();
    }
  }

  transformVMEventData() {
    const essentials = this.originalData.data.essentials;
    const alertContext = this.originalData.data.alertContext;
    const httpRequest = JSON.parse(alertContext.httpRequest);
	const urlObject = url.parse(httpRequest.url);
	const urlPathName = urlObject?.pathname;
	const vmName = urlPathName.match(/virtualMachines\/([^/]+)/i)[1];
	const alertRule = essentials?.alertRule;
	let eventAction = '';
	if(alertRule == "vm-deallocate-event-rule"){
		eventAction = "Stopped";
	}else if(alertRule == "vm-start-event-rule"){
		eventAction = "Started";
	}
	
    return [
      {
        id: essentials.alertId.split("/").pop(), // Extracts the alert ID from the full path
        subject: `/subscriptions/${
          essentials.alertId.split("/")[2]
        }/resourceGroups/${essentials.targetResourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`,
        eventType: alertContext.operationName,
        data: {
          appEventTypeDetail: {
            action: eventAction, // Set the action explicitly
          },
          name: vmName,
          clientRequestId: httpRequest.clientRequestId,
          correlationRequestId: alertContext.correlationId,
          requestId: alertContext.eventDataId,
          address: httpRequest.url,
          verb: httpRequest.method,
        },
        topic: `/subscriptions/${
          essentials.alertId.split("/")[2]
        }/resourceGroups/${essentials.targetResourceGroup}/providers/${
          essentials.targetResourceType
        }/${vmName}`,
        dataVersion: "1",
        metaDataVersion: "1",
        eventTime: alertContext.eventTimestamp,
      },
    ];
  }
}

// Export the class
module.exports = EventDataTransformer;
