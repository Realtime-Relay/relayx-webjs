# Relay NodeJS Library
![License](https://img.shields.io/badge/Apache_2.0-green?label=License)<br>
A powerful library for integrating real-time communication into your web app, powered by the Relay Network.

## Features
1. Real-time communication made easy—connect, publish, and subscribe with minimal effort.
2. Automatic reconnection built-in, with a 2-minute retry window for network disruptions.
3. Message persistence during reconnection ensures no data loss when the client reconnects.

## Installation
Install the relay library by running the command below in your terminal<br>
`npm install relayx-webjs`

## Usage
### Prerequisites
1. Obtain API key and Secret key
2. Initialize the library
    ```javascript
    import { Realtime, CONNECTED, RECONNECT, DISCONNECTED } from "relayx-webjs"

    var realtime = new Realtime({
        api_key: process.env.api_key,
        secret: process.env.secret,
    });
    realtime.init();

    // Initialization of topic listeners go here... (look at examples/example_chat.js for full implementation)

    realtime.connect();

    // Other application logic...
    ```

### Usage
1. <b>Publish</b><br>
Send a message to a topic:<br>
    ```javascript
    var sent = await realtime.publish("power_telemetry", {
        "voltage_V": 5,
        "current_mA": 400,
        "power_W": 2 
    });

    if(sent){
        console.log("Message was successfully sent to topic => power_telemetry");
    }else{
        console.log("Message was not sent to topic => power_telemetry");
    }
    ```
2. <b>Listen</b><br>
Subscribe to a topic to receive messages:<br>
    ```javascript
    await realtime.on("power_telemetry", (data) => {
        console.log(data);
    });
    ```
3. <b>Turn Off Listener</b><br>
Unsubscribe from a topic:<br>
    ```javascript
    var unsubscribed = await realtime.off("power_telemetry");

    if(unsubscribed){
        console.log("Successfully unsubscribed from power_telemetry");
    }else{
        console.log("Unable to unsubscribe from power_telemetry");
    }
    ```
4. <b>History</b><br>
Get previously published messages between a start date and end date. Dates are in UTC.
    ```javascript
    var start = new Date();
    var past = start.setDate(start.getDate() - 4) // Get start date from 4 days ago
    var startDate = new Date(past)

    var end = new Date();
    var past = end.setDate(end.getDate() - 2) // Get end date from 2 days ago
    var endDate = new Date(past)

    var history = await realtime.history(topic, startDate, endDate)
    ```
    The end date is optional. Supplying only the start time will fetch all messages from the start time to now.
    ```javascript
    var start = new Date();
    var past = start.setDate(start.getDate() - 4) // Get start date from 4 days ago
    var startDate = new Date(past)

    // This will get all messages from 4 days ago to now
    var history = await realtime.history(topic, startDate)
    ```
5. <b>Valid Topic Check</b><br>
Utility function to check if a particular topic is valid
    ```javascript
    var isValid = realtime.isTopicValid("topic");

    console.log(`Topic Valid => ${isValid}`);
    ```
6. <b>Sleep</b><br>
Utility async function to delay code execution
    ```javascript
    console.log("Starting code execution...");
    await realtime.sleep(2000) // arg is in ms
    console.log("This line executed after 2 seconds");
    ```
7. <b>Close Connection to Relay</b><br>
Manually disconnect from the Relay Network
    ```javascript
    // Logic here

    realtime.close();
    ```

## System Events
1. <b>CONNECTED</b><br>
This event is fired when the library connects to the Relay Network.
    ```javascript
    await realtime.on(CONNECTED, () => {
        console.log("Connected to the Relay Network!");
    });
    ```

2. <b>RECONNECT</b><br>
This event is fired when the library reconnects to the Relay Network. This is only fired when the disconnection event is not manual, i.e, disconnection due to network issues.
    ```javascript
    await realtime.on(RECONNECT, (status) => {
        console.log(`Reconnected! => ${status}`);
    });
    ```
    `status` can have values of `RECONNECTING` & `RECONNECTED`.

    `RECONNECTING` => Reconnection attempts have begun. If `status == RECONNECTING`, the `RECONNECT` event is fired every 1 second.<br>
    `RECONNECTED` => Reconnected to the Relay Network.
3. <b>DISCONNECTED</b><br>
This event is fired when the library disconnects from the Relay Network. This includes disconnection due to network issues as well.
    ```javascript
    await realtime.on(DISCONNECTED, () => {
        console.log("Disconnected from the Relay Network");
    });
    ```
4. <b>MESSAGE_RESEND</b><br>
This event is fired when the library resends the messages upon reconnection to the Relay Network.
    ```javascript
    await realtime.on(MESSAGE_RESEND, (messages) => {
        console.log("Offline messages may have been resent");
        console.log("Messages");
        console.log(messages);
    });
    ```
    `messages` is an array of the following object,<br>
    ```json
    {
        "topic": "<topic the message belongs to>",
        "message": "<message you sent>",
        "resent": "<boolean, indicating if the message was sent successully>"
    }
    ```

## API Reference
1. init()<br>
Initializes library with configuration options.
    * debug (boolean): enables library level logging
2. connect()<br>
Connects the library to the Relay Network. This is an async function.
3. close()<br>
Disconnects the library from the Relay Network.
3. on()<br>
Subscribes to a topic. This is an async function.
     * @param {string} topic - Name of the event
     * @param {function} func - Callback function to call on user thread
     * @returns {boolean} - To check if topic subscription was successful
3. off()<br>
Deletes reference to user defined event callback for a topic. This will stop listening to a topic. This is an async function.
     * @param {string} topic 
     * @returns {boolean} - To check if topic unsubscribe was successful
4. history()<br>
Get a list of messages published in the past. This is an async function.<br>
A list of messages can be obtained using a start time and end time. End time is optional. If end time is not specified, all messages from the start time to now is returned.
     * @param {string} topic 
     * @param {Date} start
     * @param {Date} end
     * @returns {JSON Array} - List of messages published in the past
5. isTopicValid()<br>
Checks if a topic can be used to send messages to.
     * @param {string} topic - Name of event
     * @returns {boolean} - If topic is valid or not
6. sleep()<br>
Pauses code execution for a user defined time. Time passed into the method is in milliseconds.  This is an async function.