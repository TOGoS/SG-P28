import { dirPathToPrefix } from "./src/main/ts/pathutil.ts";
import { parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";
import { MQTTLogger } from "./src/main/ts/mqtt/MQTTLogger.ts";
import { MultiLogger } from "./src/main/ts/lerg/loggers.ts";
import { MqttClient, MqttPackets } from "jsr:@ymjacky/mqtt5@0.0.19";
import { usleep } from "./src/main/ts/usleep.ts";
import { makeLogger } from "./src/main/ts/lerg/makelogger.ts";

interface MultiOscifyDirectorConfig {
	controllerSpec : TargetSpec;
	loggerSpecs : TargetSpec[];
}

async function main(abortSignal:AbortSignal, config : MultiOscifyDirectorConfig) : Promise<number> {
	if( config.controllerSpec.type != "MQTT" ) {
		console.error(`Only 'mqtt' controller supported`);
		return 1;
	}
	const port = config.controllerSpec.targetPort ?? 1883;
	const topicPrefix = dirPathToPrefix(config.controllerSpec.topic, '');
	const readersTopic = `${topicPrefix}readers`;
	const statusTopic  = `${topicPrefix}status`;
	const mqttClient = new MqttClient({url: new URL(`mqtt://${config.controllerSpec.targetHostname}:${port}`)});
	const mqttLogger = MQTTLogger.create(mqttClient, topicPrefix);
	await mqttLogger.connect();
	
	// Identify topics we should ignore becaue we published them!
	function isOwnTopic(topic:string) {
		if(topic.endsWith('/chat')) return true;
		if(topic == statusTopic) return true;
		return false;
	}
	
	const logger = new MultiLogger([
		mqttLogger,
		...config.loggerSpecs.map(makeLogger)
	]);
	
	logger.update("hi-there", "Hello!");
	logger.info("Now I'm a sleep for 5 seconds, then quit");
	await usleep(5000); // Should take abortSignal
	logger.update("hi-there", "");
	
	return 1;
}

function parseArgs(argv:string[]) : MultiOscifyDirectorConfig {
	let controllerSpec : TargetSpec|undefined;
	const loggerSpecs : TargetSpec[] = [];
	for( const arg of argv ) {
		let m : RegExpExecArray|null;
		if( (m = /^--control-root=(.*)$/.exec(arg)) != null ) {
			controllerSpec = parseTargetSpec(m[1]);
		} else if( (m = /^--logger=(.*)$/.exec(arg)) != null ) {
			loggerSpecs.push(parseTargetSpec(m[1]));
		} else {
			throw new Error(`Unrecognized argument: '${arg}'`);
		}
	}
	if( controllerSpec == undefined ) throw new Error("--control-root unspecified");
	return { controllerSpec, loggerSpecs };
}

if( import.meta.main ) {
	const config = parseArgs(Deno.args);
	const ac = new AbortController();
	const exitCode = await main(ac.signal, config);
	console.log(`# ${import.meta.filename}: Exiting with code ${exitCode}`);
	Deno.exit(exitCode);
}
