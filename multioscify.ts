// A program to read WBB events from /dev/input/event(number) devices
// and forward them somewhere else, probably over OSC.
// 
// Controlled by MQTT.  --control-port=(MQTT URI) indicates the root
// path that is used to control this program and that this program
// publishes statis updates to.
// 
// Options:
//   --control-root=mqtt://localhost:1883/(mytopic)/
//   --udp-local-port=1234
// MQTT topics (output):
//   (prefix)status :: status of this process ("online" or "offline")
//   (prefix)readers/(reader name)/target
//   (prefix)readers/(reader name)/inputpath
//   (prefix)readers/(reader name)/status :: "running" or undefined
// MQTT topics (input):
//   (prefix)readers/(reader name)/target/set :: URI of target, e.g. osc+udp://localhost:1234/WBB-1/
//   (prefix)readers/(reader name)/inputpath/set :: path to /dev/input/eventX

import { MqttClient, MqttPackets } from "jsr:@ymjacky/mqtt5@0.0.19";
import { parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";
import ProcessGroup from "./src/main/ts/process/ProcessGroup.ts";
import ProcessLike from "./src/main/ts/process/ProcessLike.ts";
import InputEvent, { decodeInputEvent, EVENT_SIZE } from "./src/main/ts/InputEvent.ts";
import { functionToProcessLike, functionToProcessLike2 } from "./src/main/ts/process/util.ts";
import { toChunkIterator, toFixedSizeChunks } from "./src/main/ts/streamiter.ts";
import { MQTTLogger } from "./src/main/ts/mqtt/MQTTLogger.ts";
import { ConsoleLogger, MultiLogger } from "./src/main/ts/lerg/loggers.ts";
import { dirPathToPrefix } from "./src/main/ts/pathutil.ts";
import Logger from "./src/main/ts/lerg/Logger.ts";
import { makeInputEventSink } from "./src/main/ts/sink/inputeventsinks.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

type FilePath = string;
type URI = string;

const textDecoder = new TextDecoder();

interface MultiOscifyConfig {
	controllerSpec : TargetSpec;
	udpLocalHostname? : string;
	udpLocalPort : number;
}

function parseArgs(argv:string[]) : MultiOscifyConfig {
	let controllerSpec : TargetSpec|undefined;
	let udpLocalHostname : string|undefined;
	let udpLocalPort : number|undefined;
	for( const arg of argv ) {
		let m : RegExpExecArray|null;
		if( (m = /^--control-root=(.*)$/.exec(arg)) != null ) {
			controllerSpec = parseTargetSpec(m[1]);
		} else if( (m = /^--udp-local-port=(\d+)$/.exec(arg)) != null ) {
			udpLocalPort = +m[1];
		} else if( (m = /^--udp-local-port=(?:\[(?<hostname>[^\]]+)\]|(?<hostname>[^\[\]:]+)):(?<port>\d+)$/.exec(arg)) != null ) {
			udpLocalHostname = m.groups!['hostname'];
			udpLocalPort = +m.groups!['port'];
		} else {
			throw new Error(`Unrecognized argument: '${arg}'`);
		}
	}
	if( controllerSpec == undefined ) throw new Error("--control-root unspecified");
	if( udpLocalPort == undefined ) throw new Error("--udp-local-port unspecified");
	return { controllerSpec, udpLocalHostname, udpLocalPort };
}

Deno.test("parse UDP local port without host ", () => {
	const parsed = parseArgs(['--control-root=debug', '--udp-local-port=1234']);
	const expected : MultiOscifyConfig = {
		controllerSpec: { type: "Console" },
		udpLocalHostname: undefined,
		udpLocalPort: 1234,
	}
	assertEquals(parsed, expected);
});

Deno.test("parse UDP local port with unbracketed host", () => {
	const parsed = parseArgs(['--control-root=debug', '--udp-local-port=foo.com:1234']);
	const expected : MultiOscifyConfig = {
		controllerSpec: { type: "Console" },
		udpLocalHostname: 'foo.com',
		udpLocalPort: 1234,
	}
	assertEquals(parsed, expected);
});

Deno.test("parse UDP local port with bracketed host", () => {
	const parsed = parseArgs(['--control-root=debug', '--udp-local-port=[0::0]:1234']);
	const expected : MultiOscifyConfig = {
		controllerSpec: { type: "Console" },
		udpLocalHostname: '0::0',
		udpLocalPort: 1234,
	}
	assertEquals(parsed, expected);
});

interface OSCifierConfig {
	inputPath? : string;
	targetUri? : string;
}

interface OSCifierProcess extends ProcessLike {}
interface OSCifier {
	currentConfig : OSCifierConfig;
	targetConfig  : OSCifierConfig;
	currentProcess? : OSCifierProcess;
}

