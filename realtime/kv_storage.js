import { Kvm } from "@nats-io/kv";
import { ErrorLogging, Logging } from "./utils.js";

export class KVStore{

    #kvManager = null
    #kvStore = null

    #namespace = null;

    #logger = null;
    #errorLogger = null;

    constructor(data){
        this.#namespace = data.namespace;

        this.#kvManager = new Kvm(data.jetstream)

        this.#logger = new Logging(data.debug)

        this.#errorLogger = new ErrorLogging()
    }

    async init(){
        this.#validateInput()

        this.#kvStore = await this.#kvManager.open(this.#namespace)

        return this.#kvStore != null
    }

    async get(key){
        this.#validateKey(key)

        try{
            const val = await this.#kvStore.get(key);

            this.#logger.log("Value for", key)
            
            var json = null;

            json = JSON.parse(val.string())
            return json
        }catch(err){
            this.#errorLogger.logError({
                err: err, 
                op: "kv_read"
            })

            return null
        }
    }

    async put(key, value){
        this.#validateKey(key)
        this.#validateValue(value)

        this.#logger.log(`Creating KV pair for ${key}`)

        try{
            await this.#kvStore.create(key, JSON.stringify(value))
        }catch(err){
            // The assumption here is that the key might already exist
            try{
                await this.#kvStore.put(key, JSON.stringify(value))
            }catch(err2){
                // The key creation failed because we don't have permission
                this.#errorLogger.logError({
                    err: err2,
                    op: "kv_write"
                })
            }
        }
    }

    async delete(key){
        this.#validateKey(key)

        try{
            await this.#kvStore.purge(key);
        }catch(err){
            // The key delete failed because we don't have permission
            this.#errorLogger.logError({
                err: err,
                op: "kv_delete"
            })
        }

    }

    async keys(){
        var keys = [];

        try{
            var qKeys = await this.#kvStore.keys();

            for await (const key of qKeys) {
                this.#logger.log("Key: ", key);
                keys.push(key);
            }
        }catch(err){
            this.#errorLogger.logError({
                err: err, 
                op: "kv_read"
            })
        }

        return keys;

    }

    // Utility functions
    #validateInput(){
        if(this.#namespace === null || this.#namespace === undefined || this.#namespace == ""){
            throw new Error("$namespace cannot be null / undefined / empty")
        }
    }

    #validateKey(key){
        if(key == null || key == undefined){
            throw new Error("$key cannot be null / undefined")
        }

        if(typeof key != "string"){
            throw new Error("$key cannot be a string")
        }

        if(key == ""){
            throw new Error("$key cannot be empty")
        }

        // Validate key characters: only a-z, A-Z, 0-9, _, -, ., = and / are allowed
        const validKeyPattern = /^[a-zA-Z0-9_\-\.=\/]+$/;
        if(!validKeyPattern.test(key)){
            throw new Error("$key can only contain alphanumeric characters and the following: _ - . = /")
        }
    }

    #validateValue(value){
        var valueValid = (
            value === null ||
            typeof value == "string" ||
            typeof value == "number" ||
            typeof value == "boolean" ||
            Array.isArray(value) ||
            this.#isJSON(value)
        );

        if(!valueValid){
            throw new Error(`$value MUST be null, string, number, boolean, array or json! $value is "${typeof value}"`)
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

    // Test helper methods - expose private methods/state for testing
    // Only available when process.env.NODE_ENV == "test"
    testGetNamespace(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return this.#namespace;
    }

    testIsKvStoreInitialized(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return this.#kvStore != null;
    }

    testValidateKey(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return (key) => this.#validateKey(key);
    }

    testValidateValue(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return (value) => this.#validateValue(value);
    }

    testValidateInput(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return () => this.#validateInput();
    }

    testIsJSON(){
        if(process.env.NODE_ENV !== "test") return undefined;
        return (data) => this.#isJSON(data);
    }

}