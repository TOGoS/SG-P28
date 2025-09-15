import * as ansicodes from 'https://deno.land/x/tui@2.1.11/src/utils/ansi_codes.ts';
import { MqttClient, MqttPackets } from "jsr:@ymjacky/mqtt5@0.0.19";
import { inputEvents } from 'https://deno.land/x/scratch38s15@0.0.8/src/lib/ts/terminput/inputeventparser.ts';
import TOGTUICanvas, { TOGTUIRenderer } from 'https://deno.land/x/scratch38s15@0.0.8/src/lib/ts/termdraw/TOGTUICanvas.ts';
import BoxDrawr from 'https://deno.land/x/scratch38s15@0.0.6/src/lib/ts/termdraw/BoxDrawr.ts';
import { formatTargetSpec, parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";
import { PossiblyTUIAppSpawner } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts';
import { DenoStdinLike } from '../Scratch38-S0015/src/lib/ts/tuiappframework3.ts';
import ProcessLike from './src/main/ts/process/ProcessLike.ts';
import { Waitable } from '../Scratch38-S0015/src/lib/ts/tuiappframework3.ts';
import { functionToProcessLike } from './src/main/ts/process/util.ts';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type ConnectionStatus<T> = {
	status: "not-connected"
} | {
	status: "connecting"|"connected",
	target: T
}

class Dashboard {
	#canvas : TOGTUICanvas;
	#needClear : boolean = true;
	#connectionStatus : ConnectionStatus<TargetSpec> = {"status":"not-connected"};
	#attrMap : Map<string,string> = new Map();
	#logMessages : string[] = [];
	#screenSize : {columns:number, rows:number} = {rows: 40, columns: 80};
	
	constructor(out:WritableStreamDefaultWriter) {
		this.#canvas = new TOGTUICanvas(out, this.render.bind(this));
	}
	get canvas() { return this.#canvas; }
	
	set connectionStatus(status:ConnectionStatus<TargetSpec>) {
		// throw new Error(`Setting connection status to ${JSON.stringify(status)}!`);
		this.#connectionStatus = status;
		// this.log(`Connection status updated to ${JSON.stringify(status)}, or ${this._connectionStatusAsString}`);
		this.#canvas.requestRedraw();
	}
	
	enterTui() {
		this.#canvas.enterTui();
	}
	exitTui() {
		this.#canvas.exitTui();
	}
	update(key:string, value:Uint8Array) {
		this.#attrMap.set(key, textDecoder.decode(value));
		this.#canvas.requestRedraw();
	}
	
	#renderCount = 0;
	
	get _connectionStatusAsString() : string {
		if( this.#connectionStatus.status == "not-connected" ) {
			return this.#connectionStatus.status;
		} else {
			return this.#connectionStatus.status + " to " + formatTargetSpec(this.#connectionStatus.target);
		}
	}
	
	async render(out:WritableStreamDefaultWriter) : Promise<void> {
		this.#renderCount++;
		if( this.#needClear ) {
			this.#needClear = false;
			await out.write(textEncoder.encode(ansicodes.CLEAR_SCREEN));
		}
		out.write(textEncoder.encode(ansicodes.moveCursor(0,0)));
		out.write(textEncoder.encode(this.#renderCount + " | " + this._connectionStatusAsString))
		out.write(textEncoder.encode(ansicodes.moveCursor(1,0)));
		for( const [k,v] of this.#attrMap.entries() ) {
			out.write(textEncoder.encode(`${k} : ${v}\n`));
		}
		for( const msg of this.#logMessages ) {
			out.write(textEncoder.encode(msg+"\n"));
		}
		return Promise.resolve();
	}
	log(text:string) {
		this.#logMessages.push(text);
		this.#canvas.requestRedraw();
	}
	set screenSize(size:{rows:number, columns:number}) {
		this.#screenSize = size;
		this.#canvas.requestRedraw();
	}
}

// Why does this stuff get re-invented in each script?
// Different needs, I suppose?
interface ProcessLikeSpawnContext {
	stdin  : DenoStdinLike;
	stdout : DenoStdoutLike;
	stderr : DenoStdoutLike;
}
type DenoStdoutLike = {writable:WritableStream};

interface Spawner<C,T> {
	spawn(ctx:C) : T;
}

type ProcessLikeSpawner = Spawner<ProcessLikeSpawnContext, ProcessLike>;

// Reduce the levels of indentation by a couple
function functionToProcessLikeSpawner(fn:(this:ProcessLike, ctx:ProcessLikeSpawnContext, signal:AbortSignal) => Promise<number>) : ProcessLikeSpawner {
	return {
		spawn: (ctx) => functionToProcessLike(function(abortSignal) { return fn.call(this, ctx, abortSignal); })
	}
}

const dashboardMain = (sourceSpec:TargetSpec) => async (ctx:ProcessLikeSpawnContext, outerAbortSignal:AbortSignal) : Promise<number> => {
	const out = ctx.stdout.writable.getWriter();
	const dashboard = new Dashboard(out);
	
	const abortController = new AbortController();
	const abortSignal = abortController.signal;
	
	outerAbortSignal.addEventListener("abort", () => abortController.abort());
	
	// dashboard.log("Connecting to "+formatTargetSpec(sourceSpec));
	dashboard.connectionStatus = {status: "connecting", target: sourceSpec };
	
	if( sourceSpec.type == "MQTT" ) {
		const mqttClient = new MqttClient({url: new URL(`mqtt://${sourceSpec.targetHostname}:${sourceSpec.targetPort}`)});
		abortSignal.addEventListener("abort", () => {
			dashboard.log("Disconnecting due to abort signal");
			mqttClient.disconnect();
		});
		await mqttClient.connect();
		dashboard.connectionStatus = {status: "connected", target: sourceSpec };
		dashboard.log("Connected to "+formatTargetSpec(sourceSpec)+"!");
		mqttClient.subscribe("#");
		mqttClient.on('publish', evt => {
			dashboard.update(evt.detail.topic, evt.detail.payload);
		});
		mqttClient.on("disconnect", () => {
			dashboard.log("Got disconnect packet, or something from "+formatTargetSpec(sourceSpec)+"!");
		});
		mqttClient.on("closed", () => {
			dashboard.log("Disconnected from "+formatTargetSpec(sourceSpec)+"!");
			dashboard.connectionStatus = {status: "not-connected"};
		});
	} else {
		throw new Error(`Unrecognized source spec: ${JSON.stringify(sourceSpec)}`)
	}

	const input = Deno.stdin.readable;
	// abortSignal.addEventListener("abort", () => { input.cancel(); });

	try {
		Deno.stdin.setRaw(true);
		dashboard.enterTui();
		for await(const evt of inputEvents(input)) {
			dashboard.log(`Read event: ${JSON.stringify(evt)}`);
			if( evt.key == "\x03" || evt.key == "q" ) {
				abortController.abort();
				break;
			} else if( evt.key == "r" ) { // 'r' for redraw
				dashboard.log("'r' hit!");
				dashboard.screenSize = Deno.consoleSize();
			}
		}
	} catch( e ) {
		if( e instanceof Error && e.name == 'BadResource' ) {
			// Presumably from closing the input stream;
			dashboard.log(`Ignoring error: ${e}`)
		} else {
			throw e;
		}
	} finally {
		dashboard.exitTui();
		Deno.stdin.setRaw(false);
	}
	return 0;
}

const makeDashboardSpawner = (sourceSpec:TargetSpec) => functionToProcessLikeSpawner(dashboardMain(sourceSpec));

function makeOutputSpawner(outText:string, errText:string, exitCode:number) : ProcessLikeSpawner {
	const textEncoder = new TextEncoder();
	return {
		spawn: (ctx) => functionToProcessLike(async _abortSignal => {
			if( outText.length > 0 ) {
				await ctx.stdout.writable.getWriter().write(textEncoder.encode(outText));
			}
			if( errText.length > 0 ) {
				await ctx.stderr.writable.getWriter().write(textEncoder.encode(errText));
			}
			return exitCode;
		})
	}
}

const HELP_TEXT =
	"Usage: dashboard --control-root=mqtt://<host>:<port>/[<topic>]\n";

function parseMain(args:string[]) : ProcessLikeSpawner {
	let mqttServer : TargetSpec|undefined;
	for( const arg of args ) {
		let m : RegExpExecArray|null;
		if( (m = /^--control-root=(.*)/.exec(arg)) != null ) {
			if( mqttServer == undefined ) {
				mqttServer = parseTargetSpec(m[1]);
			} else {
				return makeOutputSpawner("", "Too many --control-root specified!", 1);
			}
		} else if( arg == '--help' ) {
			return makeOutputSpawner(HELP_TEXT, "", 0);
		}
	}
	if( mqttServer == undefined ) {
		return makeOutputSpawner("", "No --control-root=... indicated\n", 1);
	}
	return makeDashboardSpawner(mqttServer);
}

if( import.meta.main ) {
	Deno.exit(await parseMain(Deno.args).spawn(Deno).wait());
}

