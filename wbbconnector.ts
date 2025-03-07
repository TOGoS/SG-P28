/// <reference lib="Deno.window"/>

import ProcessLike, { ProcSig } from './src/main/ts/process/ProcessLike.ts';
import { ProcessGroup } from './src/main/ts/process/ProcessGroup.ts';
import { chunksToSimpleCommands } from './src/main/ts/simplecommandparser.ts';
import { decodeUtf8, toChunkIterator, toFixedSizeChunks } from './src/main/ts/streamiter.ts';
import { usleep } from './src/main/ts/usleep.ts';
import InputEvent, { decodeInputEvent } from './src/main/ts/InputEvent.ts';
import * as inev from './src/main/ts/InputEvent.ts';
import { SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import * as dbusTypes from 'npm:d-bus-type-system@1.0.0';
import { Adapter, Device } from 'npm:@clebert/node-bluez@1.0.0';
import { EXITCODE_ABORTED, functionToProcessLike, newPseudoPid } from './src/main/ts/process/util.ts';
import OSCMessage from "./src/main/ts/osc/Message.ts";
import { uint8ArrayToHex } from './src/main/ts/uint8ArrayToHex.ts';

class DeviceNotAvailable extends Error { }
type Milliseconds = number;
type FilePath = string;

async function waitForDeviceOrAbort(
	adapter      : Adapter,
	macAddress   : string,
	abortSignal  : AbortSignal,
	pollInterval : Milliseconds = 100
) : Promise<Device|undefined> {
	while( !abortSignal.aborted ) {
		const [device] = await adapter.getDevices(macAddress);
		if( device != undefined ) return device;
		await usleep(pollInterval);
	}
	return undefined;
}

async function attemptToConnect(
	adapter     : Adapter,
	macAddress  : string,
	opts: {
		forceDance?  : boolean,
		abortSignal? : AbortSignal,
		log?         : (message:string) => void
	} = {}
) : Promise<Device> {
	let device : Device|undefined;
	
	const log = opts.log ?? (() => {});
	const abortSignal = opts.abortSignal ?? AbortSignal.any([]);
	
	// let device = await adapter.waitForDevice(macAddress);
	
	log(`Getting device for ${macAddress}...`);
	[device] = await adapter.getDevices(macAddress);
	if( device == undefined ) {
		log(`getDevices(${macAddress}) returned no device`);
		throw new DeviceNotAvailable(`${macAddress} not present`);
	}
	
	log(`Checking if ${macAddress} is already connected...`);
	const alreadyConnected = await device.isConnected();
	if( alreadyConnected ) {
		if( opts.forceDance ) {
			log(`${macAddress} already connected, but we MUST DANCE ANYWAY`);
		} else {
			log(`${macAddress} already connected!  Skipping the remove/trust/pair dance`);
			return device;
		}
	} else {
		log(`${macAddress} is *not* already connected; we must dance`);
	}
	
	function checkAbort() {
		if( abortSignal.aborted ) throw new Error(`Attempt to connect to ${macAddress} aborted`);
	}
	
	log(`Device: ${JSON.stringify(device)}`);
	
	//adapter.removeDevice(device);
	await adapter.callMethod('RemoveDevice', [dbusTypes.objectPathType], [device.objectPath]);
	checkAbort();
	log(`${macAddress} removed`);
	
	log(`Waiting for ${macAddress} again...`);
	
	const reconnectTimeout = 5000;
	device = await waitForDeviceOrAbort(adapter, macAddress, AbortSignal.any([abortSignal, AbortSignal.timeout(reconnectTimeout)]));
	if( device == null ) {
		log(`After ${reconnectTimeout}ms, ${macAddress} never showed up`);
		throw new DeviceNotAvailable();
	}
	
	await device.setProperty('Trusted', dbusTypes.booleanType, true);
	checkAbort();
	log(`Set ${macAddress} as trusted!`);
	
	await device.callMethod('Pair');
	checkAbort();
	log(`${macAddress} paired!`);
	
	await device.callMethod("Connect");
	checkAbort();
	log(`${macAddress} Connected!`);
	
	return device;
}

//// v1 stuff

class WBBConnectorV1 implements ProcessLike {
	name = "wbb-connector-v1";
	#adapter : Adapter;
	#devices : Device[];
	#abortController : AbortController = new AbortController();
	#abortSignal : AbortSignal = this.#abortController.signal;
	#done : Promise<number>;
	#id : string;
	#attemptToConnectOpts;
	constructor(adapter : Adapter, opts : {id?:string} = {}) {
		this.#id = opts.id || newPseudoPid();
		this.#adapter = adapter;
		this.#devices = [];
		this.#done = new Promise((resolve,reject) => {
			this.#abortSignal.addEventListener('abort', () => {
				for( const dev of this.#devices ) {
					dev.disconnect();
				}		
				resolve(EXITCODE_ABORTED);
			});
		});
		this.#attemptToConnectOpts = {
			log: (msg:string) => console.log(`# attemptToConnect: ${msg}`),
			abortSignal: this.#abortSignal,
		};
	}
	connectTo(macAddr : string ) : Promise<Device> {
		return attemptToConnect(
			this.#adapter, macAddr,
			
		);
	}
	
	get id() { return this.#id; }
	kill(sig:ProcSig) { this.#abortController.abort(); }
	wait(): Promise<number> { return this.#done; }
}

function startConnectLoop1(macAddr : string, con : ()=>Promise<Device> ) : ProcessLike {
	return functionToProcessLike(async (sig) => {
		while( !sig.aborted ) {
			try {
				const device = await con();
				// Polling for now because idk how else to detect
				// when the device has been disconnected
				while( !sig.aborted && await device.isConnected() ) {
					console.log(`${macAddr} still connected`);
					await usleep(1000);
				}
			} catch( e ) {
				console.error(`Error during connection to ${macAddr}: ${e}`);
				console.error(`Sleeping a bit, then will attempt to re-connect`);
				await usleep(1000);
			}
		}
		console.log(`Connection loop to ${macAddr} exiting.`);
		return EXITCODE_ABORTED;
	});
}

function startConnectLoop2(macAddr : string, connector : WBBConnectorV1) : ProcessLike {
	return startConnectLoop1(macAddr, () => connector.connectTo(macAddr));
}

type SimpleCommand = {args: string[]};

function spawnWbbConnectorV1() : ProcessLike {
	const processGroup = new ProcessGroup();
	
	processGroup.addChild(functionToProcessLike(async (sig) => {
		const selfName = "wbb-connector-spawner-v1";
		
		const stdinReader = Deno.stdin.readable.getReader();
		const stdinProcess = functionToProcessLike(async (signal) => {
			signal.addEventListener("abort", () => stdinReader.cancel());
			
			let exitMode : number|"SIGKILL" = 0;
			for await (const cmdArgs of chunksToSimpleCommands(decodeUtf8(toChunkIterator(stdinReader)))) {
				if (signal.aborted) return 1;
				
				// A few different ways to quit:
				// - `kill` will forcibly kill the group and should result in a nonzero exit code
				// - `exit` (+ optional code) will close stdin and exit with the given code
				
				if( cmdArgs[0] === "kill" ) {
					exitMode = "SIGKILL";
					break;
				} else if( cmdArgs[0] == "exit" ) {
					exitMode = cmdArgs.length > 1 ? +cmdArgs[1] : 0;
					break;
				} else if( cmdArgs[0] == "echo" ) {
					console.log(cmdArgs.slice(1).join(' '));
				} else {
					console.log(`Unrecognized command: '${cmdArgs[0]}'`);
				}
			}
			console.log(`# stdin-reader: Reached end of command stream; exiting with code 0`);
			if( exitMode == "SIGKILL" ) {
				console.log("# Killing process group...");
				processGroup.kill("SIGKILL");
				return 1;
			} else {
				// Force process group to exit with the given code,
				// regardless of how child processes exit:
				processGroup.exit(exitMode);
				return exitMode;
			}
		}, {name: "stdin-piper"});
		
		processGroup.addChild(stdinProcess);
		
		const dBus = new SystemDBus();
		await dBus.connectAsExternal();
		
		sig.addEventListener("abort", _event => {
			try { dBus.disconnect(); } catch( _e ) { /* ignore */ }
		});
		
		try {
			await dBus.hello();
			
			console.log(`# ${selfName}: Getting adapter...`);
			const [adapter] = await Adapter.getAll(dBus);
			if( !adapter ) {
				throw new Error("No bluez adapter found");
			}
			
			console.log(`# ${selfName}: Acquiring adapter lock...`);
			const unlockAdapter = await adapter.lock.aquire();
			
			const connector = new WBBConnectorV1(adapter);
			processGroup.addChild(connector);
			
			try {
				await adapter.setPowered(true);
				await adapter.startDiscovery();
				
				processGroup.addChild(startConnectLoop2('00:21:BD:D1:5C:A9', connector));
				
				await connector.wait();
			} finally {
				connector.kill('SIGTERM');
				
				unlockAdapter();
			}
		} finally {
			try { dBus.disconnect(); } catch( _e ) { /* ignore */ }
		}
		
		return 0;
	}));
	
	return processGroup;
}

//// v2 stuff

async function readEvents(
	eventDevPath : FilePath,
	opts: {
		littleEndian?: boolean,
		onEvent      : (evt:InputEvent)=>void,
		abortSignal? : AbortSignal,
		log?         : (msg:string)=>void
	}
) : Promise<number> {
	const onEvent = opts.onEvent;
	const abortSignal = opts.abortSignal;
	const log = opts.log;
	let instream;
	try {
		instream = await Deno.open(eventDevPath, { read: true });
	} catch( error ) {
		if(log) log(`Error opening ${eventDevPath}: ${error}`);
		return 1;
	}
	let inreadable;
	try {
		inreadable = instream.readable.getReader();
	} catch( error ) {
		if(log) log(`Error getting reader for ${eventDevPath}: ${error}`);
		return 1;
	}
	const littleEndian = opts.littleEndian ?? true;
	try {
		let eventCount = 0;
		let byteCount = 0;
		for await(const chunk of toFixedSizeChunks(inev.EVENT_SIZE, toChunkIterator(inreadable))) {
			if( abortSignal && abortSignal.aborted ) return 1;
			byteCount += chunk.length;
			eventCount += 1;
			const dataView = new DataView(chunk.buffer, 0, chunk.byteLength);
			const event = decodeInputEvent(dataView, littleEndian);
			//console.log(`Event: ${JSON.stringify(event)}`);
			onEvent(event);
		}
		if(log) log(`Read ${byteCount} bytes, and ${eventCount} events`);
	} catch( error ) {
		if(log) log(`Caught error: ${error}`);
		return 1;
	} finally {
		try { inreadable.cancel(); } catch ( _e ) { /* ignore */ }
	}
	return 0;
}

function spawnFsWatcher(path:FilePath, onEvent: (event: Deno.FsEvent) => void) : ProcessLike {
	return functionToProcessLike(async sig => {
		const watcher = Deno.watchFs("/dev/input");
		sig.addEventListener('abort', () => watcher.close());
		for await (const event of watcher) onEvent(event);
		return 0;
	}, {name: "fs-watcher"});
}

interface WBBState {
	macAddress: string;
	bluezDevice?: Device;
	status?: "disconnected"|"connecting"|"connected";
	devicePathGuess?: FilePath;
	reader?: ProcessLike;
}

class WBBConnectorV2 extends ProcessGroup {
	#dBus : SystemDBus;
	#adapter? : Adapter;
	name = "wbb-connector-v2";
	#unlockAdapter? : () => void;
	#abortController : AbortController = new AbortController();
	#abortSignal : AbortSignal = this.#abortController.signal;
	#deviceStates : {[mac:string]: WBBState} = {};
	#onEvent : (macAddr:string, evt:InputEvent) => void;
	#attemptToConnectOpts = {
		forceDance: true, // Otherwise we can't match it up with a /dev/input/whatever!
		abortSignal: this.#abortSignal,
		log: (msg:string) => this.log(`attemptToConnect: ${msg}`)
	}
	
	constructor(opts:{onEvent:(macAddr:string, evt:InputEvent)=>void, id?:string}) {
		super(opts);
		this.#onEvent = opts.onEvent;
		this.#dBus = new SystemDBus();
	}
	
	override kill(sig: Deno.Signal): void {
		this.#abortController.abort();
		return super.kill(sig);
	}
	
	/**
	 * Continually poll device states and attempt to connect the unconnected,
	 * and update the status of those that may have become disconnected.
	 */
	async btConnectionLoop(sig:AbortSignal) : Promise<number> {
		const adapter = this.#adapter;
		if( !adapter ) throw new Error("Adapter not initialized!");
		while( !sig.aborted ) {
			// Continually loop over devices attempting to connect to them
			for( const devKey in this.#deviceStates ) {
				if( sig.aborted ) return EXITCODE_ABORTED;
				
				const devState = this.#deviceStates[devKey];
				this.log(`btConnectionLoop: Checking on ${devKey} (${devState.status})`);
				if( devState.status == undefined || devState.status == "disconnected" ) {
					// TODO: timeout after, like, 20 seconds idk
					try {
						devState.bluezDevice = await attemptToConnect(
							adapter, devState.macAddress,
							this.#attemptToConnectOpts
						);
						devState.status = "connected";
						await usleep(1000); // Give /dev/input/event a chance to show up before we start connecting another
					} catch( e ) {
						this.log(`Failed to connect to ${devKey}`);
						if( !(e instanceof DeviceNotAvailable) ) throw e;
					}
				} else if( devState.status == "connected" ) {
					// Check that it's still connected!
					// TODO: Maybe this doesn't need to happen as often.
					if( devState.bluezDevice == undefined ) {
						devState.status = "disconnected";
					} else if( !await devState.bluezDevice.isConnected() ) {
						devState.status = "disconnected";
					}
				}
				
				const devicePath = devState.devicePathGuess
				if( devState.status == "connected" && devicePath != undefined && devState.reader == undefined ) {
					const onEvent = (evt:InputEvent) => (this.#onEvent)(devKey, evt);
					const readerProc = functionToProcessLike(
						sig => readEvents(devicePath, {
							onEvent,
							abortSignal: sig,
							log: msg => this.log(`readEvents(${devicePath}): ${msg}`)
						}),
						{name: `oscify-${devKey}-${devState.devicePathGuess}`}
					);
					readerProc.wait().then(exitCode => {
						this.log(`readEvents(${devicePath}) exited with code ${exitCode}; removing`);
						devState.reader = undefined;
					});
					devState.reader = readerProc;
				}
			}
			await usleep(1000);
		}
		return 0;
	}
	
	log(msg:string) {
		console.log(`# ${this.name}: ${msg}`);
	}
	
	async start() : Promise<void> {
		this.log(`Starting /dev/input watcher...`);
		this.addChild(spawnFsWatcher("/dev/input", (evt) => {
			this.log(`FS watch event: ${JSON.stringify(evt)}`);
			if( evt.kind == "create" ) {
				for( const path of evt.paths ) {
					if( /^\/dev\/input\/event*/.exec(path) ) {
						this.inputEventDeviceAppeared(path);
					}
				}
			} else if( evt.kind == "remove" ) {
				for( const path of evt.paths ) {
					for( const devKey in this.#deviceStates ) {
						const devState = this.#deviceStates[devKey];
						if( devState.devicePathGuess == path ) {
							// Un-guess it!
							devState.devicePathGuess = undefined;
							// Maybe it's disconnected too, but let the other
							// process take care of that.
						}
					}
				}
			}
		}));
		
		this.log(`Connecting to D-bus...`);
		await this.#dBus.connectAsExternal();
		await this.#dBus.hello();
		this.log(`Getting adapter...`);
		const [adapter] = await Adapter.getAll(this.#dBus);
		if( adapter == undefined ) {
			throw new Error("No bluez adapter found");
		}
		
		this.#adapter = adapter;
		this.log(`Acquiring adapter lock...`);
		this.#unlockAdapter = await this.#adapter.lock.aquire();
		
		this.log(`Starting btConnectionLoop...`);
		this.addChild(functionToProcessLike(this.btConnectionLoop.bind(this), {name:"connector"}));
		
		await this.#adapter.setPowered(true);
		await this.#adapter.startDiscovery();
	}
	
	addDevice(macAddress:string) {
		this.#deviceStates[macAddress] = { macAddress };
	}
	
	override dispose() {
		try { this.#dBus.disconnect(); } catch( _e ) { /* ignore */ }
		if( this.#unlockAdapter ) this.#unlockAdapter();
		return Promise.resolve();
	}
	
	inputEventDeviceAppeared(path:FilePath) {
		const connectedDevices = Object.values(this.#deviceStates).filter(state => state.status === "connected" && !state.devicePathGuess);
		
		if( connectedDevices.length === 1 ) {
			this.log(`inputEventDeviceAppeared: Associating ${connectedDevices[0].macAddress} with ${path}`);
			connectedDevices[0].devicePathGuess = path;
		} else if( connectedDevices.length === 0 ) {
			this.log(`inputEventDeviceAppeared: Nothing connected to associate ${path} to`);
		} else {
			this.log(`inputEventDeviceAppeared: ${connectedDevices.length} devices connected; don't know with which to associate ${path}`);
		}
	}
}

/**
 * Wraps a Promise<ProcessLike> in order
 * to treat the whole chain as a single ProcessLike.
 */
class PromisedProcessLike implements ProcessLike {
	// Hmm: But wouldn't it be neat if each stage could either
	// return another ProcessLike, or maybe even a list of them
	// to be run in parallel, or an exit code?
	// 
	// (This would be a similar design to TScript34-P0020's FunctionalReactiveProcessLike,
	// which can emit output, exit, or yield a new one).
	// 
	// Maybe I could make TaskLike which is more like a cancellable
	// Promise<ThreadLike|number>.
	#prom : Promise<ProcessLike>;
	id    : string;
	name? : string;
	constructor(prom:Promise<ProcessLike>, opts:{id?:string, name?:string}={}) {
		this.#prom = prom;
		this.id = opts.id ?? newPseudoPid();
		this.name = opts.name;
	}
	kill(sig: ProcSig): void {
		// Deliver it as soon as the process is available!
		this.#prom.then(pl => pl.kill(sig));
	}
	wait(): Promise<number> {
		return this.#prom.then(pl => pl.wait());
	}
}

const OSCUDP_TARGET_REGEX = new RegExp(
	"^osc\\+udp://" +
	"(?:\\[(?<bracketedhostname>[^\\]]+)\\]|(?<hostname>[^:]+))" +
	":(?<port>\\d+)" +
	"(?:;localhost=(?<localhost>[^;\\/]+))?" +
	"(?:;debug=(?<debug>on|off))?" +
	"(?<path>/.*)$"
);

const DEFAULT_LOCAL_HOSTNAME = "0.0.0.0";

interface WBBEvent {
	wbbMacAddress: string;
	inputEvent: InputEvent;
}

function makeUdpOscSink(
	hostname:string, port:number, path:string,
	opts:{
		localHostname?:string,
		localPort?:number,
		log?:(msg:string)=>void
	}={}
) : (evt:WBBEvent)=>void {
	const log = opts.log;
	const localHostname = opts?.localHostname || DEFAULT_LOCAL_HOSTNAME;
	const localPort = opts?.localPort || port-1;
	
	const udpConn   : Deno.DatagramConn = Deno.listenDatagram({transport: "udp", port: localPort, hostname: localHostname })
	const udpTarget : Deno.Addr = {
		transport: "udp",
		hostname,
		port
	};
	
	if(log) log(`# makeUdpOscSink: ${JSON.stringify({localHostname, localPort, path, udpTarget})}`);
	
	function sendUdp(packet:Uint8Array) {
		if( packet == undefined ) {
			if(log) log(`sendUdp: Attempted to send undefined packet`);
			return;
		} else if( packet.length == 0 ) {
			if(log) log(`sendUdp: Attempted to send empty packet`);
			return;
		}
		udpConn.send(packet, udpTarget);
		if(log) log(`sendUdp: Sent UDP packet to ${JSON.stringify(udpTarget)}: ${uint8ArrayToHex(packet)}`);
	}
	
	if(log) log(`makeUdpOscSink: Sending test packet...`);
	function sendOsc(msg:OSCMessage) {
		const packet : Uint8Array = msg.marshal();
		sendUdp(packet);
	}
	
	sendOsc(new OSCMessage("/test").append("hello"));
	
	return (evt:WBBEvent) => {
		const inputEvent = evt.inputEvent;
		if (inputEvent.type == inev.EV_ABS) {
			let weightIdx = -1;
			switch (inputEvent.code) {
			case inev.ABS_HAT0X: weightIdx = 0; break;
			case inev.ABS_HAT1X: weightIdx = 1; break;
			case inev.ABS_HAT0Y: weightIdx = 2; break;
			case inev.ABS_HAT1Y: weightIdx = 3; break;
			default:
				if(log) log(`udpOscSink: Unknown ABS event: ${JSON.stringify(inputEvent)}`);
			}
			if (weightIdx >= 0) {
				// this.weights[weightIdx] = event.value;
				const destPath = path + "/" + evt.wbbMacAddress + "/" + weightIdx;
				sendOsc(new OSCMessage(destPath).append(inputEvent.value));
				if( log ) {
					log(`sendUdp: Sent OSC message to ${destPath}: ${inputEvent.value}`);
				}
			}
		} else {
			// Hitting the button on the front seems to send:
			// {"type":1,"code":304,"value":1}
			// {"type":1,"code":304,"value":0}
			if(log) log(`udpOscSink: Unknown event type: ${JSON.stringify(inputEvent)}`);
		}
	}
}

function parseWbbEventTarget(spec:string) : (wbbEvent:WBBEvent)=>void {
	let m : RegExpExecArray|null;
	if( (m = OSCUDP_TARGET_REGEX.exec(spec)) !== null ) {
		const hostname : string = m.groups!["hostname"] || m.groups!["bracketedhostname"];
		const port : number = +m.groups!["port"];
		const path : string = m.groups!["path"];
		// TODO: If localhost not explicitly specified, determine whether this will need to use IPv4 or IPv6
		// and create the listenDatagram using the corresponding localhost address.
		// Otherwise you might get
		// 'Error: An address incompatible with the requested protocol was used. (os error 10047)'
		const localHostname = m.groups!["localhost"] || DEFAULT_LOCAL_HOSTNAME;
		const debugging = (m.groups!["debug"] || "off") == "on";
		const log = debugging ? ((m:string) => console.log(`# target: ${m}`)) : undefined;
		return makeUdpOscSink(hostname, port, path, {localHostname, log});
	} else {
		throw new Error(`Unrecognized target spec: '${spec}'`);
	}
}

function spawnWbbConnectorV2(args:string[]) : ProcessLike {
	const deviceMacRe = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
	
	const deviceMacAddresses = [];
	const sinks : ((wbbEvent:WBBEvent)=>void)[] = [];
	
	for( const arg of args ) {
		let m : RegExpExecArray|null;
		if( (m = /^--target=(.*)/.exec(arg)) !== null ) {
			sinks.push(parseWbbEventTarget(m[1]));
		} else if( (m = deviceMacRe.exec(arg)) !== null ) {
			deviceMacAddresses.push(m[0]);
		} else {
			return functionToProcessLike((_sig) => {
				console.error(`Unrecognized argument: ${arg}`);
				return Promise.resolve(1);
			});
		}
	}
	
	const mang = new WBBConnectorV2({
		onEvent: (macAddr, evt) => {
			for( const sink of sinks ) {
				sink({wbbMacAddress: macAddr, inputEvent: evt});
			}
		}
	});
	for( const macAddress of deviceMacAddresses ) {
		mang.addDevice(macAddress);
	}
	return new PromisedProcessLike( mang.start().then(() => mang) );
}

//// entrypoint stuff

function spawn(args:string[]) : ProcessLike {
	if( args.length == 0 ) {
		return functionToProcessLike(async (_sig) => {
			console.error("Plz say thing or thang");
			return Promise.resolve(1);
		});
	} else if( args[0] == "v1" ) {
		return spawnWbbConnectorV1();
	} else if( args[0] == "v2" ) {
		return spawnWbbConnectorV2(args.slice(1));
	} else {
		return functionToProcessLike(async (_sig) => {
			console.error(`Unrecognized command: '${args[0]}'`);
			return Promise.resolve(1);
		});
	}
}

if (import.meta.main) {
	let proc;
	try {
		proc = await spawn(Deno.args);
	} catch( e ) {
		console.error(`Failed to spawn processlike!: ${e}`);
		Deno.exit(1);
	}
	const exitCode = await proc.wait()
	console.log(`# wbbconnector: exiting with code ${exitCode}`);
	Deno.exit(exitCode);
}
