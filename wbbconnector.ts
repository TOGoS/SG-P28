/// <reference lib="Deno.window"/>

import ProcessLike, { ProcSig } from './src/main/ts/process/ProcessLike.ts';
import { ProcessGroup } from './src/main/ts/process/ProcessGroup.ts';
import { usleep } from './src/main/ts/usleep.ts';
import { SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import * as dbusTypes from 'npm:d-bus-type-system@1.0.0';
import { Adapter, Device } from 'npm:@clebert/node-bluez@1.0.0';
import { EXITCODE_ABORTED, functionToProcessLike, newPseudoPid } from './src/main/ts/process/util.ts';


class DeviceNotAvailable extends Error { }
type Milliseconds = number;
type FilePath = string;

// Maybe it'd be better to just have MQTTishMessages
// so that you could make streams of them and use
// regular stream operations.

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
		logger?      : Logger,
	} = {}
) : Promise<Device> {
	let device : Device|undefined;
	
	const logger = opts.logger ?? NULL_LOGGER;
	const abortSignal = opts.abortSignal ?? AbortSignal.any([]);
	
	// let device = await adapter.waitForDevice(macAddress);
	
	logger.update("status", "");
	
	logger.info(`Getting device for ${macAddress}...`);
	[device] = await adapter.getDevices(macAddress);
	if( device == undefined ) {
		logger.info(`getDevices("${macAddress}") returned no device`);
		throw new DeviceNotAvailable(`${macAddress} not present`);
	}
	
	logger.info(`Checking if ${macAddress} is already connected...`);
	const alreadyConnected = await device.isConnected();
	if( alreadyConnected ) {
		if( opts.forceDance ) {
			logger.info(`${macAddress} already connected, but we MUST DANCE ANYWAY`);
		} else {
			logger.info(`${macAddress} already connected!  Skipping the remove/trust/pair dance`);
			logger.update("status", "connected");
			return device;
		}
	} else {
		logger.info(`${macAddress} is *not* already connected; we must dance`);
	}
	
	function checkAbort() {
		if( abortSignal.aborted ) throw new Error(`Attempt to connect to ${macAddress} aborted`);
	}
	
	logger.info(`Device: ${JSON.stringify(device)}`);
	
	//adapter.removeDevice(device);
	await adapter.callMethod('RemoveDevice', [dbusTypes.objectPathType], [device.objectPath]);
	checkAbort();
	logger.info(`${macAddress} removed`);
	
	logger.info(`Waiting for ${macAddress} again...`);
	logger.update("status", "offline");
	
	const reconnectTimeout = 5000;
	device = await waitForDeviceOrAbort(adapter, macAddress, AbortSignal.any([abortSignal, AbortSignal.timeout(reconnectTimeout)]));
	if( device == null ) {
		logger.info(`After ${reconnectTimeout}ms, ${macAddress} never showed up`);
		throw new DeviceNotAvailable();
	}
	
	await device.setProperty('Trusted', dbusTypes.booleanType, true);
	checkAbort();
	logger.info(`Set ${macAddress} as trusted!`);
	logger.update("status", "trusted");
	
	await device.callMethod('Pair');
	checkAbort();
	logger.info(`${macAddress} paired!`);
	logger.update("status", "paired");
	
	await device.callMethod("Connect");
	checkAbort();
	logger.info(`${macAddress} Connected!`);
	logger.update("status", "connected");
	
	return device;
}

//// v2 stuff

function spawnFsWatcher(
	path:FilePath,
	onEvent: (event: Deno.FsEvent) => void,
	log?:(msg:string)=>void
) : ProcessLike {
	return functionToProcessLike(async sig => {
		const watcher = Deno.watchFs(path);
		sig.addEventListener('abort', () => watcher.close());
		for await (const event of watcher) onEvent(event);
		return 0;
	}, {
		name: "fs-watcher",
		onError: (e) => {
			if(log) log(`Error in fs watcher of '${path}': ${e}`);
			return 1;
		}
	});
}

interface WBBState {
	name: string;
	macAddress: string;
	bluezDevice?: Device;
	status?: "disconnected"|"connecting"|"connected";
	devicePathGuess?: FilePath;
}