function spawnOscifier(devicePath : FilePath, eventSink : (evt:InputEvent) => void, logger : Logger ) : OSCifierProcess {
	return functionToProcessLike2<ProcessLike>(
		pl => pl,
		async abortSignal => {
			const littleEndian = true; // May need to override?
			logger.info(`Opening ${devicePath}...`);
			using instream = await Deno.open(devicePath, { read: true });
			logger.info(`${devicePath} opened!`);
			const inreadable = instream.readable.getReader();
			abortSignal.addEventListener('abort', () => {
				logger.info(`Received abort signal; cancelling reader`);
				inreadable.cancel()
			});
			
			let statpubtimer : number|undefined;
			try {
				logger.update('status','online');
				let byteCount = 0;
				let eventCount = 0;
				let minValue = Infinity;
				let maxValue = -Infinity;
				const finiteNumToStr = function(num:number) : string {
					return isFinite(num) ? "" + num : "";
				}
				const publishStats = function() {
					logger.update('stats/bytesread', ""+byteCount);
					logger.update('stats/eventsread', ""+eventCount);
					logger.update('stats/maxvalue', finiteNumToStr(maxValue));
					logger.update('stats/minvalue', finiteNumToStr(minValue));
				}
				statpubtimer = setInterval(() => {
					publishStats();
				}, 1000);
				for await(const chunk of toFixedSizeChunks(EVENT_SIZE, toChunkIterator(inreadable))) {
					byteCount += chunk.length;
					eventCount += 1;
					const dataView = new DataView(chunk.buffer, 0, chunk.byteLength);
					const event = decodeInputEvent(dataView, littleEndian);
					eventSink(event);
					
					minValue = Math.min(minValue, event.value);
					maxValue = Math.max(maxValue, event.value);
				}
			} finally {
				logger.update('status','offline');
				if(statpubtimer != undefined) clearInterval(statpubtimer);
			}
			
			return 0;
		}
	);
}

class OSCifierControl extends ProcessGroup {
	#oscifiers : {[name:string]: OSCifier} = {};
	#logger : Logger;
	#eventSinkSource : (uri:URI) => (evt:InputEvent) => void;
	
	constructor( logger: Logger, eventSinkSource:((uri:URI) => (evt:InputEvent) => void), opts:{id?:string, abortController?:AbortController}={} ) {
		super(opts);
		this.#logger = logger;
		this.#eventSinkSource = eventSinkSource;
	}
	
	#spawnOscifier(name:string, devicePath:string, targetUri:URI) : OSCifierProcess {
		const sink = this.#eventSinkSource(targetUri);
		const oscifier = spawnOscifier(devicePath, sink, this.#logger.subLogger(`readers/${name}`));
		this.addChild(oscifier);
		return oscifier;
	}
	
	setReaderProp(readerName:string, propName:"inputPath"|"targetUri", value:string|undefined) : void {
		if( value == '' ) value = undefined;
		let osc = this.#oscifiers[readerName];
		if( osc == null ) {
			this.#oscifiers[readerName] = osc = {
				currentConfig: {
					inputPath: undefined,
					targetUri: undefined,
				},
				targetConfig: {
					inputPath: undefined,
					targetUri: undefined,
				},
				currentProcess: undefined,
			}
		}
		if( osc.targetConfig[propName] !== value ) {
			// Target changed!  Kill current process, wait for target to stop changing, and restart.
			const targetConfig = {...osc.targetConfig, [propName]: value};
			osc.targetConfig = targetConfig;
			if( osc.currentProcess != undefined ) {
				this.#logger.info(`Killing old reader process (${osc.currentProcess.id} / '${osc.currentProcess.name}')`)
				osc.currentProcess.kill("SIGTERM");
			}
			if( targetConfig.inputPath != undefined && targetConfig.targetUri != undefined ) {
				setTimeout(async () => { // 'Throttle/debounce changes'
					// If it has been changed again, abort this update:
					if( osc.targetConfig != targetConfig ) return;
					
					// Otherwise, make target current:
					osc.currentConfig = osc.targetConfig;
					this.#logger.update(`readers/${readerName}/inputpath`, osc.currentConfig.inputPath!);
					this.#logger.update(`readers/${readerName}/target`, osc.currentConfig.targetUri!);
					
					if( osc.currentProcess != undefined ) {
						this.#logger.info(`Waiting for old reader proces (${osc.currentProcess.id} / '${osc.currentProcess.name}') to exit`)
						await osc.currentProcess.wait();
					}
					
					this.#logger.info(`Spawning oscifier from ${targetConfig.inputPath} to ${targetConfig.targetUri}`);
					osc.currentProcess = this.#spawnOscifier(readerName, targetConfig.inputPath!, targetConfig.targetUri!);
				}, 200);
			};
		}
	}
	
	async handleMessage(topic:string, payload:string) : Promise<void> {
		let m : RegExpExecArray | null;
		if( topic == 'stop' ) {
			await this.#logger.info("Received stop command; exiting with code 0");
			this.exit(0);
		} else if( topic == 'restart' ) {
			await this.#logger.info("Received restart command; exiting with code 69");
			this.exit(69);
		} else if( (m = /^readers\/([^\/]+)\/(target|inputpath)\/set$/.exec(topic)) != null ) {
			const readerName = m[1];
			const propName = m[2] == "target" ? "targetUri" : "inputPath";
			this.setReaderProp(readerName, propName, payload);
		} else {
			this.#logger.info(`Unrecognized topic: ${topic}`);
		}
		return Promise.resolve();
	}
}

