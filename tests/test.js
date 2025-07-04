import { Realtime, CONNECTED, RECONNECT, DISCONNECTED, MESSAGE_RESEND } from "../realtime/realtime.js";
import axios from "axios";
import { test, before, after } from 'node:test';
import assert from 'node:assert';

let realTimeEnabled;

before(async () => {
    // Start server for testing. Run local server!!
    realTimeEnabled = new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });
    await realTimeEnabled.init(false, {
        debug: true
    });
    await realTimeEnabled.connect();
});

after(() => {
    realTimeEnabled.close();
});

test("No creds in constructor", async () => {
    assert.throws(() => {
        new Realtime({});
    }, 
    new Error("api_key value null"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    assert.throws(() => {
        new Realtime({api_key: "<KEY>"});
    }, 
    new Error("secret value null"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    assert.throws(() => {
        var realtime = new Realtime(null);
    }, 
    new Error("{api_key: <value>, secret: <value>} not passed in constructor"),
    "Expected error was not thrown")

    //---------------------------------------------------------------

    assert.throws(() => {
        new Realtime("KEY");
    }, 
    new Error("Realtime($config). $config not object => {}"),
    "Expected error was not thrown")
});

test('init() function test', async () => {
    var realtime =  new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });
    await realtime.init(true);

    assert.strictEqual(realtime.staging, true);
    assert.deepStrictEqual(realtime.opts, {});

    //---------------------------------------------------------------

    await realtime.init({
        debug: true,
        max_retries: 2
    });

    assert.strictEqual(realtime.staging, false);
    assert.deepStrictEqual(realtime.opts, {
        debug: true,
        max_retries: 2
    })
    assert.strictEqual(realtime.opts.debug, true);
    assert.strictEqual(realtime.opts.max_retries, 2);

    //---------------------------------------------------------------

    await realtime.init(true, {
        debug: false,
        max_retries: 2
    });

    assert.strictEqual(realtime.staging, true);
    assert.deepStrictEqual(realtime.opts, {
        debug: false,
        max_retries: 2
    })
    assert.strictEqual(realtime.opts.debug, false);
    assert.strictEqual(realtime.opts.max_retries, 2);

    //---------------------------------------------------------------

    await realtime.init(false);

    assert.strictEqual(realtime.staging, false);
    assert.deepStrictEqual(realtime.opts, {})

    assert.strictEqual(realtime.opts.debug, undefined);
    assert.strictEqual(realtime.opts.max_retries, undefined);

    //---------------------------------------------------------------

    await realtime.init();

    assert.strictEqual(realtime.staging, false);
    assert.deepStrictEqual(realtime.opts, {})

    assert.strictEqual(realtime.opts.debug, undefined);
    assert.strictEqual(realtime.opts.max_retries, undefined);
});

test("Namespace check test", async () => {
    assert.strictEqual(realTimeEnabled.namespace.length > 0, true)
    assert.strictEqual(realTimeEnabled.topicHash.length > 0, true)
});

test("Retry method test", async () => {
    var retryMethod = realTimeEnabled.testRetryTillSuccess(); 

    assert.notStrictEqual(retryMethod, null, "Obj != null")

    function testMethod1(arg){
        return {
            success: true, 
            output: arg
        }
    }

    var output = await retryMethod(testMethod1, 5, 1, "test_output")

    assert.strictEqual(output, "test_output");

    function testMethod2(){
        return {
            success: false,
            output: null
        }
    }

    output = await retryMethod(testMethod2, 5, 1);
    assert.strictEqual(output, null);
});

test("get publish retry count test based in init()", async () => {
    var realtime =  new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });

    await realtime.init({
        max_retries: 2
    });

    var publishRetryMethod = realtime.testGetPublishRetry();
    assert.notStrictEqual(publishRetryMethod, null);

    var attempts = publishRetryMethod();
    assert.strictEqual(attempts, 2);

    //-----------------------------------------------------------------

    await realtime.init({
        max_retries: 0
    })

    attempts = publishRetryMethod();
    assert.notStrictEqual(attempts, 0);
    assert.strictEqual(attempts, 5);

    //-----------------------------------------------------------------

    await realtime.init({
        max_retries: -4
    })

    attempts = publishRetryMethod();
    assert.notStrictEqual(attempts, -4);
    assert.strictEqual(attempts, 5);

    //-----------------------------------------------------------------

    await realtime.init({
        max_retries: 9
    })

    attempts = await publishRetryMethod();
    assert.strictEqual(attempts, 9);
});

test("Testing publish(topic, data) method", async () => {
    // Successful publish
    var response = await realTimeEnabled.publish("hello", {
        message: "Hello World!"
    });

    assert.strictEqual(response, true);
});

