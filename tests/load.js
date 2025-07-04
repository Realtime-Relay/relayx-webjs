import { Realtime, CONNECTED, RECONNECT, DISCONNECTED, MESSAGE_RESEND } from "../realtime/realtime.js"
import fs from 'fs';

const URL = "http://localhost:3000";
// const URL = "http://128.199.176.185:3000";
const MAX_CLIENTS = 10000;
const CLIENT_CREATION_INTERVAL_IN_MS = 200;
const EMIT_INTERVAL_IN_MS = 1000;

let clientCount = 0;
let lastReport = new Date().getTime();
let packetsSinceLastReport = 0;

var metrics = [];

const createClient = async () => {
    // console.log("Creating client...")
    // for demonstration purposes, some clients stay stuck in HTTP long-polling
    var realtime = new Realtime()
    await realtime.init({
        max_retries: 2,
        debug: false
    });

    realtime.setUser({
        "user": "test",
        "id": 123
    });

    realtime.on(CONNECTED, async () => {
        // console.log(`[IMPL] => CONNECTED! ${clientCount}`);

        setInterval(() => {
            realtime.publish("hello", {
                "message": "Hey how's it going ya'll",
                "test": "asdsadasd"
            }, (latency) => {
                console.log(`LATENCY => ${latency} || CLIENTS => ${clientCount}`)
                metrics.push({
                    "latency": latency,
                    "client_count": clientCount,
                    "timestamp": Date.now()
                })
            })
          }, EMIT_INTERVAL_IN_MS);
    });

    realtime.on(RECONNECT, (status) => {
        console.log(`[IMPL] RECONNECT => ${status}`)
    });

    realtime.on(DISCONNECTED, (reason) => {
        console.log(`[IMPL] DISONNECT => ${reason}`)
    });

    // realtime.on("hello", (data) => {
    //     console.log("hello", data);
    // });

    realtime.on(MESSAGE_RESEND, (data) => {
        console.log(`[MSG RESEND] => ${data}`)
    });

    realtime.connect();

    if (++clientCount < MAX_CLIENTS) {
        setTimeout(createClient, CLIENT_CREATION_INTERVAL_IN_MS);
    }else{
        console.log("Sleeping 10s before saving and exiting...")
        await realtime.sleep(10);

        fs.writeFile("output.json", JSON.stringify(metrics), (err) => {
            if (err){
                console.log("Failed to write to output.json")
            }else{
                console.log("metrics written to output.json")
            }

            process.exit();
        });
    }
};

createClient();

// const printReport = () => {
//   const now = new Date().getTime();
//   const durationSinceLastReport = (now - lastReport) / 1000;
//   const packetsPerSeconds = (
//     packetsSinceLastReport / durationSinceLastReport
//   ).toFixed(2);

//   console.log(
//     `client count: ${clientCount} ; average packets received per second: ${packetsPerSeconds}`
//   );

//   packetsSinceLastReport = 0;
//   lastReport = now;
// };

// setInterval(printReport, 1000);