export default class LazyPromise<T> implements PromiseLike<T> {
	constructor(protected generator:(resolve:(value:T)=>void, reject:(error:unknown)=>void)=>void) {}
	
	protected prom : Promise<T> | undefined;
	
	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		// deno-lint-ignore no-explicit-any
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
	): PromiseLike<TResult1 | TResult2> {
		if( this.prom == undefined ) {
			this.prom = new Promise(this.generator);
		}
		return this.prom.then(onfulfilled, onrejected);
	}
}

function memoize<I,O>(func : (i:I)=>O) : (i:I)=>O {
	const cache = new Map<I,O>();
	return (i:I) => {
		let cached = cache.get(i);
		if( cached !== undefined || cache.has(i) ) return cached as O;
		
		cached = func(i);
		cache.set(i, cached);
		return cached;
	};
}

// TODO: Have this return a ProcessLike
async function main(sig:AbortSignal, config:MultiOscifyConfig) : Promise<number> {
	if( config.controllerSpec.type != "MQTT" ) {
		console.error(`Only 'mqtt' controller supported`);
		return 1;
	}
	const port = config.controllerSpec.targetPort ?? 1883;
	const topicPrefix = dirPathToPrefix(config.controllerSpec.topic, '');
	const readersTopic = `${topicPrefix}readers`;
	const statusTopic  = `${topicPrefix}status`;
	const mqttClient = new MqttClient({url: new URL(`mqtt://${config.controllerSpec.targetHostname}:${port}`)});
	const mqttLogger = new MQTTLogger(mqttClient, topicPrefix);
	await mqttLogger.connect();
	
	// Identify topics we should ignore becaue we published them!
	function isOwnTopic(topic:string) {
		if(topic.endsWith('/chat')) return true;
		if(topic == statusTopic) return true;
		return false;
	}
	
	const logger = new MultiLogger([
		new ConsoleLogger(console),
		mqttLogger
	]);
	
	const udpLocalPortProm = new LazyPromise<Deno.DatagramConn>((resolve,reject) => {
		try {
			logger.info(`Creating datagram on local host:port ${config.udpLocalHostname}:${config.udpLocalPort}...`);
			resolve(Deno.listenDatagram({ transport: "udp", port: config.udpLocalPort, hostname: config.udpLocalHostname, reuseAddress: true }));
			logger.info(`Datagram connection created!`);
		} catch (e) {
			reject(e);
		}
	});
	
	const eventSinkSource : (uri:string) => (evt:InputEvent) => void = memoize(uri => {
		const targetSpec = parseTargetSpec(uri);
		return makeInputEventSink(targetSpec, {
			datagramConnPromise: udpLocalPortProm
		});
	});
	
	const control = new OSCifierControl(logger, eventSinkSource);
	control.addChild(functionToProcessLike(async sig => {
		const onPublish = (evt : CustomEvent<MqttPackets.PublishPacket>) => {
			const topic = evt.detail.topic;
			if( isOwnTopic(topic) ) {
				// Ignore!
			} else if( topic.startsWith(topicPrefix) ) {
				const subTopic = topic.substring(topicPrefix.length);
				logger.info(`mqttReader: Got oscifier control message from MQTT, subtopic '${subTopic}'`)
				control.handleMessage(subTopic, textDecoder.decode(evt.detail.payload))
			} else {
				logger.info(`mqttReader: Got unexpected message on ${topic}`);
			}
		};
		
		logger.info(`mqttReader: Registering publish handler`);
		mqttClient.on('publish', onPublish);
		
		const subscribeTopics = [`${topicPrefix}stop`, `${topicPrefix}restart`, `${readersTopic}/+/inputpath/set`, `${readersTopic}/+/target/set`];
		for( const subtop of subscribeTopics ) {
			logger.info(`mqttReader: Subscribing to ${subtop}...`);
			await mqttClient.subscribe(subtop);
		}
		
		mqttClient.publish(statusTopic, "online");
		const waitForAbort = new Promise((_resolve,reject) => {
			logger.info(`mqttReader: waiting for abort signal`);
			sig.addEventListener("abort", (_ev) => {
				reject("aborted");
			})
		});
		
		try {
			await waitForAbort;
		} finally {
			mqttClient.off('publish', onPublish);
		}
		return 1; // This process can only be crashed
	}, {name: "MQTT control reader"}));
	
	sig.addEventListener("abort", () => control.kill("SIGTERM"));
	
	return control.wait();
}

if( import.meta.main ) {
	const config = parseArgs(Deno.args);
	const ac = new AbortController();
	const exitCode = await main(ac.signal, config);
	console.log(`# ${import.meta.filename}: Exiting with code ${exitCode}`);
	Deno.exit(exitCode);
}