test("Testing publish(topic, data) with invalid inputs", async () => {
    var data = {
        message: "Hello World!"
    }; 
    
    await assert.rejects(async () => {
        await realTimeEnabled.publish(null, data);
    },
    new Error("$topic is null or undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------
    
    await assert.rejects(async () => {
        await realTimeEnabled.publish(undefined, data);
    },
    new Error("$topic is null or undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish("", data);
    },
    new Error("$topic cannot be an empty string"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish(123, data);
    },
    new Error("Expected $topic type -> string. Instead receieved -> number"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish(CONNECTED, {});
    },
    new Error("Invalid topic, use isTopicValid($topic) to validate topic"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish(RECONNECT, {});
    },
    new Error("Invalid topic, use isTopicValid($topic) to validate topic"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish(DISCONNECTED, {});
    },
    new Error("Invalid topic, use isTopicValid($topic) to validate topic"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realTimeEnabled.publish(MESSAGE_RESEND, {});
    },
    new Error("Invalid topic, use isTopicValid($topic) to validate topic"),
    "Expected error was not thrown");
});

test("on() test", async () => {
    var realtime = new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });

    await assert.rejects(async () => {
        await realtime.on(null, null);
    },
    new Error("$topic is null / undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realtime.on(undefined, null);
    },
    new Error("$topic is null / undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realtime.on("undefined", null);
    },
    new Error("$func is null / undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realtime.on("undefined", undefined);
    },
    new Error("$func is null / undefined"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realtime.on(123, () => {});
    },
    new Error("Expected $topic type -> string. Instead receieved -> number"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    await assert.rejects(async () => {
        await realtime.on("hello_world", "() => {}");
    },
    new Error("Expected $listener type -> function. Instead receieved -> string"),
    "Expected error was not thrown");

    //---------------------------------------------------------------

    var res = await realtime.on("hello_world", () => {});
    assert.strictEqual(res, true)

    var eventFunc = realtime.testGetEventMap();
    var topicMap = realtime.testGetTopicMap();

    assert.strictEqual(topicMap.includes("hello_world"), true)
    assert.strictEqual(topicMap.length > 0, true)

    assert.notStrictEqual(eventFunc["hello_world"], null)
    assert.notStrictEqual(eventFunc["hello_world"], undefined)
    assert.strictEqual(typeof eventFunc["hello_world"], "function")

    // Realtime already has a reference of this topic, so the return val will be false
    res = await realtime.on("hello_world", () => {});
    assert.strictEqual(res, false)

    res = await realtime.on("hello_world", () => {});
    assert.strictEqual(res, false)

    res = await realtime.on("hello_world", () => {});
    assert.strictEqual(res, false)
});

test("off() test", async () => {
    var realtime = new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });

    await assert.rejects(async () => {
        await realtime.off(null);
    },
    new Error("$topic is null / undefined"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realtime.off(undefined);
    },
    new Error("$topic is null / undefined"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realtime.off(123);
    },
    new Error("Expected $topic type -> string. Instead receieved -> number"),
    "Expected error was not thrown");

    // Turning off topic multiple times to check for crashes.
    // Since it is off already, output will be false
    var status = await realtime.off("hello");
    assert.strictEqual(status, false)

    var eventFunc = realtime.testGetEventMap();
    var topicMap = realtime.testGetTopicMap();
    var consumerMap = realtime.testGetConsumerMap();

    assert.strictEqual(!topicMap.includes("hello"), true)
    assert.strictEqual(eventFunc["hello"], undefined)
    assert.strictEqual(consumerMap["hello"], undefined)

    var status = await realtime.off("hello");
    assert.strictEqual(status, false)

    var status = await realtime.off("hello");
    assert.strictEqual(status, false)

    var status = await realtime.off("hello");
    assert.strictEqual(status, false)

});

test("Get stream name test", () => {
    var realtime = new Realtime({
        api_key: process.env.user_key,
        secret: process.env.secret
    });

    realtime.namespace = "spacex-dragon-program"
    realtime.topicHash = "topic_hash";

    var getStreamName = realtime.testGetStreamName();
    var getStreamTopic = realtime.testGetStreamTopic();

    var name = getStreamName();
    assert.strictEqual(name, `${realtime.namespace}_stream`);

    var topic = getStreamTopic("hello_world")
    assert.strictEqual(topic, `${realtime.topicHash}.hello_world`)

    realtime.namespace = null;
    realtime.topicHash = null;

    assert.throws(() => {
        getStreamName();
    }, 
    new Error("$namespace is null. Cannot initialize program with null $namespace"),
    "Expected error was not thrown")

    assert.throws(() => {
        getStreamTopic("hello_world");
    }, 
    new Error("$topicHash is null. Cannot initialize program with null $topicHash"),
    "Expected error was not thrown")
});

test("Test isTopicValidMethod()", () => {
    var reservedTopics = ["CONNECTED", "DISCONNECTED",
        "RECONNECT", "RECONNECTED", "RECONNECTING", "RECONN_FAIL", "MESSAGE_RESEND"
    ];

    reservedTopics.forEach(topic => {
        var valid = realTimeEnabled.isTopicValid(topic);
        assert.strictEqual(valid, false);
    });

    var unreservedInvalidTopics = [null, undefined, 1234, 
        () => {console.log("hello")},
        12.2, false, true, [], [1,2,3],
        {test: 1}, {}];
        
    unreservedInvalidTopics.forEach(topic => {
        var valid = realTimeEnabled.isTopicValid(topic);
        assert.strictEqual(valid, false);
    });

    var unreservedValidTopics = ["hello", "test-room", "heyyyyy", "room-connect"]; 

    unreservedValidTopics.forEach(topic => {
        var valid = realTimeEnabled.isTopicValid(topic);
        assert.strictEqual(valid, true);
    });
});

test("History test", async () => {
    await assert.rejects(async () => {
        await realTimeEnabled.history(null);
    },
    new Error("$topic is null or undefined"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history(undefined);
    },
    new Error("$topic is null or undefined"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("");
    },
    new Error("$topic cannot be an empty string"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history(1234);
    },
    new Error("Expected $topic type -> string. Instead receieved -> number"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("hello", null);
    },
    new Error("$start must be provided. $start is => null"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("hello", undefined);
    },
    new Error("$start must be provided. $start is => undefined"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("hello", "undefined");
    },
    new Error("$start must be a Date object"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("hello", 1234);
    },
    new Error("$start must be a Date object"),
    "Expected error was not thrown");

    await assert.rejects(async () => {
        await realTimeEnabled.history("hello", {});
    },
    new Error("$start must be a Date object"),
    "Expected error was not thrown");
})