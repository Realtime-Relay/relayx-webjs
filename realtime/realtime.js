import { connect, JSONCodec, Events, DebugEvents, AckPolicy, ReplayPolicy, credsAuthenticator } from "nats.ws";
import { DeliverPolicy, jetstream } from "@nats-io/jetstream";
import { encode, decode } from "@msgpack/msgpack";
import { v4 as uuidv4 } from 'uuid';

export class Realtime {

    #baseUrl = "";

    #natsClient = null; 
    #codec = JSONCodec();
    #jetstream = null;
    #consumerMap = {};
    #consumer = null;

    #event_func = {}; 
    #topicMap = []; 

    // Status Codes
    #RECONNECTING = "RECONNECTING";
    #RECONNECTED = "RECONNECTED";
    #RECONN_FAIL = "RECONN_FAIL";

    #reservedSystemTopics = [CONNECTED, DISCONNECTED, RECONNECT, this.#RECONNECTED, this.#RECONNECTING, this.#RECONN_FAIL, MESSAGE_RESEND, SERVER_DISCONNECT];

    setRemoteUserAttempts = 0;
    setRemoteUserRetries = 5; 

    // Retry attempts end
    reconnected = false;
    disconnected = true;
    reconnecting = false;
    connected = false;

    // Offline messages
    #offlineMessageBuffer = [];

    // Latency
    #latency = [];
    #latencyPush = null;
    #isSendingLatency = false;

    #maxPublishRetries = 5; 

    #connectCalled = false;

    constructor(config){
        if(typeof config != "object"){
            throw new Error("Realtime($config). $config not object => {}")
        }

        if(config != null && config != undefined){
            this.api_key = config.api_key != undefined ? config.api_key : null;
            this.secret = config.secret != undefined ? config.secret : null;

            if(this.api_key == null){
                throw new Error("api_key value null")
            }

            if(this.secret == null){
                throw new Error("secret value null")
            }
        }else{
            throw new Error("{api_key: <value>, secret: <value>} not passed in constructor")
        }

        this.namespace = null;
        this.topicHash = null;
    }

