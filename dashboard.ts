import AABB2D from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/AABB2D.ts';
import * as ansi from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/ansi.ts';
import { BDC_PROP_VALUES } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxcharprops.ts';
import { makeChildLineBorderGenerator } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxdrawcomponents2.ts';
import { AbstractComponentWrapper, AbstractRasterable, BoundedRasterable, FixedRasterable, makeFlex, makeSolidGenerator, PackedRasterable, RegionRasterable, SizedRasterable, SizeFillingRasterableGenerator } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/components2.ts';
import TextRaster2, { Style } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/TextRaster2.ts';
import { drawTextToRaster, textToRaster } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/textraster2utils.ts';
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

const blueBackground  = makeSolidGenerator(" ", ansi.BLUE_BACKGROUND);
const blackBackground = makeSolidGenerator(" ", ansi.BLACK_BACKGROUND);

const toBeLined = makeChildLineBorderGenerator(BDC_PROP_VALUES.LIGHT, ansi.WHITE_TEXT);

const flexySpace = makeSolidGenerator(" ", "");

function mkTextRasterable(spans:{text:string, style:Style}[], background=blackBackground) : AbstractRasterable {
	return makeFlex("right", background, [
		...spans.map(span => {
			const rast = textToRaster(span.text, span.style);
			return {
				component: new FixedRasterable(rast),
				flexGrowAlong: 0,
				flexGrowAcross: 0,
				flexShrinkAlong: 0,
				flexShrinkAcross: 0,
			}
		}),
		{
			// This bit is necessary because there's not yet any way
			// to tell a component to align itself right or left
			// (default is to center everything)
			// the padding ensures that it fills the entire space,
			// so alignment is irrelevant.
			component: flexySpace,
			flexGrowAlong: 1,
			flexGrowAcross: 0,
			flexShrinkAlong: 1,
			flexShrinkAcross: 0,
		}
	], {
		alongBeforeSpace: 1,
		alongAfterSpace: 1,
	}); // Maybe add a padding one at the end
}

function prettyConnectionStatus(status:ConnectionStatus<TargetSpec>) {
	// TODO: left or right-pad 'connected' / 'connecting'
	return status.status == "connected" ? [
		{text:status.status, style:ansi.BRIGHT_GREEN_TEXT},
		{text:" to ",style:ansi.DEFAULT_STYLE},
		{text:formatTargetSpec(status.target),style:ansi.BRIGHT_WHITE_TEXT},
	] :
	status.status == "connecting" ? [
		{text:status.status, style:ansi.BRIGHT_YELLOW_TEXT},
		{text:" to ",style:ansi.DEFAULT_STYLE},
		{text:formatTargetSpec(status.target),style:ansi.BRIGHT_WHITE_TEXT},
	] :
	[
		{text:status.status, style:ansi.BRIGHT_RED_TEXT},
	];
}

const ZERO_BOUNDS : AABB2D<number> = {x0:0, y0:0, x1:0, y1:0};

