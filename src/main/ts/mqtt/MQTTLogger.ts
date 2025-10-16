import { MqttClient } from 'jsr:@ymjacky/mqtt5@0.0.19';
import Logger from '../lerg/Logger.ts';
import { ignoreResult, mkPromiseChain } from '../promises.ts';

const textEncoder = new TextEncoder();

type ActionQueue<C> = <R>(action: (client: C) => Promise<R>) => Promise<R>;

export class MQTTLogger implements Logger {
	#topicPrefix: string;
	#chatTopic: string;
	#statusTopic: string;
	#mqttThen: <R>(action: (client: MqttClient) => Promise<R>) => Promise<R>;
	protected constructor(mqttThen : ActionQueue<MqttClient>, topicPrefix: string) {
		this.#topicPrefix = topicPrefix;
		this.#chatTopic = topicPrefix + 'chat';
		this.#statusTopic = topicPrefix + 'status';
		this.#mqttThen = mqttThen;
	}
	async connect() : Promise<void> {
		await this.#mqttThen(client => client.connect({
			will: {
				topic: this.#statusTopic,
				payload: textEncoder.encode("lost"),
				retain: true,
			}
		}));
		await this.#mqttThen(client => client.publish(this.#statusTopic, 'connected', { retain: true }));
	}
	info(text: string) {
		return ignoreResult(this.#mqttThen(client => client.publish(this.#chatTopic, text)));
	}
	update(topic: string, payload: string, retain = false) {
		return ignoreResult(this.#mqttThen(client => client.publish(`${this.#topicPrefix}${topic}`, payload, { retain })));
	}
	
	subLogger(path: string): Logger {
	  return new MQTTLogger(this.#mqttThen, this.#topicPrefix + path + '/');
	}
	
	static create(client:MqttClient, topic:string) : MQTTLogger {
		return new MQTTLogger(mkPromiseChain(client), topic);
	}
	static createAndConnect(client:MqttClient, topic:string) : MQTTLogger {
		const logger = this.create(client, topic);
		logger.connect();
		return logger;
	}
}
