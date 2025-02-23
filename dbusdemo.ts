import { DBus, SystemDBus } from 'npm:@clebert/node-d-bus@1.0.0';
import { Adapter, Device } from 'npm:@clebert/node-bluez@1.0.0';
import ProcessLike, { ProcSig } from './src/main/ts/process/ProcessLike.ts';

import * as dbusTypes from 'npm:d-bus-type-system@1.0.0';
import { EXITCODE_ABORTED, functionToProcessLike, newPseudoPid } from './src/main/ts/process/util.ts';
import { ProcessGroup } from './src/main/ts/process/ProcessGroup.ts';
import { toCommands, Token, toTokens } from './src/main/ts/CommandTokenizer.ts';
import { decodeUtf8, toChunkIterator } from './src/main/ts/streamiter.ts';

// Based on code from https://github.com/clebert/node-bluez

function usleep(duration:number) : Promise<void> {
	return new Promise((resolve,reject) => {
		setTimeout(() => resolve(), duration);
	});
}

class WBBConnector implements ProcessLike {
	#adapter : Adapter;
	#devices : Device[];
	#abortSignal : AbortSignal;
	#abortController : AbortController;
	#done : Promise<number>;
	#id : string;
	constructor(adapter : Adapter, opts : {id?:string} = {}) {
		this.#id = opts.id || newPseudoPid();
		this.#adapter = adapter;
		this.#devices = [];
		this.#abortController = new AbortController();
		this.#abortSignal = this.#abortController.signal;
		this.#done = new Promise((resolve,reject) => {
			this.#abortSignal.addEventListener('abort', () => {
				for( const dev of this.#devices ) {
					dev.disconnect();
				}		
				resolve(EXITCODE_ABORTED);
			});
		});
	}
	async connectTo(macAddr : string ) : Promise<Device> {
		console.log("Waiting for device...");
		let device = await this.#adapter.waitForDevice(macAddr);
		
		console.log("Device: ", device);
		
		//adapter.removeDevice(device);
		await this.#adapter.callMethod('RemoveDevice', [dbusTypes.objectPathType], [device.objectPath]);
		console.log("Device removed");
		
		console.log("Waiting for device again...");
		device = await this.#adapter.waitForDevice(macAddr);
		this.#devices.push(device);
		
		await device.setProperty('Trusted', dbusTypes.booleanType, true);
		console.log("Set trusted!");
		
		await device.callMethod('Pair');
		console.log("Device paired!");
		
		await device.callMethod("Connect");
		console.log("Connected!");
		
		return device;
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

function startConnectLoop2(macAddr : string, connector : WBBConnector) : ProcessLike {
	return startConnectLoop1(macAddr, () => connector.connectTo(macAddr));
}

type SimpleCommand = {args: string[]};

function tokensToSimpleCommand(tokens:Token[]) : SimpleCommand {
	return {
		args: tokens.flatMap(tok => {
			switch(tok.type) {
			case "bareword":
			case "quoted-string":
				return [tok.value];
			case 'newline':
			case 'whitespace':
			case 'comment':
				return [];
			default:
				throw new Error(`Unrecognized token type: '${(tok as Token).type}'`);
			}
		})
	}
}
function spawnThing() : ProcessLike {	
	const processGroup = new ProcessGroup();
	
	processGroup.addChild(functionToProcessLike(async (sig) => {
		const stdinReader = Deno.stdin.readable.getReader();
		const stdinProcess = functionToProcessLike(async (signal) => {
			signal.addEventListener("abort", () => stdinReader.cancel());
	
			for await (const command of toCommands(toTokens(decodeUtf8(toChunkIterator(stdinReader))))) {
				if (signal.aborted) return 1;
				
				const cmd = tokensToSimpleCommand(command);
				const cmdArgs = cmd.args;
				
				// A few different ways to quit:
				// - `kill` will forcibly kill the group and should result in a nonzero exit code
				// - `exit` (+ optional code) will close stdin and exit with the given code
				
				if( cmdArgs[0] === "kill" ) {
					console.log("# Killing process group...");
					processGroup.kill("SIGKILL");
					break;
				}
				if( cmdArgs[0] == "exit" ) {
					const code = cmdArgs.length > 1 ? +cmdArgs[1] : 0;
					processGroup.exit(code);
					break;
				}
				if( cmdArgs[0] == "echo" ) {
					console.log(cmdArgs.slice(1).join(' '));
					break;
				}
				
				console.log(`Unrecognized command: '${cmdArgs[0]}'`);
			}
			processGroup.exit(0);
			return 0;
		}, {name: "stdin-piper"});
		
		processGroup.addChild(stdinProcess);
		
		const dBus = new SystemDBus();
		await dBus.connectAsExternal();
		
		sig.addEventListener("abort", _event => {
			try {	dBus.disconnect(); } catch( _e ) { /* ignore */ }
		});
		
		try {
			await dBus.hello();
			
			const [adapter] = await Adapter.getAll(dBus);
			if( !adapter ) {
				throw new Error("No bluez adapter found");
			}
			
			const unlockAdapter = await adapter.lock.aquire();
			
			const connector = new WBBConnector(adapter);
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

if (import.meta.main) {
	Deno.exit(await spawnThing().wait());
}
