import { MqttClient } from 'jsr:@ymjacky/mqtt5@0.0.19';
import Logger from '../lerg/Logger.ts';
import { ignoreResult, mkPromiseChain } from '../promises.ts';

const textEncoder = new TextEncoder();

export class MQTTLogger implements Logger {
	#client: MqttClient;
	#topicPrefix: string;
	#chatTopic: string;
	#statusTopic: string;
	#mqttThen: <R>(action: (client: MqttClient) => Promise<R>) => Promise<R>;
	constructor(client: MqttClient, topicPrefix: string) {
		this.#client = client;
		this.#topicPrefix = topicPrefix;
		this.#chatTopic = topicPrefix + 'chat';
		this.#statusTopic = topicPrefix + 'status';
		this.#mqttThen = mkPromiseChain(client);
	}
	async connect() : Promise<void> {
		await this.#mqttThen(client => client.connect({
			will: {
				topic: this.#statusTopic,
				payload: textEncoder.encode("offline"),
				retain: true,
			}
		}));
		await this.#mqttThen(client => client.publish(this.#statusTopic, 'online', { retain: true }));
	}
	info(text: string) {
		return ignoreResult(this.#mqttThen(client => client.publish(this.#chatTopic, text)));
	}
	update(topic: string, payload: string, retain = false) {
		return ignoreResult(this.#mqttThen(client => client.publish(`${this.#topicPrefix}${topic}`, payload, { retain })));
	}
}
