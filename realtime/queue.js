import { connect, JSONCodec, Events, DebugEvents, AckPolicy, ReplayPolicy, credsAuthenticator } from "nats.ws";
import { DeliverPolicy, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { encode, decode } from "@msgpack/msgpack";
import { v4 as uuidv4 } from 'uuid';
import { ErrorLogging } from "./utils.js";
import Message from "./models/message.js";

export class Queue {

    #queueID = null;
    #api_key = null;

    #baseUrl = "";
    
    #natsClient = null; 
    #codec = JSONCodec();
    #jetstream = null;
    #jetStreamManager = null;
    #consumerMap = {};

    #event_func = {}; 
    #topicMap = []; 

    #errorLogging = null;
    #debug = false;

    // Status Codes
    #RECONNECTING = "RECONNECTING";
    #RECONNECTED = "RECONNECTED";
    #RECONN_FAIL = "RECONN_FAIL";

    CONNECTED = "CONNECTED";
    RECONNECT = "RECONNECT";
    MESSAGE_RESEND = "MESSAGE_RESEND";
    DISCONNECTED = "DISCONNECTED";
    SERVER_DISCONNECT = "SERVER_DISCONNECT";

    #reservedSystemTopics = [this.CONNECTED, this.DISCONNECTED, this.RECONNECT, this.#RECONNECTED, this.#RECONNECTING, this.#RECONN_FAIL, this.MESSAGE_RESEND, this.SERVER_DISCONNECT];

    setRemoteUserAttempts = 0;
    setRemoteUserRetries = 5; 

    // Retry attempts end
    reconnected = false;
    disconnected = true;
    reconnecting = false;
    connected = true;

    // Offline messages
    #offlineMessageBuffer = [];

    #connectCalled = false;

    constructor(config){
        this.#jetstream = config.jetstream;
        this.#natsClient = config.nats_client;

        this.#api_key = config.api_key;

        this.#debug = config.debug;

        this.#errorLogging = new ErrorLogging();
    }

    async init(queueID){
        this.#queueID = queueID;
        
        this.#jetStreamManager = await this.#jetstream.jetstreamManager()

        var result = await this.#getQueueNamespace();

        this.#initConnectionListener();

        return result
    }

    /**
     * Get namespace to start subscribing and publishing in the queue
     */
    async #getQueueNamespace(){
        this.#log("Getting queue namespace data...")
        var data = null;

        try{
            var res = await this.#natsClient.request("accounts.user.get_queue_namespace", 
            JSONCodec().encode({
                    api_key: this.#api_key,
                    queue_id: this.#queueID
                }),
                {
                    timeout: 5000
                }
            )

            data = res.json()

            this.#log(data)
        }catch(err){
            console.log("-------------------------")
            console.log("Error fetching queue namespace!")
            console.log(err);
            console.log("-------------------------")

            return false;
        }

        if(data.status == "NAMESPACE_RETRIEVE_SUCCESS"){
            this.namespace = data.data.namespace
            this.topicHash = data.data.hash

            return true;
        }else{
            this.namespace = null;
            this.topicHash = null;

            var code = data.code;

            if(code == "QUEUE_NOT_FOUND"){
                console.log("-------------------------------")
                console.log(`Code: ${code}`)
                console.log(`Description: The queue does not exist OR has been disabled`)
                console.log(`Queue ID: ${this.#queueID}`)
                console.log(`Docs Link To Resolve Problem: <>`)
                console.log("-------------------------------")
            }

            return false;
        }
    }

    /**
     * Connection listener to handle queue
     */
    async #initConnectionListener(){
        (async () => {
            for await (const s of this.#natsClient.status()) {
                switch (s.type) {
                    case Events.Disconnect:
                        this.#log(`client disconnected - ${s.data}`);

                        this.connected = false;
                    break;
                    case Events.Reconnect:
                        this.#log(`client reconnected -`);
                        this.#log(s.data)

                        this.reconnecting = false;
                        this.connected = true;

                        // Resend any messages sent while client was offline
                        this.#publishMessagesOnReconnect();
                    break;
                    case DebugEvents.Reconnecting:
                        this.#log("client is attempting to reconnect");

                        this.reconnecting = true;
                        this.connected = false;
                    break;
                    case DebugEvents.StaleConnection:
                        this.#log("client has a stale connection");
                    break;
                }
            }
        })().then();
    }

    /**
     * A method to send a message to a queue topic.
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
    
            var ack = null;

            try{
                ack = await this.#jetstream.publish(this.#getStreamTopic(topic), encodedMessage);
                this.#log(`Publish Ack =>`)
                this.#log(ack)
        
                var latency = Date.now() - start;
                this.#log(`Latency => ${latency} ms`);
            }catch(err){
                this.#errorLogging.logError({
                    err: err
                })
            }

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
     * Subscribes to a topic
     * @param {string} topic - Name of the event
     * @param {function} func - Callback function to call on user thread
     * @returns {boolean} - To check if topic subscription was successful
     */
    async consume(data, func){
        var topic = data.topic;

        if(!this.isTopicValid(topic) && this.#reservedSystemTopics.includes(topic)){
            throw new Error(`Invalid Topic!`);
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
                await this.#startConsumer(data);
            }
        }
    }

    /**
     * Deletes reference to user defined event callback.
     * This will stop listening to a topic
     * @param {string} topic 
     * @returns {boolean} - To check if topic unsubscribe was successful
     */
    async detachConsumer(topic){
        if(topic == null || topic == undefined){
            throw new Error("$topic is null / undefined")
        }

        if(typeof topic !== "string"){
            throw new Error(`Expected $topic type -> string. Instead receieved -> ${typeof topic}`);
        }

        this.#topicMap = this.#topicMap.filter(item => item !== topic);

        delete this.#event_func[topic];

        delete this.#consumerMap[topic];

        this.#log(`Consumer closed => ${topic}`)
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
        if(this.MESSAGE_RESEND in this.#event_func && messageSentStatus.length > 0){
            this.#event_func[this.MESSAGE_RESEND](messageSentStatus);
        }
    }

    // Room functions
    /**
     * Starts consumer for particular topic if stream exists
     * @param {string} topic 
     */
    async #startConsumer(config){
        this.#validateConsumerConfig(config);

        var name = config.name;
        var topic = config.topic;

        var opts = {
            name: name,
            durable_name: name,
            delivery_group: config.group,
            delivery_policy: DeliverPolicy.New,
            replay_policy: ReplayPolicy.Instant,
            filter_subject: this.#getStreamTopic(topic),
            ack_policy: AckPolicy.Explicit,
        }

        if(this.#checkVarOk(config.ack_wait) && !(config.ack_wait < 0) && (typeof config.ack_wait === "number")){
            opts.ack_wait = config.ack_wait * 1_000_000_000  // Seconds to nano seconds
        }

        if(this.#checkVarOk(config.backoff) && Array.isArray(config.backoff)){
            var backoffNanos = [];

            for(let bo of config.backoff){
                backoffNanos.push(bo * 1_000_000_000) // Seconds to nano seconds
            }

            opts.backoff = backoffNanos
        }

        if(this.#checkVarOk(config.max_deliver) && !(config.max_deliver < 0) && (typeof config.max_deliver === "number")){
            opts.max_deliver = config.max_deliver
        }else{
            opts.max_deliver = -1
        }

        if(this.#checkVarOk(config.max_ack_pending) && !(config.max_ack_pending < 0) && (typeof config.max_ack_pending === "number")){
            opts.max_ack_pending = config.max_ack_pending
        }

        var consumer = null;

        try{
            consumer = await this.#jetStreamManager.consumers.info(this.#getQueueName(), name);
        }catch(err){
            consumer = null;
        }

        if(consumer == null){
            this.#log("Consumer not found, creating...")

            await this.#jetStreamManager.consumers.add(this.#getQueueName(), opts);

            this.#log(`Consumer created: ${name}`)
        }else{
            this.#log("Consumer found, updating...")

            await this.#jetStreamManager.consumers.update(this.#getQueueName(), name, opts);

            this.#log(`Consumer updated: ${name}`)
        }

        consumer = await this.#jetstream.consumers.get(this.#getQueueName(), name)

        this.#consumerMap[topic] = consumer;

        while(true){
            var msg = await consumer.next({
                expires: 1000
            });

            if(!this.#checkVarOk(this.#consumerMap[topic])){
                // consumerMap has no callback function because 
                // we called detachConsumer(). We did that because
                // we did not want to consumer messages anymore

                break;
            }

            if(msg == null){
                continue
            }

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
                        var fMsg = {
                            id: data.id,
                            topic: msgTopic,
                            message: data.message,
                            msg: msg
                        }

                        var msgObj = new Message(fMsg)

                        this.#event_func[topic](msgObj);
                    }
                }
            }catch(err){
                this.#log("Consumer err " + err);
                msg.nak(5000);
            }
        }

        this.#log(`Consumer done => ${topic}`)
    }

    async deleteConsumer(topic){
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

    // Utility functions
    #getClientId(){
        return this.#natsClient?.info?.client_id
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

    #validateConsumerConfig(config){
        if(config === null || config === undefined){
            throw new Error("$config (subscribe config) cannot be null / undefined")
        }

        if(config.name === null || config.name === undefined || config.name == ""){
            throw new Error("$config.name (subscribe config) cannot be null / undefined / Empty")
        }

        if(config.topic === null || config.topic === undefined || config.topic == ""){
            throw new Error("$config.topic (subscribe config) cannot be null / undefined")
        }
    }

    #isJSON(data){
        try{
            JSON.stringify(data?.toString())
            return true;
        }catch(err){
            return false
        }
    }

    #checkVarOk(variable){
        return variable !== null && variable !== undefined
    }

    #getQueueName(){
        if(this.namespace != null){
            return `Q_${this.namespace}`
        }else{
            this.close();
            throw new Error("$namespace is null. Cannot initialize program with null $namespace")
        }
    }

    #getStreamTopic(topic){
        if(this.topicHash != null){
            return `${this.topicHash}.${topic}`;
        }else{
            throw new Error("$topicHash is null. Cannot initialize program with null $topicHash")
        }
    }

    #stripStreamHash(topic){
        return topic.replace(`${this.topicHash}.`, "")
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
        if(this.#debug){
            console.log(msg);
        }
    }

}