class AbstractLogRasterable implements AbstractRasterable, PackedRasterable, BoundedRasterable, SizeFillingRasterableGenerator {
	readonly #background : RegionRasterable;
	readonly #logMessages : string[];
	readonly #bounds : AABB2D<number>;
	readonly #textStyle = "";
	constructor(background:RegionRasterable, logMessages:string[], bounds:AABB2D<number>=ZERO_BOUNDS) {
		this.#background = background;
		this.#logMessages = logMessages;
		this.#bounds = bounds;
	}
	get bounds() { return this.#bounds; }
	pack(_maxSize : Vec2D<number>) : PackedRasterable {
		// Always say we can take up like no space;
		// flex rasterables will try to give us another column
		// if our packed size suggests we could use it.
		return this;
		/*
		let maxWidth = 0;
		let height = 0;
		for( const logMessage of this.#logMessages ) {
			maxWidth = Math.max(logMessage.length, maxWidth);
			height++;
		}
		return new AbstractLogRasterable(this.#background, this.#logMessages, {
			x0: 0, y0: -height,
			x1: maxWidth, y1: 0,
		});
		*/
	}
	fillSize(size: Vec2D<number>): BoundedRasterable {
		return new AbstractLogRasterable(this.#background, this.#logMessages, {
			x0: 0, y0: -size.y,
			x1: size.x, y1: 0
		});
	}
	rasterForRegion(region: AABB2D<number>): TextRaster2 {
		let rast = this.#background.rasterForRegion(region);
		for( let y=rast.size.y-1, i=this.#logMessages.length-1; y >= 0 && i >= 0; --y, --i ) {
			rast = drawTextToRaster(rast, {x:0, y}, this.#logMessages[i], this.#textStyle);
		}
		return rast;
	}
}

class Dashboard implements SizedRasterable {
	#ctx : PossiblyTUIAppContext
	#connectionStatus : ConnectionStatus<TargetSpec> = {"status":"not-connected"};
	#attrMap : Map<string,string> = new Map();
	#logMessages : string[] = [];
	
	constructor(ctx:PossiblyTUIAppContext) {
		this.#ctx = ctx;
	}
	
	#viewState : SizedRasterable|undefined;
	
	
	generateViewState() : SizedRasterable {
		const statusBox = mkTextRasterable(prettyConnectionStatus(this.#connectionStatus)); // TODO
		// All this just to pad the sides a little
		const logBox = makeFlex("right", blackBackground, [
			{
				component: new AbstractLogRasterable(blackBackground, this.#logMessages),
				flexGrowAcross: 1,
				flexShrinkAcross: 1,
				flexGrowAlong: 1,
				flexShrinkAlong: 1,
			}
		], {
			alongBeforeSpace: 1,
			alongAfterSpace: 1,
		});
		
		const flex = makeFlex("down", toBeLined, [
			{
				component: statusBox,
				flexGrowAcross: 1,
				flexShrinkAcross: 0,
				flexGrowAlong: 0,
				flexShrinkAlong: 0,
			},
			{
				component: logBox,
				flexGrowAcross: 1,
				flexShrinkAcross: 1,
				flexGrowAlong: 1,
				flexShrinkAlong: 1,
			}
		], {
			alongBeforeSpace: 1,
			alongBetweenSpace: 1,
			alongAfterSpace: 1,
			acrossBeforeSpace: 1,
			acrossBetweenSpace: 1,
			acrossAfterSpace: 1,
		});
		
		/*
		let rast = createUniformRaster(size, "/", "");
		rast = drawTextToRaster(rast, {x:1,y:1}, " "+this._connectionStatusAsString+" ", ansi.BRIGHT_WHITE_TEXT );
		
		for( let y=size.y-2, i=this.#logMessages.length - 1; y >= 3 && i >= 0; --i, --y ) {
			rast = drawTextToRaster(rast, {x:1, y}, " "+this.#logMessages[i]+" ", "");
		}
		*/
		
		return new AbstractComponentWrapper(flex);
	}
	
	get _viewState() : SizedRasterable {
		if( this.#viewState == undefined ) {
			this.#viewState = this.generateViewState();
		}
		return this.#viewState;
	}
	
	rasterForSize(size : Vec2D<number>) : TextRaster2 {
		return this._viewState.rasterForSize(size);
	}
	
	_requestRedraw() {
		this.#viewState = undefined;
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
		if(input.key == "d" ) {
			this._disconnect("Disconnecting because requested by user");
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
	
	async _disconnect(explanation:string) : Promise<void> {
		if( this.#mqttClient ) {
			this.#dashboard.log(explanation);
			await this.#mqttClient.disconnect();
			this.#mqttClient = undefined;
		}
	}
	
	async _connect() : Promise<void> {
		const sourceSpec = this.#sourceSpec;
		
		if( this.#mqttClient ) {
			await this._disconnect("Disconnecting in order to reconnect")
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