    /*
    Initializes library with configuration options.
    */
    async init(staging, opts){
        /**
         * Method can take in 2 variables
         * @param{boolean} staging - Sets URL to staging or production URL
         * @param{Object} opts - Library configuration options
         */
        var len = arguments.length;

        if (len > 2){
            new Error("Method takes only 2 variables, " + len + " given");
        }

        if (len == 2){
            if(typeof arguments[0] == "boolean"){
                staging = arguments[0]; 
            }else{
                staging = false;
            }

            if(arguments[1] instanceof Object){
                opts = arguments[1];
            }else{
                opts = {};
            }
        }else if(len == 1){
            if(arguments[0] instanceof Object){
                opts = arguments[0];
                staging = false;
            }else if(typeof arguments[0] == "boolean"){
                opts = {};
                staging = arguments[0];
                this.#log(staging)
            }else{
                opts = {};
                staging = false
            }
        }else{
            staging = false;
            opts = {};
        }

        this.staging = staging; 
        this.opts = opts;

        if(process.env.PROXY){
            this.#baseUrl = ["wss://api2.relay-x.io:8666"];
        }else{
            if (staging !== undefined || staging !== null){
                this.#baseUrl = staging ? [
                    "nats://0.0.0.0:4421",
                    "nats://0.0.0.0:4422",
                    "nats://0.0.0.0:4423"
                    ] : 
                    [
                        `wss://api.relay-x.io:4421`,
                        `wss://api.relay-x.io:4422`,
                        `wss://api.relay-x.io:4423`
                    ];
            }else{
                this.#baseUrl = [
                    `wss://api.relay-x.io:4421`,
                    `wss://api.relay-x.io:4422`,
                    `wss://api.relay-x.io:4423`
                ];
            }
        }

        this.#log(this.#baseUrl);
        this.#log(opts);
    }

    /**
     * Gets the namespace of the user using a micro service
     * @returns {string} namespace value. Null if failed to retreive
     */
    async #getNameSpace() {
        var res = await this.#natsClient.request("accounts.user.get_namespace", 
            this.#codec.encode({
                "api_key": this.api_key
            }),
            {
                timeout: 5000
            }
        )

        var data = res.json()

        this.#log(data)

        if(data["status"] == "NAMESPACE_RETRIEVE_SUCCESS"){
            this.namespace = data["data"]["namespace"]
            this.topicHash = data["data"]["hash"]
        }else{
            this.namespace = null;
            this.topicHash = null;
            return
        }
    }
    

    /**
     * Connects to the relay network
     */
    async connect(){
        if(this.#connectCalled){
            return;
        }

        this.SEVER_URL = this.#baseUrl;

        var credsFile = this.#getUserCreds(this.api_key, this.secret)
        credsFile = new TextEncoder().encode(credsFile);
        var credsAuth = credsAuthenticator(credsFile);

        try{
            this.#natsClient = await connect({ 
                servers: this.SEVER_URL,
                noEcho: true,
                reconnect: true,
                maxReconnectAttempts: 1200,
                reconnectTimeWait: 1000,
                authenticator: credsAuth,
                token: this.api_key
            });

            this.#jetstream = await jetstream(this.#natsClient);

            await this.#getNameSpace()

            this.connected = true;
            this.#connectCalled = true;
        }catch(err){
            this.#log("ERR")
            this.#log(err);

            this.connected = false;
        }

        if (this.connected == true){
            this.#log("Connected to server!");

            this.#natsClient.closed().then(() => {
                this.#log("the connection closed!");

                this.#offlineMessageBuffer.length = 0;
                this.connected = false;
                this.reconnecting = false;
                this.#connectCalled = false;

                if (DISCONNECTED in this.#event_func){
                    if (this.#event_func[DISCONNECTED] !== null || this.#event_func[DISCONNECTED] !== undefined){
                        this.#event_func[DISCONNECTED]()
                    }
                }
            });
            
            (async () => {
                for await (const s of this.#natsClient.status()) {
                this.#log(s.type)

                switch (s.type) {
                    case Events.Disconnect:
                        this.#log(`client disconnected - ${s.data}`);

                        this.connected = false;
                    break;
                    case Events.LDM:
                        this.#log("client has been requested to reconnect");
                    break;
                    case Events.Update:
                        this.#log(`client received a cluster update - `);
                        this.#log(s.data)
                    break;
                    case Events.Reconnect:
                        this.#log(`client reconnected -`);
                        this.#log(s.data)

                        this.reconnecting = false;
                        this.connected = true;

                        if(RECONNECT in this.#event_func){
                            this.#event_func[RECONNECT](this.#RECONNECTED);   
                        }

                        // Resend any messages sent while client was offline
                        this.#publishMessagesOnReconnect();
                    break;
                    case Events.Error:
                        this.#log("client got a permissions error");
                    break;
                    case DebugEvents.Reconnecting:
                        this.#log("client is attempting to reconnect");

                        this.reconnecting = true;
                        this.connected = false;

                        if(RECONNECT in this.#event_func && this.reconnecting){
                            this.#event_func[RECONNECT](this.#RECONNECTING);   
                        }
                    break;
                    case DebugEvents.StaleConnection:
                        this.#log("client has a stale connection");
                    break;
                    default:
                        this.#log(`got an unknown status ${s.type}`);
                }
                }
            })().then();

            // Subscribe to topics
            this.#subscribeToTopics();
            this.#log("Subscribed to topics");

            // Callback on client side
            if (CONNECTED in this.#event_func){
                if (this.#event_func[CONNECTED] !== null || this.#event_func[CONNECTED] !== undefined){
                    this.#event_func[CONNECTED]()
                }
            }
        }
    }

    /**
     * Closes connection
     */
    async close(){
        if(this.#natsClient !== null){
            this.reconnected = false;
            this.disconnected = true;
            this.#connectCalled = false;
            
            this.#offlineMessageBuffer.length = 0;

            await this.#deleteAllConsumers();

            this.#natsClient.close();
        }else{
            this.#log("Null / undefined socket, cannot close connection");
        }
    }

    /**
     * Start consumers for topics initialized by user
     */
    async #subscribeToTopics(){
        this.#topicMap.forEach(async (topic) => {
            // Subscribe to stream
            await this.#startConsumer(topic); 
        });
    }
    
    /**
     * Delete consumers for topics initialized by user
     */
    async #deleteAllConsumers(){
        for(let i = 0; i < this.#topicMap.length; i++){
            let topic = this.#topicMap[i];

            await this.#deleteConsumer(topic); 
        }
    }

    /**
     * Deletes reference to user defined event callback.
     * This will stop listening to a topic
     * @param {string} topic 
     * @returns {boolean} - To check if topic unsubscribe was successful
     */
    async off(topic){
        if(topic == null || topic == undefined){
            throw new Error("$topic is null / undefined")
        }

        if(typeof topic !== "string"){
            throw new Error(`Expected $topic type -> string. Instead receieved -> ${typeof topic}`);
        }

        this.#topicMap = this.#topicMap.filter(item => item !== topic);

        delete this.#event_func[topic];

        return await this.#deleteConsumer(topic);
    }

    /**
     * Subscribes to a topic
     * @param {string} topic - Name of the event
     * @param {function} func - Callback function to call on user thread
     * @returns {boolean} - To check if topic subscription was successful
     */
    async on(topic, func){
        if(topic == null || topic == undefined){
            throw new Error("$topic is null / undefined")
        }

        if(func == null || func == undefined){
            throw new Error("$func is null / undefined")
        }

        if ((typeof func !== "function")){
            throw new Error(`Expected $listener type -> function. Instead receieved -> ${typeof func}`);
        }
        
        if(typeof topic !== "string"){
            throw new Error(`Expected $topic type -> string. Instead receieved -> ${typeof topic}`);
        }

        if(topic in this.#event_func || this.#topicMap.includes(topic)){
            return false
        }

        this.#event_func[topic] = func;

        if (!this.#reservedSystemTopics.includes(topic)){
            if(!this.isTopicValid(topic)){
                throw new Error("Invalid topic, use isTopicValid($topic) to validate topic")
            }

            this.#topicMap.push(topic);

            if(this.connected){
                // Connected we need to create a topic in a stream
                await this.#startConsumer(topic);
            }
        }

        return true;
    }

    /**
     * A method to send a message to a topic.
     * Retry methods included. Stores messages in an array if offline.
     * @param {string} topic - Name of the event
     * @param {object} data - Data to send
     * @returns 
     */
    async publish(topic, data){
        if(topic == null || topic == undefined){
            throw new Error("$topic is null or undefined");
        }

        if(topic == ""){
            throw new Error("$topic cannot be an empty string")
        }

        if(typeof topic !== "string"){
            throw new Error(`Expected $topic type -> string. Instead receieved -> ${typeof topic}`);
        }

        if(!this.isTopicValid(topic)){
            throw new Error("Invalid topic, use isTopicValid($topic) to validate topic")
        }

        if(!this.isMessageValid(data)){
            throw new Error("$message must be JSON, string or number")
        }

        var start = Date.now()
        var messageId = crypto.randomUUID();

        var message = {
            "client_id": this.#getClientId(),
            "id": messageId,
            "room": topic,
            "message": data,
            "start": Date.now()
        }

        if(this.connected){
            this.#log("Encoding message via msg pack...")
            var encodedMessage = encode(message);

            this.#log(`Publishing to topic => ${this.#getStreamTopic(topic)}`)
    
            const ack = await this.#jetstream.publish(this.#getStreamTopic(topic), encodedMessage);
            this.#log(`Publish Ack =>`)
            this.#log(ack)
    
            var latency = Date.now() - start;
            this.#log(`Latency => ${latency} ms`);

            return ack !== null && ack !== undefined;
        }else{
            this.#offlineMessageBuffer.push({
                topic: topic, 
                message: data
            });

            return false;
        }
    }

    /**
     * Starts consumer for particular topic if stream exists
     * @param {string} topic 
     */
    async history(topic, start, end){
        if(topic == null || topic == undefined){
            throw new Error("$topic is null or undefined");
        }

        if(topic == ""){
            throw new Error("$topic cannot be an empty string")
        }

        if(typeof topic !== "string"){
            throw new Error(`Expected $topic type -> string. Instead receieved -> ${typeof topic}`);
        }

        if(!this.isTopicValid(topic)){
            throw new Error("Invalid topic, use isTopicValid($topic) to validate topic")
        }

        if(start == undefined || start == null){
            throw new Error(`$start must be provided. $start is => ${start}`)
        }

        if(!(start instanceof Date)){
            throw new Error(`$start must be a Date object`)
        }

        if(end != undefined && end != null){
            if(!(end instanceof Date)){
                throw new Error(`$end must be a Date object`)
            }

            if(start > end){
                throw new Error("$start is greater than $end, must be before $end")
            }

            end = end.toISOString();
        }

        if(!this.connected){
            return [];
        }

        var opts = { 
            name: `webjs_${topic}_${uuidv4()}_history_consumer`,
            filter_subjects: [this.#getStreamTopic(topic)],
            replay_policy: ReplayPolicy.Instant,
            opt_start_time: start,
            delivery_policy: DeliverPolicy.StartTime,
            ack_policy: AckPolicy.Explicit,
        }

        const consumer = await this.#jetstream.consumers.get(this.#getStreamName(), opts);
        this.#log(this.#topicMap)
        this.#log("Consumer is consuming");

        var history = [];

        while(true){
            var msg = await consumer.next({
                expires: 1000
            });

            if(msg == null){
                break;
            }

            if(end != null || end != undefined){
                if(msg.timestamp > end){
                    break
                }
            }

            this.#log("Decoding msgpack message...")
            var data = decode(msg.data);
            this.#log(data);
            
            history.push({
                "id": data.id,
                "topic": data.room,
                "message": data.message,
                "timestamp": msg.timestamp
            });
        }

        var del = await consumer.delete();

        this.#log("History pull done: " + del);

        return history;
    }

    /**
     * Method resends messages when the client successfully connects to the
     * server again
     * @returns - Array of success and failure messages
     */
    async #publishMessagesOnReconnect(){
        var messageSentStatus = [];

        for(let i = 0; i < this.#offlineMessageBuffer.length; i++){
            let data = this.#offlineMessageBuffer[i];
            
            const topic = data.topic;
            const message = data.message;

            const output = await this.publish(topic, message);

            messageSentStatus.push({
                topic: topic,
                message: message,
                resent: output
            });
        }

        // Clearing out offline messages
        this.#offlineMessageBuffer.length = 0;

        // Send to client
        if(MESSAGE_RESEND in this.#event_func && messageSentStatus.length > 0){
            this.#event_func[MESSAGE_RESEND](messageSentStatus);
        }
    }

    // Room functions
    /**
     * Starts consumer for particular topic if stream exists
     * @param {string} topic 
     */
    async #startConsumer(topic){
        const consumerName = `webjs_${topic}_${uuidv4()}_consumer`;

        var opts = { 
            name: consumerName,
            filter_subjects: [this.#getStreamTopic(topic)],
            replay_policy: ReplayPolicy.Instant,
            opt_start_time: new Date(),
            ack_policy: AckPolicy.Explicit,
            delivery_policy: DeliverPolicy.New
        }

        const consumer = await this.#jetstream.consumers.get(this.#getStreamName(), opts);
        this.#log(this.#topicMap)

        this.#consumerMap[topic] = consumer;

        await consumer.consume({
            callback: async (msg) => {
                try{
                    const now = Date.now();
                    msg.working()
                    this.#log("Decoding msgpack message...")
                    var data = decode(msg.data);

                    var msgTopic = this.#stripStreamHash(msg.subject);

                    this.#log(data);

                    // Push topic message to main thread
                    if (data.client_id != this.#getClientId()){
                        var topicMatch = this.#topicPatternMatcher(topic, msgTopic)

                        if(topicMatch){
                            this.#event_func[topic]({
                                "id": data.id,
                                "topic": msgTopic,
                                "data": data.message
                            });
                        }
                    }

                    msg.ack();

                    await this.#logLatency(now, data);
                }catch(err){
                    this.#log("Consumer err " + err);
                    msg.nak(5000);
                }
            }
        });
        this.#log("Consumer is consuming");
    }

    /**
     * Deletes consumer
     * @param {string} topic 
     */
    async #deleteConsumer(topic){
        this.#log(topic)
        const consumer = this.#consumerMap[topic]

        var del = false;

        if (consumer != null && consumer != undefined){
            del = await consumer.delete();
        }else{
            del = false
        }

        delete this.#consumerMap[topic];

        return del;
    }

    async #logLatency(now, data){
        if(data.client_id == this.#getClientId()){
            this.#log("Skipping latency log for own message");
            return;
        }

        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        this.#log(`Timezone: ${timeZone}`);

        const latency = now - data.start
        this.#log(`Latency => ${latency}`)

        this.#latency.push({
            latency: latency,
            timestamp: now
        });

        if(this.#latencyPush == null){
            this.#latencyPush = setTimeout(async () => {
                this.#log("setTimeout called");

                if(this.#latency.length > 0 && this.connected && !this.#isSendingLatency){
                    this.#log("Push from setTimeout")
                    await this.#pushLatencyData({
                        timezone: timeZone,
                        history: this.#latency,
                    });
                }else{
                    this.#log("No latency data to push");
                }
                    
            }, 30000);
        }

        if(this.#latency.length >= 100 && !this.#isSendingLatency){
            this.#log("Push from Length Check: " + this.#latency.length);
            await this.#pushLatencyData({
                        timezone: timeZone,
                        history: this.#latency,
                    });
        }
    }

    // Utility functions
    #getClientId(){
        return this.#natsClient?.info?.client_id
    }

    async #pushLatencyData(data){
        this.#isSendingLatency = true;

        try{
            var res = await this.#natsClient.request("accounts.user.log_latency", 
            JSONCodec().encode({
                    api_key: this.api_key,
                    payload: data
                }),
                {
                    timeout: 5000
                }
            )

            var data = res.json()

            this.#log(data)
            this.#resetLatencyTracker();
        }catch(err){
            this.#log("Error getting pushing latency data")
            this.#log(err);
        }

        this.#isSendingLatency = false;
    }

    #resetLatencyTracker(){
        this.#latency = [];

        if(this.#latencyPush != null){
            clearTimeout(this.#latencyPush);
            this.#latencyPush = null;
        }
    }

    /**
     * Checks if a topic can be used to send messages to.
     * @param {string} topic - Name of event
     * @returns {boolean} - If topic is valid or not
     */
    isTopicValid(topic){
        if(topic !== null && topic !== undefined && (typeof topic) == "string"){
            var arrayCheck = !this.#reservedSystemTopics.includes(topic);

            const TOPIC_REGEX = /^(?!.*\$)(?:[A-Za-z0-9_*~-]+(?:\.[A-Za-z0-9_*~-]+)*(?:\.>)?|>)$/u;

            var spaceStarCheck = !topic.includes(" ") && TOPIC_REGEX.test(topic);

            return arrayCheck && spaceStarCheck;
        }else{
            return false;
        }
    }

    isMessageValid(message){
        if(message == null || message == undefined){
            throw new Error("$message cannot be null / undefined")
        }

        if(typeof message == "string"){
            return true;
        }

        if(typeof message == "number"){
            return true;
        }

        if(this.#isJSON(message)){
            return true;
        }

        return false;
    }

    #isJSON(data){
        try{
            JSON.stringify(data?.toString())
            return true;
        }catch(err){
            return false
        }
    }

    #getStreamName(){
        if(this.namespace != null){
            return this.namespace + "_stream"
        }else{
            this.close();
            throw new Error("$namespace is null. Cannot initialize program with null $namespace")
        }
    }

    #getStreamTopic(topic){
        if(this.topicHash != null){
            return this.topicHash + "." + topic;
        }else{
            this.close();
            throw new Error("$topicHash is null. Cannot initialize program with null $topicHash")
        }
    }

    #stripStreamHash(topic){
        return topic.replace(`${this.topicHash}.`, "")
    }

    #getCallbackTopics(topic){
        var validTopics = [];

        var topicPatterns = Object.keys(this.#event_func);

        for(let i = 0; i < topicPatterns.length; i++){
            var pattern = topicPatterns[i];

            if([CONNECTED, RECONNECT, MESSAGE_RESEND, DISCONNECTED, SERVER_DISCONNECT].includes(pattern)){
                continue;
            }

            var match = this.#topicPatternMatcher(pattern, topic);

            if(match){
                validTopics.push(pattern)
            }
        }

        return validTopics;

    }

    #topicPatternMatcher(patternA, patternB) {
        const a = patternA.split(".");
        const b = patternB.split(".");

        let i = 0, j = 0;          // cursors in a & b
        let starAi = -1, starAj = -1; // last '>' position in A and the token count it has consumed
        let starBi = -1, starBj = -1; // same for pattern B

        while (i < a.length || j < b.length) {
            const tokA = a[i];
            const tokB = b[j];

            /*──────────── literal match or single‑token wildcard on either side ────────────*/
            const singleWildcard =
            (tokA === "*" && j < b.length) ||
            (tokB === "*" && i < a.length);

            if (
            (tokA !== undefined && tokA === tokB) ||
            singleWildcard
            ) {
            i++; j++;
            continue;
            }

            /*────────────────── multi‑token wildcard ">" — must be **final** ───────────────*/
            if (tokA === ">") {
            if (i !== a.length - 1) return false;   // '>' not in last position → invalid
            if (j >= b.length)      return false;   // must consume at least one token
            starAi = i++;                       // remember where '>' is
            starAj = ++j;                       // gobble one token from B
            continue;
            }
            if (tokB === ">") {
            if (j !== b.length - 1) return false;   // same rule for patternB
            if (i >= a.length)      return false;
            starBi = j++;
            starBj = ++i;
            continue;
            }

            /*───────────────────────────── back‑track using last '>' ───────────────────────*/
            if (starAi !== -1) {          // let patternA's '>' absorb one more token of B
            j = ++starAj;
            continue;
            }
            if (starBi !== -1) {          // let patternB's '>' absorb one more token of A
            i = ++starBj;
            continue;
            }

            /*────────────────────────────────── dead‑end ───────────────────────────────────*/
            return false;
        }

        return true; 
    } 

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    #log(msg){
        if(this.opts?.debug){
            console.log(msg);
        }
    }

    #getPublishRetry(){
        this.#log(this.opts)
        if(this.opts !== null && this.opts !== undefined){
            if(this.opts.max_retries !== null && this.opts.max_retries !== undefined){
                if (this.opts.max_retries <= 0){
                    return this.#maxPublishRetries; 
                }else{
                    return this.opts.max_retries;
                }
            }else{
                return this.#maxPublishRetries; 
            }
        }else{
            return this.#maxPublishRetries; 
        }
    }

    /**
     * 
     * @param {function} func - Function to execute under retry
     * @param {int} count - Number of times to retry
     * @param {int} delay - Delay between each retry
     * @param  {...any} args - Args to pass to func
     * @returns {any} - Output of the func method
     */
    async #retryTillSuccess(func, count, delay, ...args){
        func = func.bind(this);

        var output = null;
        var success = false; 
        var methodDataOutput = null; 

        for(let i = 1; i <= count; i++){
            this.#log(`Attempt ${i} at executing ${func.name}()`)

            await this.sleep(delay)

            output = await func(...args); 
            success = output.success; 

            methodDataOutput = output.output; 

            if (success){
                this.#log(`Successfully called ${func.name}`)
                break;
            }
        }

        if(!success){
            this.#log(`${func.name} executed ${count} times BUT not a success`);
        }

        return methodDataOutput;
    }

    #getUserCreds(jwt, secret){
        return `
-----BEGIN NATS USER JWT-----
${jwt}
------END NATS USER JWT------

************************* IMPORTANT *************************
NKEY Seed printed below can be used to sign and prove identity.
NKEYs are sensitive and should be treated as secrets.

-----BEGIN USER NKEY SEED-----
${secret}
------END USER NKEY SEED------

*************************************************************`
    }

    // Exposure for tests
    testRetryTillSuccess(){
        if(process.env.NODE_ENV == "test"){
            return this.#retryTillSuccess.bind(this);
        }else{
            return null; 
        }
    }

    testGetPublishRetry(){
        if(process.env.NODE_ENV == "test"){
            return this.#getPublishRetry.bind(this);
        }else{
            return null; 
        }
    }

    testGetStreamName(){
        if(process.env.NODE_ENV == "test"){
            return this.#getStreamName.bind(this);
        }else{
            return null; 
        }
    }

    testGetStreamTopic(){
        if(process.env.NODE_ENV == "test"){
            return this.#getStreamTopic.bind(this);
        }else{
            return null; 
        }
    }

    testGetTopicMap(){
        if(process.env.NODE_ENV == "test"){
            return this.#topicMap
        }else{
            return null; 
        }
    }

    testGetEventMap(){
        if(process.env.NODE_ENV == "test"){
            return this.#event_func
        }else{
            return null; 
        }
    }

    testGetConsumerMap(){
        if(process.env.NODE_ENV == "test"){
            return this.#consumerMap
        }else{
            return null; 
        }
    }

    testPatternMatcher(){
        if(process.env.NODE_ENV == "test"){
            return this.#topicPatternMatcher.bind(this)
        }else{
            return null;
        }
    }
}

export const CONNECTED = "CONNECTED";
export const RECONNECT = "RECONNECT";
export const MESSAGE_RESEND = "MESSAGE_RESEND";
export const DISCONNECTED = "DISCONNECTED";
export const SERVER_DISCONNECT = "SERVER_DISCONNECT";