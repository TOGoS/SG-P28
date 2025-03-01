import { DBus, SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import { Adapter, Device } from 'npm:@clebert/node-bluez@1.0.0';
import ProcessLike, { ProcSig } from './src/main/ts/process/ProcessLike.ts';

import * as dbusTypes from 'npm:d-bus-type-system@1.0.0';
import { EXITCODE_ABORTED, functionToProcessLike, newPseudoPid } from './src/main/ts/process/util.ts';
import { ProcessGroup } from './src/main/ts/process/ProcessGroup.ts';
import { chunksToSimpleCommands } from './src/main/ts/simplecommandparser.ts';
import { decodeUtf8, toChunkIterator } from './src/main/ts/streamiter.ts';

class DeviceNotAvailable extends Error { }
type Milliseconds = number;

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

type FilePath = string;

function usleep(duration:number) : Promise<void> {
	return new Promise((resolve,reject) => {
		setTimeout(() => resolve(), duration);
	});
}

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

function spawnFsWatcher(path:FilePath, onEvent: (event: Deno.FsEvent) => void) : ProcessLike {
	return functionToProcessLike(async sig => {
		const watcher = Deno.watchFs("/dev/input");
		sig.addEventListener('abort', () => watcher.close());
		for await (const event of watcher) onEvent(event);
		return 0;
	}, {name: "fs-watcher"});
}

interface WBBState {
	macAddress: string,
	bluezDevice?: Device,
	status?: "disconnected"|"connecting"|"connected",
	devicePathGuess?: FilePath,
}

class WBBConnectorV2 extends ProcessGroup {
	#dBus : SystemDBus;
	#adapter? : Adapter;
	name = "wbb-connector-v2";
	#unlockAdapter? : () => void;
	#abortController : AbortController = new AbortController();
	#abortSignal : AbortSignal = this.#abortController.signal;
	#deviceStates : {[mac:string]: WBBState} = {};
	#attemptToConnectOpts = {
		forceDance: true, // Otherwise we can't match it up with a /dev/input/whatever!
		abortSignal: this.#abortSignal,
		log: (msg:string) => this.log(`attemptToConnect: ${msg}`)
	}
	
	constructor() {
		super();
		this.#dBus = new SystemDBus();
	}
	
	override kill(sig: Deno.Signal): void {
		this.#abortController.abort();
		return super.kill(sig);
	}
	
	async btConnectionLoop(sig:AbortSignal) : Promise<number> {
		const adapter = this.#adapter;
		if( !adapter ) throw new Error("Adapter not initialized!");
		while( !sig.aborted ) {
			// Continually loop over devices attempting to connect to them
			for( let devKey in this.#deviceStates ) {
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

function spawnWbbConnectorV2(args:string[]) : ProcessLike {
	const mang = new WBBConnectorV2();
	for( const macAddress of args ) {
		mang.addDevice(macAddress);
	}
	return new PromisedProcessLike( mang.start().then(() => mang) );
}

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
