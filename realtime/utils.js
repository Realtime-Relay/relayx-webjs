import { JetStreamApiError } from "@nats-io/jetstream";

export class ErrorLogging {

    logError(data){
        var err = data.err;

        if(err instanceof JetStreamApiError){
            var code = err.code;

            if(code == 10077){
                // Code 10077 is for message limit exceeded
                console.table({
                    Event: "Message Limit Exceeded",
                    Description: "Current message count for account exceeds plan defined limits. Upgrade plan to remove limits",
                    Link: "https://console.relay-x.io/billing"
                })

                throw new Error("Message limit exceeded!")
            }
        }

        if(err.name == "NatsError"){
            var code = err.code;
            var chainedError = err.chainedError;
            var permissionContext = err.permissionContext;
            var userOp = data.op;

            if(code == "PERMISSIONS_VIOLATION"){
                var op = permissionContext.operation;

                if(userOp == "publish"){
                    console.table({
                        Event: "Publish Permissions Violation",
                        Description: `User is not permitted to publish on '${data.topic}'`,
                        Topic: data.topic,
                        "Docs to Solve Issue": "<>"
                    })

                    throw new Error(`User is not permitted to publish on '${data.topic}'`)
                }else if(userOp == "subscribe"){
                    console.table({
                        Event: "Subscribe Permissions Violation",
                        Description: `User is not permitted to subscribe to '${data.topic}'`,
                        Topic: data.topic,
                        "Docs to Solve Issue": "<>"
                    })

                    throw new Error(`User is not permitted to subscribe to '${data.topic}'`)
                }
            }else if(code == "AUTHORIZATION_VIOLATION"){
                console.table({
                    Event: "Authentication Failure",
                    Description: `User failed to authenticate. Check if API key exists & if it is enabled`,
                    "Docs to Solve Issue": "<>"
                })
            }
        }
    }

}