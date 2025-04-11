import { Mqtt, MqttClient } from "jsr:@ymjacky/mqtt5@0.0.19";
import { TargetSpec } from "../sink/sinkspec.ts";
import Logger from "./Logger.ts";
import { MQTTLogger } from "../mqtt/MQTTLogger.ts";
import { dirPathToPrefix } from "../pathutil.ts";
import { ConsoleLogger } from "./loggers.ts";

// This maybe should take some context as parameters - console, MQTT params, etc
export function makeLogger(spec:TargetSpec) : Logger {
	switch(spec.type) {
		case "MQTT": {
			const port = spec.targetPort ?? 1883;
			const url = new URL(`mqtt://${spec.targetHostname}:${port}`);
			const client = new MqttClient({
				url,
				// clientId: 'clientA',
				// username: 'userA',
				// password: 'passwordA',
				// logger: logger,
				clean: true,
				protocolVersion: Mqtt.ProtocolVersion.MQTT_V3_1_1,
				keepAlive: 30,	
			});
			const mqttLogger = new MQTTLogger(client, dirPathToPrefix(spec.topic, ''));
			mqttLogger.connect();
			return mqttLogger;
		}
		case "Console": {
			return new ConsoleLogger(console);
		}
		default: {
			throw new Error(`Don't know how to make logger for target spec: ${JSON.stringify(spec)}`);
		}
	}
}
