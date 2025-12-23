# RelayX JavaScript SDK

![License](https://img.shields.io/badge/Apache_2.0-green?label=License)

A fast, simple SDK for messaging, queues, and key-value storage in JavaScript.

---

## What is RelayX?

RelayX is a real-time messaging platform that makes it easy to build distributed systems. It provides pub/sub messaging, durable queues, and a key-value store with a simple API.

---

## Installation

Install the SDK using npm:

```bash
npm install relayx-webjs
```

---

## Quick Start

Here's a complete example that publishes and subscribes to a message:

```javascript
import { Realtime } from 'relayx-webjs';

const client = new Realtime({
  api_key: 'your-api-key',
  secret: 'your-secret'
});

await client.init();
await client.connect();

await client.on('chat', (message) => {
  console.log('Received:', message);
});

await client.publish('chat', { text: 'Hello, RelayX!' });
```

---

## Messaging (Pub/Sub)

### Publishing a Message

```javascript
await client.publish('notifications', {
  type: 'alert',
  message: 'System update complete'
});
```

### Subscribing to Messages

```javascript
await client.on('notifications', (message) => {
  console.log('Notification:', message);
});
```

---

## Queues

### Publishing a Job

```javascript
const queue = await client.initQueue('queue-id');

await queue.publish('image-processing', {
  imageUrl: 'https://example.com/photo.jpg',
  operation: 'resize'
});
```

### Processing Jobs

```javascript
await queue.consume(
  {
    name: 'image-worker',
    topic: 'image-processing',
    group: 'workers'
  },
  async (job) => {
    console.log('Processing:', job.message);

    await job.ack();
  }
);
```

---

## Key-Value Store

### Storing Data

```javascript
const kvStore = await client.initKVStore();

await kvStore.put('user:123', {
  name: 'Alice',
  status: 'active'
});
```

### Retrieving Data

```javascript
const user = await kvStore.get('user:123');
console.log(user);
```

---

## Documentation

For complete documentation including delivery guarantees, error handling, limits, and advanced features, visit:

**https://docs.relay-x.io**

All system behavior and configuration options are documented there.

---

## License

This SDK is licensed under the Apache 2.0 License.