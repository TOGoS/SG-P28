//// TODO: rewrite all that to do multiple thingies

// This program will take options:
//   --topic=mqtt://localhost:1883/(mytopic)/
//   --udp-local-port=1234
// MQTT topics (output):
//   (prefix)status :: status of this process ("online" or "offline")
//   (prefix)readers/(reader name)/target
//   (prefix)readers/(reader name)/inputpath
//   (prefix)readers/(reader name)/status :: "running" or undefined
// MQTT topics (input):
//   (prefix)readers/(reader name)/target/set :: URI of target, e.g. osc+udp://localhost:1234/WBB-1/
//   (prefix)readers/(reader name)/inputpath/set :: path to /dev/input/eventX

import { MqttClient } from "jsr:@ymjacky/mqtt5@0.0.19";
import { parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";
import ProcessGroup from "./src/main/ts/process/ProcessGroup.ts";
import ProcessLike from "./src/main/ts/process/ProcessLike.ts";
import Consumer from "./src/main/ts/sink/Consumer.ts";
import InputEvent, { decodeInputEvent, EVENT_SIZE } from "./src/main/ts/InputEvent.ts";
import { functionToProcessLike2 } from "./src/main/ts/process/util.ts";
import { toChunkIterator, toFixedSizeChunks } from "./src/main/ts/streamiter.ts";

type FilePath = string;
type URI = string;

interface Logger {
	info(message:string) : Promise<void>;
	update(topic:string, payload:string, retain?:boolean) : Promise<void>;
}

const textEncoder = new TextEncoder();

interface MultiOscifyConfig {
	controllerSpec : TargetSpec;
	udpLocalPort : number;
}

function parseArgs(argv:string[]) : MultiOscifyConfig {
	let controllerSpec : TargetSpec|undefined;
	let udpLocalPort : number|undefined;
	for( const arg of argv ) {
		let m : RegExpExecArray|null;
		if( (m = /^--controller=(.*)$/.exec(arg)) != null ) {
			controllerSpec = parseTargetSpec(m[1]);
		} else if( (m = /^--udp-local-port=(\d+)$/.exec(arg)) != null ) {
			udpLocalPort = +m[1];
		} else {
			throw new Error(`Unrecognized argument: '${arg}'`);
		}
	}
	if( controllerSpec == undefined ) throw new Error("--controller unspecified");
	if( udpLocalPort == undefined ) throw new Error("--udp-local-port unspecified");
	return { controllerSpec, udpLocalPort };
}

interface OSCifierConfig {
	inputPath? : string;
	targetUri? : string;
}

interface OSCifierStats { }
interface OSCifierProcess extends ProcessLike {
	readonly stats : OSCifierStats;
}
interface OSCifier {
	currentConfig : OSCifierConfig;
	targetConfig  : OSCifierConfig;
	currentProcess? : OSCifierProcess;
}

function spawnOscifier(devicePath : FilePath, eventSink : Consumer<InputEvent> ) : OSCifierProcess {
	return functionToProcessLike2<OSCifierProcess>(
		pl => {
			const obj = Object.create(pl);
			// obj.stats = {};
			return obj;
		},
		async abortSignal => {
			using instream = await Deno.open(devicePath, { read: true });
			const inreadable = instream.readable.getReader();
			abortSignal.addEventListener('abort', () => inreadable.cancel());
			
			let byteCount = 0;
			let eventCount = 0;
			let minValue = Infinity;
			let maxValue = +Infinity;
			const littleEndian = true; // May need to override?
			for await(const chunk of toFixedSizeChunks(EVENT_SIZE, toChunkIterator(inreadable))) {
				byteCount += chunk.length;
				eventCount += 1;
				const dataView = new DataView(chunk.buffer, 0, chunk.byteLength);
				const event = decodeInputEvent(dataView, littleEndian);
				//console.log(`Event: ${JSON.stringify(event)}`);
				eventSink.accept(event);
				
				minValue = Math.min(minValue, event.value);
				maxValue = Math.max(maxValue, event.value);
			}
			
			return 0;
		}
	);
}

class OSCifierControl extends ProcessGroup {
	#oscifiers : {[name:string]: OSCifier} = {};
	#logger : Logger;
	#eventSinkSource : (uri:URI)=>Consumer<InputEvent>;
	
	constructor( logger: Logger, eventSinkSource:((uri:URI) => Consumer<InputEvent>), opts:{id?:string}={} ) {
		super(opts);
		this.#logger = logger;
		this.#eventSinkSource = eventSinkSource;
	}
	
	#spawnOscifier(devicePath:string, targetUri:URI) : OSCifierProcess {
		const sink = this.#eventSinkSource(targetUri);
		const oscifier = spawnOscifier(devicePath, sink);
		this.addChild(oscifier);
		return oscifier;
	}
	
	setReaderProp(readerName:string, propName:"inputPath"|"targetUri", value:string) : void {
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
			osc.currentProcess?.kill("SIGTERM");
			// TODO: Publush status (and stats, somehow) of current process
			if( targetConfig.inputPath != undefined && targetConfig.targetUri != undefined ) {
				setTimeout(() => { // 'Throttle/debounce changes'
					// If it has been changed again, abort this update:
					if( osc.targetConfig != targetConfig ) return;
					
					// Otherwise, make target current:
					// TODO: Maybe wait for current process to exit before spawning a new one?
					osc.currentConfig = osc.targetConfig;
					osc.currentProcess = this.#spawnOscifier(targetConfig.inputPath!, targetConfig.targetUri!);
				}, 200);
			};
		}
	}
	
	handleMessage(topic:string, payload:string) : Promise<void> {
		let m : RegExpExecArray | null;
		if( (m = /^readers\/([^\/]+)\/(target|inputpath)\/set$/.exec(topic)) != null ) {
			const readerName = m[1];
			const propName = m[2] == "target" ? "targetUri" : "inputPath";
			this.setReaderProp(readerName, propName, payload);
		}
	}
}

async function main(sig:AbortSignal, config:MultiOscifyConfig) : Promise<number> {
	if( config.controllerSpec.type != "MQTT" ) {
		console.error(`Only 'mqtt' controller supported`);
		return 1;
	}
	const port = config.controllerSpec.targetHostname ?? 1883;
	const topicPrefix = config.controllerSpec.topic;
	const readersTopic = `${topicPrefix}readers`;
	const statusTopic  = `${topicPrefix}status`;
	const mqttClient = new MqttClient({url: new URL(`mqtt://${config.controllerSpec.targetHostname}:${port}`)});
	await mqttClient.connect({
		will: {
			topic: statusTopic,
			payload: textEncoder.encode("offline"),
		}
	});
	
	await mqttClient.subscribe(readersTopic);
	
	mqttClient.on('publish', evt => {
		// TODO something with topic and payload
		evt.detail.topic // 
	});
	
	mqttClient.publish(statusTopic, "online");
	
	// TODO: Start a OSCifierControl, blah blah
	
	return 0;
}

if( import.meta.main ) {
	const config = parseArgs(Deno.args);
	const ac = new AbortController();
	Deno.exit(await main(ac.signal, config));
}
