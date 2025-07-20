import { Realtime, CONNECTED, RECONNECT, DISCONNECTED, MESSAGE_RESEND } from "../../realtime/realtime.js"
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function run(){
    var realtime = new Realtime({
        api_key: process.env.AUTH_JWT,
        secret: process.env.AUTH_SECRET
    });
    await realtime.init(false, {
        max_retries: 2,
        debug: true
    });

    realtime.on(CONNECTED, async () => {
        console.log("[IMPL] => CONNECTED!");
    });

    realtime.on(RECONNECT, (status) => {
        console.log(`[IMPL] RECONNECT => ${status}`)
    });

    realtime.on(DISCONNECTED, () => {
        console.log(`[IMPL] DISONNECT`)
    });

    await realtime.on("power-telemetry", (data) => {
        console.log("power-telemetry", data);
    });

    await realtime.on("hello.>", async (data) => {
        console.log("hello.>", data);
    });

    // await realtime.on("hello.hey.*", (data) => {
    //     console.log("hell.hey.*", data);
    // });

    // await realtime.on("hello.hey.>", (data) => {
    //     console.log("hello.hey.>", data);
    // });

    realtime.on(MESSAGE_RESEND, (data) => {
        console.log(`[MSG RESEND] => ${data}`)
    });

    rl.on('line', async (input) => {
        console.log(`You entered: ${input}`);

        if(input == "exit"){
            var output = await realtime.off("hello"); 
            console.log(output);

            realtime.close();

            process.exit();
        }else if(input == "history"){
            rl.question("topic: ", async (topic) => {
                var start = new Date();
                var past = start.setDate(start.getDate() - 4)
                var pastDate = new Date(past)

                var end = new Date();
                var past = end.setDate(end.getDate())
                var endDate = new Date(past)

                var history = await realtime.history(topic, pastDate)
                console.log(history)
            })
        }else if(input == "off"){
            rl.question("topic to off(): ", async (topic) => {
                await realtime.off(topic);
                console.log("off() executed")
            })

            
        }else if(input == "close"){
            realtime.close();
            console.log("Connection closed");
        }else if(input == "init"){
            await realtime.connect()
        }else if(input == "on"){
            rl.question("topic: ", async (topic) => {
                await realtime.on(topic, (data) => {
                    console.log(topic, data);
                });
            })
        }else{
            rl.question("topic: ", async (topic) => {
                var output = await realtime.publish(topic, input);
            })
        }
    });

    realtime.connect();

    process.on('SIGINT', async () => {
        console.log('Keyboard interrupt detected (Ctrl+C). Cleaning up...');
        // Perform any necessary cleanup here
    
        // Exit the process
        process.exit();
    });
    
}

await run();