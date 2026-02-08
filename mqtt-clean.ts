// Given a list of MQTT topic filter URLs, subscribes to each of them
// and replies to any retained messages with an empty retained message,
// effectively 'cleaning out' those topics.

import { Mqtt, MqttClient } from "jsr:@ymjacky/mqtt5@0.0.19";
import { parseTargetSpec } from "./src/main/ts/sink/sinkspec.ts";

interface MQTTTargetSpec {
	targetHostname: string;
	targetPort?: number;
	topic: string;
	debugging: boolean;
}

interface MQTTCleanerConfig {
	shouldReportOtherStuff : boolean;
	shouldReportMessages : boolean;
	shouldDeleteTopics : boolean;
	timeoutMillis : number;
	topicSpecs : MQTTTargetSpec[];
}

function connect(mqttServerAddress:{
	targetHostname: string,
	targetPort?: number,
}) : Promise<MqttClient> {
	const port = mqttServerAddress.targetPort ?? 1883;
	const url = new URL(`mqtt://${mqttServerAddress.targetHostname}:${port}`);
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
	return client.connect().then(_ => client);
}

// TODO: Maybe factor out the cleaning from the connecting and disconnecting?
// async function subscribeAnd(mqttClient:MQTTClient, topics:string[], onMsg:(mqttClient:MqttClient, msg:{topic:string, payload:Uint8Array}) { ... }

async function connectAndCleanAndDisconnect(topicSpec:MQTTTargetSpec, onMsg:(mqttClient:MqttClient, msg:{topic:string, payload:Uint8Array})=>Promise<void>, abortSignal:AbortSignal) : Promise<void> {
	const mqttClient = await connect(topicSpec);
	mqttClient.subscribe(topicSpec.topic);
	mqttClient.on("publish", evt => {
		if( evt.detail.retain && evt.detail.payload.length > 0 ) {
			return onMsg(mqttClient, evt.detail);
		}
	});
	return new Promise<void>((resolve,reject) => {
		mqttClient.on("disconnect", (_evt) => reject(new Error("disconnected")));
		abortSignal.addEventListener("abort", () => resolve());
	}).finally( () => {
		return mqttClient.disconnect(); // Should it force?  idk.
	})
}

const EMPTY_UINT8ARRAY:Uint8Array = new Uint8Array(0);
const RESOLVED_PROMISE:Promise<void> = Promise.resolve();

function main(config : MQTTCleanerConfig, abortSignal:AbortSignal) : Promise<number> {
	const onMsg = (mqttClient:MqttClient, msg:{topic:string, payload:Uint8Array}):Promise<void> => {
		if( config.shouldReportMessages ) console.log(`# Received ${msg.payload.length}-byte message at ${msg.topic}`);
		if( config.shouldDeleteTopics ) {
			if( config.shouldReportOtherStuff ) console.log(`# Sending 0-byte retained message back to ${msg.topic}`);
			mqttClient.publish(msg.topic, EMPTY_UINT8ARRAY); // Fire and forget for now
		}
		return RESOLVED_PROMISE;
	}
	
	const subAbortSignal = AbortSignal.any([abortSignal, AbortSignal.timeout(config.timeoutMillis)]);
	
	const promz = [];
	for( const spec of config.topicSpecs ) {
		promz.push(connectAndCleanAndDisconnect(spec, onMsg, subAbortSignal).catch(e => {
			console.error(`Error trying to clean mqtt://${spec.targetHostname}${spec.targetPort ? ":" + spec.targetPort : ""}/${spec.topic}`, e);
		}));
	}
	if( config.shouldReportOtherStuff ) {
		console.log(`# Making ${promz.length} connections`);
		console.log(`# Waiting ${config.timeoutMillis}ms`);
	}
	
	return Promise.allSettled(promz).then(_ok => 0, _err => 1);
}

function throwError(message:string) : never {
	throw new Error(message);
}

function parseDurationToMilliseconds(durationStr:string) : number {
	let m : RegExpExecArray|null;
	if( (m = /^(\d+(?:\d+)?)(s|ms|m)$/.exec(durationStr)) != null ) {
		const quantity = +m[1]
		const mult =
			m[2] ==  "m" ? 60000 :
			m[2] ==  "s" ?  1000 :
			m[2] == "ms" ?     1 :
			throwError(`Unrecognized duration unit: '${m[2]}`);
		return quantity*mult;
	} else {
		throwError(`Unrecognized duration string: '${durationStr}`);
	}
}

function parseArgs(argv:string[]) : MQTTCleanerConfig {
	let shouldReportMessages : boolean = true;
	let shouldReportOtherStuff : boolean = false;
	let shouldDeleteTopics : boolean = false;
	let timeoutMillis : number = 5000;
	let m : RegExpExecArray|null;
	const topicSpecs : MQTTTargetSpec[] = [];
	for( const arg of argv ) {
		if( arg == "--dry-run" ) {
			shouldReportMessages = true;
			shouldDeleteTopics = false;
		} else if( arg == "-q" ) {
			shouldReportMessages = false;
			shouldReportOtherStuff = false;
		} else if( arg == "-v" ) {
			shouldReportMessages = true;
			shouldReportOtherStuff = true;
		} else if( arg == "--do" ) {
			shouldDeleteTopics = true;
		} else if( (m = /--timeout=(.*)$/.exec(arg)) != null ) {
			timeoutMillis = parseDurationToMilliseconds(m[1]);
		} else if( !arg.startsWith("-") ) {
			const targetSpec = parseTargetSpec(arg);
			if( targetSpec.type == "MQTT" ) topicSpecs.push(targetSpec);
			else throw new Error(`Only MQTT targets supported; given '${arg}'`);
		} else {
			throw new Error(`Unrecognized argument: '${arg}'`);
		}
	}
	return { shouldReportMessages, shouldReportOtherStuff, shouldDeleteTopics, timeoutMillis, topicSpecs };
}

if( import.meta.main ) {
	const config = parseArgs(Deno.args);
	const ac = new AbortController();
	const exitCode = await main(config, ac.signal);
	console.log(`# ${import.meta.filename}: Exiting with code ${exitCode}`);
	Deno.exit(exitCode);
}
