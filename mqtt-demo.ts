import { Mqtt, MqttClient } from 'jsr:@ymjacky/mqtt5@0.0.19';

const client = new MqttClient({
  url: new URL('mqtt://localhost:1883'),
  // clientId: 'clientA',
  // username: 'userA',
  // password: 'passwordA',
  // logger: logger,
  clean: true,
  protocolVersion: Mqtt.ProtocolVersion.MQTT_V3_1_1,
  keepAlive: 30,
});

await client.connect();

console.log("Connected?");

await client.publish('test', "Hi, I'm using Deno / ymjacky/mqtt5 to publish this");

console.log("Published a message");

await client.disconnect();

console.log("Closed.  Now process should exit.");
