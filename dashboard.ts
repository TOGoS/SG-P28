import * as ansi from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/ansi.ts';
import { SizedRasterable } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/components2.ts';
import TextRaster2 from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/TextRaster2.ts';
import { createUniformRaster, drawTextToRaster } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/textraster2utils.ts';
import Vec2D from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/Vec2D.ts';
import { vec2dsAreEqual } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/vecutils.ts';
import { DenoStdinLike, PossiblyTUIAppContext, PossiblyTUIAppSpawner, runTuiApp, TUIAppRunnerContext, Waitable } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts';
import WatchableVariable, { makeReadonlyWatchable } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/WatchableVariable.ts';
import { MqttClient } from "jsr:@ymjacky/mqtt5@0.0.19";
import KeyEvent from '../Scratch38-S0015/src/lib/ts/terminput/KeyEvent.ts';
import { AbstractAppInstance } from '../Scratch38-S0015/src/lib/ts/tuiappframework3.ts';
import ProcessLike from './src/main/ts/process/ProcessLike.ts';
import { functionToProcessLike } from './src/main/ts/process/util.ts';
import { formatTargetSpec, parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type ConnectionStatus<T> = {
	status: "not-connected"
} | {
	status: "connecting"|"connected",
	target: T
}

class Dashboard implements SizedRasterable {
	#ctx : PossiblyTUIAppContext
	#needClear : boolean = true;
	#connectionStatus : ConnectionStatus<TargetSpec> = {"status":"not-connected"};
	#attrMap : Map<string,string> = new Map();
	#logMessages : string[] = [];
	#screenSize : {columns:number, rows:number} = {rows: 40, columns: 80};
	
	constructor(ctx:PossiblyTUIAppContext) {
		this.#ctx = ctx;
	}
	
	rasterForSize(size : Vec2D<number>) : TextRaster2 {
		let rast = createUniformRaster(size, "/", "");
		rast = drawTextToRaster(rast, {x:1,y:1}, " "+this._connectionStatusAsString+" ", ansi.BRIGHT_WHITE_TEXT );
		
		for( let y=size.y-2, i=this.#logMessages.length - 1; y >= 3 && i >= 0; --i, --y ) {
			rast = drawTextToRaster(rast, {x:1, y}, " "+this.#logMessages[i]+" ", "");
		}
		
		return rast;
	}
	
	_requestRedraw() {
		this.#ctx.setScene(this);
	}
	
	set connectionStatus(status:ConnectionStatus<TargetSpec>) {
		// throw new Error(`Setting connection status to ${JSON.stringify(status)}!`);
		this.#connectionStatus = status;
		this._requestRedraw();
	}
	
	update(key:string, value:Uint8Array) {
		this.#attrMap.set(key, textDecoder.decode(value));
		this._requestRedraw();
	}
	
	#renderCount = 0;
	
	get _connectionStatusAsString() : string {
		if( this.#connectionStatus.status == "not-connected" ) {
			return this.#connectionStatus.status;
		} else {
			return this.#connectionStatus.status + " to " + formatTargetSpec(this.#connectionStatus.target);
		}
	}
	
	log(text:string) {
		this.#logMessages.push(text);
		this._requestRedraw();
	}
	set screenSize(size:{rows:number, columns:number}) {
		this.#screenSize = size;
		this._requestRedraw();
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

class DashboardAppInstance extends AbstractAppInstance<KeyEvent,number> {
	#abortController = new AbortController();
	#sourceSpec : TargetSpec;
	#dashboard : Dashboard;
	#mqttClient : MqttClient|undefined;

	constructor(sourceSpec:TargetSpec, ctx:PossiblyTUIAppContext) {
		super(ctx);
		this.#sourceSpec = sourceSpec;
		this.#dashboard = new Dashboard(ctx);
		this.#dashboard.connectionStatus = {status: "connecting", target: sourceSpec };
		this._connect();
	}
	
	_requestCleanExit(result:number) {
		this.#abortController.abort("Clean exit("+result+")");
		this._resolve(result);
	}
	// deno-lint-ignore no-explicit-any
	_abort(reason:any) {
		this._reject(reason);
	}
	
	override handleInput(input:KeyEvent) {
		this.#dashboard.log(`Key hit: ${JSON.stringify(input)}`);
		if( input.key == "q" ) {
			this._requestCleanExit(0);
		}
		if(input.key == "c" && input.ctrlKey) {
			this._abort(new Error("Aborted by user"));
		}
	}
	
	override _cleanup() {
		if( this.#mqttClient ) {
			this.#dashboard.log("Disconnecting for _cleanup");
			this.#mqttClient.disconnect();
		}
		return super._cleanup();
	}
	
	async _connect() : Promise<void> {
		const sourceSpec = this.#sourceSpec;
		
		if( this.#mqttClient ) {
			this.#dashboard.log("Disconnecting for new connection");
			this.#mqttClient.disconnect();
		}
		
		if( sourceSpec.type == "MQTT" ) {
			this.#mqttClient = new MqttClient({url: new URL(`mqtt://${sourceSpec.targetHostname}:${sourceSpec.targetPort}`)});
			await this.#mqttClient.connect();
			this.#dashboard.connectionStatus = {status: "connected", target: sourceSpec };
			this.#dashboard.log("Connected to "+formatTargetSpec(sourceSpec)+"!");
			this.#mqttClient.subscribe("#");
			this.#mqttClient.on('publish', evt => {
				this.#dashboard.update(evt.detail.topic, evt.detail.payload);
			});
			this.#mqttClient.on("disconnect", () => {
				this.#dashboard.log("Got disconnect packet, or something from "+formatTargetSpec(sourceSpec)+"!");
			});
			this.#mqttClient.on("closed", () => {
				this.#dashboard.log("Disconnected from "+formatTargetSpec(sourceSpec)+"!");
				this.#dashboard.connectionStatus = {status: "not-connected"};
			});
		} else {
			throw new Error(`Unrecognized source spec: ${JSON.stringify(sourceSpec)}`)
		}
	}
}