class WBBConnectorV2 extends ProcessGroup {
	#dBus : SystemDBus;
	#adapter? : Adapter;
	name = "wbb-connector-v2";
	#unlockAdapter? : () => void;
	#abortController : AbortController = new AbortController();
	#abortSignal : AbortSignal = this.#abortController.signal;
	#deviceStates : {[mac:string]: WBBState} = {};
	#logger : Logger;
	#attemptToConnectOpts = {
		forceDance: true, // Otherwise we can't match it up with a /dev/input/whatever!
		abortSignal: this.#abortSignal,
	}
	
	constructor(opts:{id?:string, logger?:Logger}={}) {
		super(opts);
		this.#logger = opts.logger ?? NULL_LOGGER;
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
				const devTopicPrefix = `devices/${devState.name}`;
				this.log(`btConnectionLoop: Checking on ${devState.name} (${devState.status})`);
				if( devState.status == undefined || devState.status == "disconnected" ) {
					// TODO: timeout after, like, 20 seconds idk
					try {
						devState.bluezDevice = await attemptToConnect(
							adapter, devState.macAddress,
							{
								...this.#attemptToConnectOpts,
								logger: {
									info: (message:string) => this.#logger.info(`attemptToConnect("${devState.macAddress}"): ${message}`),
									update: (topic:string, payload:string, persist:boolean=false) => this.#logger.update(`${devTopicPrefix}/${topic}`, payload, persist),
									subLogger: (_path) => { throw new Error("No subloggers here lmao") },
								}
							}
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
			}
			await usleep(1000);
		}
		return 0;
	}
	
	log(msg:string) : Promise<void> {
		return this.#logger.info(msg);
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
							this.setDevicePathGuess(devState, undefined);
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
		this.addChild(functionToProcessLike(this.btConnectionLoop.bind(this), {
			name:"connector",
			onError: (e) => {
				this.log(`btConnectionLoop threw: ${e}`);
				return 1;
			}
		}));
		
		await this.#adapter.setPowered(true);
		await this.#adapter.startDiscovery();
	}
	
	addDevice(deviceInfo:{name:string, macAddress:string}) {
		this.#deviceStates[deviceInfo.name] = { ...deviceInfo };
	}
	
	setDevicePathGuess(dev:WBBState, pathGuess:string|undefined) {
		dev.devicePathGuess = pathGuess;
		this.#logger.update(`devices/${dev.name}/pathguess`, pathGuess ?? '', true);
	}
	
	override dispose() {
		try { this.#dBus.disconnect(); } catch( _e ) { /* ignore */ }
		if( this.#unlockAdapter ) this.#unlockAdapter();
		return Promise.resolve();
	}
	
	inputEventDeviceAppeared(path:FilePath) {
		const connectedDevices = Object.values(this.#deviceStates).filter(state => state.status === "connected" && !state.devicePathGuess);
		
		if( connectedDevices.length === 1 ) {
			const dev = connectedDevices[0];
			this.log(`inputEventDeviceAppeared: Associating ${connectedDevices[0].macAddress} with ${path}`);
			this.setDevicePathGuess(dev, path);
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

import { Mqtt, MqttClient } from 'jsr:@ymjacky/mqtt5@0.0.19';
import { parseTargetSpec, TargetSpec } from './src/main/ts/sink/sinkspec.ts';
import Logger from './src/main/ts/lerg/Logger.ts';
import { ConsoleLogger, MultiLogger, NULL_LOGGER } from './src/main/ts/lerg/loggers.ts';
import { MQTTLogger } from './src/main/ts/mqtt/MQTTLogger.ts';
import { dirPathToPrefix } from './src/main/ts/pathutil.ts';
export const textEncoder = new TextEncoder();

function makeLogger(spec:TargetSpec) : Logger {
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

export function makeMultiLogger(specs:TargetSpec[]) {
	const loggers : Logger[] = specs.map(makeLogger);
	return (
		loggers.length == 0 ? NULL_LOGGER :
		loggers.length == 1 ? loggers[0] :
		new MultiLogger(loggers)
	);
}

function spawnWbbConnectorV2(args:string[]) : ProcessLike {
	const deviceMacRe = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
	const namedDeviceMacRe = /^([^-][^=]*)=([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
	const loggerRe = /^--logger=(.*)/;
	
	const deviceInfos : {name:string, macAddress:string}[] = [];
	const loggerSpecs : TargetSpec[] = [];
		
	for( const arg of args ) {
		let m : RegExpExecArray|null;
		if( (m = deviceMacRe.exec(arg)) !== null ) {
			const macAddress : string = m[0];
			deviceInfos.push({
				name: macAddress.replaceAll(':','-'),
				macAddress,
			});
		} else if( (m = namedDeviceMacRe.exec(arg)) !== null ) {
			const name : string = m[1];
			const macAddress : string = m[1];
			deviceInfos.push({name, macAddress});
		} else if( (m = loggerRe.exec(arg)) !== null ) {
			loggerSpecs.push(parseTargetSpec(m[1]));
		} else {
			return functionToProcessLike((_sig) => {
				console.error(`Unrecognized argument: ${arg}`);
				return Promise.resolve(1);
			});
		}
	}
	
	const logger = makeMultiLogger(loggerSpecs);
	if( logger == NULL_LOGGER ) {
		console.warn(`No --logger indicated; you won't hear about connections!`);
	}
	
	const mang = new WBBConnectorV2({
		logger
	});
	for( const deviceInfo of deviceInfos ) {
		mang.addDevice({...deviceInfo});
	}
	// TODO: Somehow register mqtt client (or whatever)
	// with mang to close it on kill() and wait for it on wait().
	return new PromisedProcessLike(mang.start().then(() => mang));
}

//// entrypoint stuff

function spawn(args:string[]) : ProcessLike {
	if( args.length == 0 ) {
		return functionToProcessLike((_sig) => {
			console.error("Plz say 'v2'");
			return Promise.resolve(1);
		});
	} else if( args[0] == "v2" ) {
		return spawnWbbConnectorV2(args.slice(1));
	} else {
		return functionToProcessLike((_sig) => {
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