function dashboardAppSpawner(sourceSpec:TargetSpec) : PossiblyTUIAppSpawner<PossiblyTUIAppContext, Waitable<number>, KeyEvent> {
	return {
		inputMode: "push-key-events",
		spawn: ctx => new DashboardAppInstance(sourceSpec, ctx),
	};
}

function makeDenoScreenSizeVariable(deno:typeof Deno, initalValue:Vec2D<number>, refreshInterval:number) : WatchableVariable<Vec2D<number>> {
	return makeReadonlyWatchable(
		initalValue,
		(abortSignal, setter) => {
			const refreshScreenSize = () => {
				const cs = deno.consoleSize();
				const vec = {x:cs.columns, y:cs.rows};
				setter(vec);
			}
			
			let signalListenerAdded : boolean = false;
			let interval : number|undefined = undefined;
			
			refreshScreenSize();
			
			try {
				deno.addSignalListener("SIGWINCH", refreshScreenSize);
				signalListenerAdded = true;
			} catch( _e ) {
				interval = setInterval(refreshScreenSize, refreshInterval);
			}
			
			abortSignal.addEventListener("abort", () => {
				if(signalListenerAdded) deno.removeSignalListener("SIGWINCH", refreshScreenSize);
				if(interval) clearInterval(interval);
			});
		},
		vec2dsAreEqual
	);
}

function denoTuiAppContext(ctx:ProcessLikeSpawnContext, deno:typeof Deno) : TUIAppRunnerContext {
	return {
		stdin : ctx.stdin,
		stdout: ctx.stdout.writable.getWriter(),
		outputMode: "screen",
		screenSizeVar: makeDenoScreenSizeVariable(deno, {x: 40, y: 20}, 1000),
		registerCleanup: (cb : ()=>void) => {
			deno.addSignalListener("SIGINT", cb);
		},
		unregisterCleanup: (cb : ()=>void) => {
			deno.removeSignalListener("SIGINT", cb);
		},
	};
}

const makeTuiAppSpawner = (app:PossiblyTUIAppSpawner<PossiblyTUIAppContext,Waitable<number>,KeyEvent>) : ProcessLikeSpawner => {
	// Wrapper because I haven't yet bothered to
	// rewrite this whole thing in TUIFramework3 terms
	return functionToProcessLikeSpawner((ctx, abortSignal) => {
		// TODO: I guess runTuiApp should take an abortSignal
		return runTuiApp(app, denoTuiAppContext(ctx, Deno));
	});
}

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
	return makeTuiAppSpawner(dashboardAppSpawner(mqttServer));
}

if( import.meta.main ) {
	Deno.exit(await parseMain(Deno.args).spawn(Deno).wait());
}

