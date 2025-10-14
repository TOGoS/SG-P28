import AABB2D from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/AABB2D.ts';
import * as ansi from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/ansi.ts';
import { BDC_PROP_VALUES } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxcharprops.ts';
import { makeChildLineBorderGenerator } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxdrawcomponents2.ts';
import { AbstractComponentWrapper, AbstractRasterable, BoundedRasterable, FixedRasterable, FlexOptions, makeFlex, makeSolidGenerator, PackedRasterable, RegionRasterable, SizedRasterable, SizeFillingRasterableGenerator } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/components2.ts';
import TextRaster2, { Style } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/TextRaster2.ts';
import { drawTextToRaster, textToRaster } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/textraster2utils.ts';
import Vec2D from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/Vec2D.ts';
import { vec2dsAreEqual } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/vecutils.ts';
import { DenoStdinLike, PossiblyTUIAppContext, PossiblyTUIAppSpawner, runTuiApp, TUIAppRunnerContext, Waitable } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts';
import WatchableVariable, { makeReadonlyWatchable } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/WatchableVariable.ts';
import { MqttClient } from "jsr:@ymjacky/mqtt5@0.0.19";
import KeyEvent from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/terminput/KeyEvent.ts';
import { AbstractAppInstance } from 'https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts';
import ProcessLike from './src/main/ts/process/ProcessLike.ts';
import { functionToProcessLike } from './src/main/ts/process/util.ts';
import { formatTargetSpec, parseTargetSpec, TargetSpec } from "./src/main/ts/sink/sinkspec.ts";
import { leftPad } from './src/main/ts/leftPad.ts';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function attemptTextDecode(possibleText:Uint8Array) : string|undefined {
	try {
		return textDecoder.decode(possibleText);
	} catch {
		return undefined;
	}
}


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

const S_PAD = Symbol("pad");

function mkTextRasterable(
	spans:({text:string, style:Style}|typeof S_PAD)[],
	background=blackBackground,
	flexOpts : Omit<FlexOptions, "alongDirection"> = {
		alongBeforeSpace: 1,
		alongAfterSpace: 1,
	}
) : AbstractRasterable {
	return makeFlex("right", background, [
		...spans.map(span =>
			span == S_PAD ? {
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
			} : {
				component: new FixedRasterable(textToRaster(span.text, span.style)),
				flexGrowAlong: 0,
				flexGrowAcross: 0,
				flexShrinkAlong: 0,
				flexShrinkAcross: 0,
			}
		)
	], flexOpts);
}

function mkRightPaddedTextRasterable(spans:{text:string, style:Style}[], background=blackBackground,
	flexOpts : Omit<FlexOptions, "alongDirection"> = {
		alongBeforeSpace: 1,
		alongAfterSpace: 1,
	}
) : AbstractRasterable {
	return mkTextRasterable([...spans, S_PAD], background, flexOpts);
}

function prettyConnectionStatus(status:ConnectionStatus<TargetSpec>) : StyledTextFragment[] {
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

function prettyClockTime(millis:TimestampMilliseconds|undefined) : StyledTextFragment[] {
	if( millis == undefined ) return [{text:"clock not set", style:ansi.MAGENTA_TEXT}];
	
	const date = new Date(millis);
	return [
		{
			text: `${date.getFullYear()}-${leftPad("00", String(date.getMonth() + 1))}-${leftPad("00", String(date.getDate()))} ${leftPad("00", String(date.getHours()))}:${leftPad("00", String(date.getMinutes()))}:${leftPad("00", String(date.getSeconds()))}`,
			style: ansi.BRIGHT_BLACK_TEXT
		}
	];
}

function prettyDurationHms(millis:TimestampMilliseconds) : string {
	const totalSeconds = Math.floor(millis / 1000);
	const hours        = Math.floor(totalSeconds / 3600);
	const minutes      = Math.floor((totalSeconds % 3600) / 60);
	//const seconds      = (totalSeconds % 60) + (Math.floor(millis) % 1000) / 1000;
	const seconds      = totalSeconds % 60;
	
	let result = "";
	if (hours > 0) result += `${hours}h`;
	if (minutes > 0 || hours > 0) result += `${minutes}m`;
	//result += `${seconds.toFixed(2)}s`;
	result += `${seconds}s`;
	return result;
}

function prettyRoughDuration(millis:TimestampMilliseconds) : StyledTextFragment {
	if( millis < 1000 ) {
		// Includes negative values, lmao
		return {text: "0s", style:ansi.GREEN_TEXT};
	}
	const seconds = Math.round(millis/1000);
	if( seconds < 10 ) {
		return {text: seconds+"s", style:ansi.GREEN_TEXT};
	}
	if( seconds < 60 ) {
		return {text: seconds+"s", style:ansi.YELLOW_TEXT};
	}
	const minutes = Math.round(seconds/60);
	if( minutes < 5 ) {
		return {text: minutes+"m", style:ansi.WHITE_TEXT}; // 'gray'
	}
	if( minutes < 60 ) {
		return {text: minutes+"m", style:ansi.BRIGHT_BLACK_TEXT};
	}
	const hours = Math.round(minutes/60);
	return {text: hours+"h", style:ansi.BRIGHT_BLACK_TEXT};
}

function padSides(component : AbstractRasterable) {
	return makeFlex("right", blackBackground, [
		{
			component: component,
			flexGrowAcross: 1,
			flexShrinkAcross: 1,
			flexGrowAlong: 1,
			flexShrinkAlong: 1,
		}
	], {
		alongBeforeSpace: 1,
		alongAfterSpace: 1,
	});
}

const ZERO_BOUNDS : AABB2D<number> = {x0:0, y0:0, x1:0, y1:0};

interface StyledTextFragment {
	text: string;
	style: Style;
}

class AbstractTextRasterable implements AbstractRasterable, PackedRasterable, BoundedRasterable, SizeFillingRasterableGenerator {
	readonly #background : RegionRasterable;
	readonly textLines : StyledTextFragment[][];
	readonly #bounds : AABB2D<number>;
	constructor(background:RegionRasterable, logMessages:StyledTextFragment[][], bounds:AABB2D<number>=ZERO_BOUNDS) {
		this.#background = background;
		this.textLines = logMessages;
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
		return new AbstractTextRasterable(this.#background, this.textLines, {
			x0: 0, y0: -size.y,
			x1: size.x, y1: 0
		});
	}
	rasterForRegion(region: AABB2D<number>): TextRaster2 {
		let rast = this.#background.rasterForRegion(region);
		// HMM: Maybe the thing to do is just create the raster ourselves here,
		// using toChars to get the length of bits of text actually right
		for( let y=rast.size.y-1, i=this.textLines.length-1; y >= 0 && i >= 0; --y, --i ) {
			let x = 0;
			for( const frag of this.textLines[i] ) {
				rast = drawTextToRaster(rast, {x, y}, frag.text, frag.style);
				x += frag.text.length; // OOPS: should be length in glyphs!
			}
		}
		return rast;
	}
}

interface MessageInfo<V> {
	received: number;
	key  : string;
	value: V
}

interface MQTTMessage extends MessageInfo<Uint8Array> {
	valueText: string|undefined;
	retained: boolean;
}

// Sometimes-immutable MessageTree structure

type MutableMessageTree<M> = {
	isFrozen?: false;
	messages: M[];
	children: Map<string, MessageTree<M>|MutableMessageTree<M>>;
};
type MessageTree<M> = Readonly<{
	readonly isFrozen?: true;
	readonly	messages: ReadonlyArray<M>;
	readonly children: ReadonlyMap<string, MessageTree<M>>;
}>;

function messageTreeIsFrozen<M>(tree:MessageTree<M>|MutableMessageTree<M>) : tree is MessageTree<M> {
	return Object.isFrozen(tree);
}

function freezeMessageTree<M>(tree: MessageTree<M>|MutableMessageTree<M>): MessageTree<M> {
	if(messageTreeIsFrozen(tree)) return tree;
	
	Object.freeze(tree.messages);
	for( const [_k,child] of tree.children ) freezeMessageTree(child);
	Object.freeze(tree.children);
	return Object.freeze(tree) as MessageTree<M>;
}

function unfreezeMessageTree<M>(tree: MessageTree<M>): MutableMessageTree<M> {
	if(!Object.isFrozen(tree)) return tree as MutableMessageTree<M>;
	
	return {messages:[...tree.messages], children:new Map<string, MessageTree<M>>(tree.children)};
}

// deno-lint-ignore no-explicit-any
const EMPTY_MESSAGE_TREE : MessageTree<any> = freezeMessageTree({messages:[], children:new Map()});

function _updateMessageTree<M>(
	tree: MessageTree<M>|MutableMessageTree<M>,
	parts: string[],
	message: M,
	historySize: number
): MutableMessageTree<M> {
	if(messageTreeIsFrozen(tree)) tree = unfreezeMessageTree(tree);
	
	if (parts.length === 0) {
		const newMessages : M[] = [...tree.messages, message].slice(-historySize);
		return {messages:newMessages, children:tree.children};
	} else {
		const [head, ...tail] = parts;
		tree.children.set(head,
			_updateMessageTree(
				tree.children.get(head) ?? {messages:[], children:new Map},
				tail, message, historySize
			)
		);
		return tree;
	}
}

/** Return a new tree with the message inserted at the correct node */
function updateMessageTree<M>(
	tree: MessageTree<M>|MutableMessageTree<M>,
	key: string,
	message: M,
	historySize: number
): MutableMessageTree<M> {
	const parts = key.split('/').filter(Boolean);
	return _updateMessageTree(tree, parts, message, historySize);
}

function walkMessageTree<M>(path:string[], tree:MessageTree<M>|MutableMessageTree<M>, callback:(path:string[], node:MessageTree<M>|MutableMessageTree<M>)=>unknown) {
	callback(path, tree);
	for( const [k,child] of tree.children ) {
		walkMessageTree([...path, k], child, callback);
	}
}

//// End MessageTree stuff

const S_UNINITIALIZED    = Symbol.for("uninitialized");
const S_REDRAW_REQUESTED = Symbol.for("redraw-requested");

type TimestampMilliseconds = number & { unit?:"epoch-milliseconds" };

function styleMessageValue(message:MQTTMessage, currentTime:TimestampMilliseconds|undefined) : StyledTextFragment[] {
	// Hmm: Could also take age of message into account, etc
	const age = currentTime == undefined ? undefined : currentTime - message.received;
	const text = message.valueText;
	const flagBits : StyledTextFragment[] = [];
	if( message.retained ) flagBits.push({text:"R", style:ansi.BRIGHT_WHITE_TEXT});
	if( age ) {
		flagBits.push(prettyRoughDuration(Math.floor(age)));
	}
	
	const textBits : StyledTextFragment[] =
		text == "online" || text == "connected" ?
			[{ text, style: ansi.BRIGHT_GREEN_TEXT }] :
		text == "connecting" || text == "trusted" || text == "paired" ?
			[{ text, style: ansi.BRIGHT_YELLOW_TEXT }] :
		text == "offline" || text == "disconnected" ?
			[{ text, style: ansi.BRIGHT_RED_TEXT }] :
		text == undefined ?
			[{ text: `(${message.value.length} bytes)`, style: ansi.MAGENTA_TEXT }] :
		/*otherwise*/
			[{ text, style: "" }];
			
	const metaBits = [];
	if( flagBits.length > 0 ) {
		metaBits.push({text:"[", style:ansi.YELLOW_TEXT});
		let sepBit = undefined;
		for( const bit of flagBits ) {
			if( sepBit ) metaBits.push(sepBit);
			metaBits.push(bit);
			sepBit = {text:",", style:ansi.YELLOW_TEXT};
		}
		metaBits.push({text:"] ", style:ansi.YELLOW_TEXT});
	}
	
	return [
		...metaBits,
		...textBits,
	]
}
	
class Dashboard implements SizedRasterable {
	#ctx : PossiblyTUIAppContext
	#connectionStatus : ConnectionStatus<TargetSpec> = {"status":"not-connected"};
	// Map of all current MQTT values
	#messageTree : MessageTree<MQTTMessage>|MutableMessageTree<MQTTMessage> = EMPTY_MESSAGE_TREE;
	#logMessages : string[] = [];
	#startTime : TimestampMilliseconds|undefined;
	#clockTime : TimestampMilliseconds|undefined;
	
	constructor(ctx:PossiblyTUIAppContext) {
		this.#ctx = ctx;
	}
	
	#viewState : SizedRasterable|typeof S_UNINITIALIZED|typeof S_REDRAW_REQUESTED = S_UNINITIALIZED;
	
	generateViewState() : SizedRasterable {
		const statusBox = mkTextRasterable([
			...prettyConnectionStatus(this.#connectionStatus),
			S_PAD,
			...prettyClockTime(this.#clockTime),
			...(this.#startTime && this.#clockTime ? [
				{text:` (up ${prettyDurationHms(this.#clockTime - this.#startTime)})`, style:""}
			] : [])
		]);
		const logBox = padSides(new AbstractTextRasterable(blackBackground, this.#logMessages.map(text => [{text,style:""}])));
		
		// TODO: LogRasterable should accept spans so it can be pretty
		// TODO: Pad the keys maybe?
		const statusLines : StyledTextFragment[][] = [];
		
		const maxShownMessageCount = 3;
		
		walkMessageTree([], this.#messageTree, (path,node) => {
			if( path.length == 0 ) return; // Hopefully no messages here lamo
			const keyStyle = "";
			const prefix = "  ".repeat(path.length-1)+path[path.length-1];
			if( node.messages.length == 0 ) {
				statusLines.push([{text:prefix, style:keyStyle}]);
			} else if( node.messages.length == 1 ) {
				statusLines.push([{text:prefix+": ",style:keyStyle}, ...styleMessageValue(node.messages[0], this.#clockTime)]);
			} else {
				statusLines.push([{text:prefix+":", style:keyStyle}]);
				
				const messagePrefix = "  ".repeat(path.length) + "- ";
				for( let i=Math.max(0, node.messages.length-maxShownMessageCount); i<node.messages.length; ++i ) {
					statusLines.push([{text:messagePrefix,style:keyStyle}, ...styleMessageValue(node.messages[i], this.#clockTime)]);
				}
			}
		});
		
		const attrBox = padSides(new AbstractTextRasterable(blackBackground, statusLines, {
			x0: 0, y0: 0,
			x1: 0, y1: statusLines.length,
		}));
		
		const flex = makeFlex("down", toBeLined, [
			{
				component: statusBox,
				flexGrowAcross: 1,
				flexShrinkAcross: 0,
				flexGrowAlong: 0,
				flexShrinkAlong: 0,
			},
			{
				component: attrBox,
				flexGrowAcross: 1,
				flexShrinkAcross: 0,
				flexGrowAlong: 1,
				flexShrinkAlong: 1,
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
		if( this.#viewState == S_UNINITIALIZED || this.#viewState == S_REDRAW_REQUESTED ) {
			this.#viewState = this.generateViewState();
		}
		return this.#viewState;
	}
	
	#lastRedrawTime : number|undefined;
	
	rasterForSize(size : Vec2D<number>) : TextRaster2 {
		this.#lastRedrawTime = Date.now();
		return this._viewState.rasterForSize(size);
	}
	
	_requestRedraw() {
		// It will become something else once the redraw has started.
		// Until then, we don't need to keep poking #ctx about it.
		//
		// Ackshually, I think TUIRenderStateManager, which does its own debouncing,
		// has a bug where redraw requests will occasionally be lost;
		// therefore we'll keep poking it, after all:
		// 
		// if( this.#viewState == S_REDRAW_REQUESTED ) return;
		this.#viewState = S_REDRAW_REQUESTED;
		this.#ctx.setScene(this);
	}
	
	set connectionStatus(status:ConnectionStatus<TargetSpec>) {
		// throw new Error(`Setting connection status to ${JSON.stringify(status)}!`);
		this.#connectionStatus = status;
		this._requestRedraw();
	}
	
	set startTime(millis:TimestampMilliseconds) {
		this.#startTime = millis;
		this._requestRedraw();
	}
	set clockTime(millis:TimestampMilliseconds) {
		if( this.#lastRedrawTime && millis - this.#lastRedrawTime > 2000 ) {
			console.error(`Too long since last redraw! viestate = ${String(this.#viewState)}`);
			Deno.exit(1);
		}
		
		this.#clockTime = millis;
		this._requestRedraw();
	}
	
	update(message:MQTTMessage) {
		if( message.key.length == 0 ) return;
		
		this.log(`${message.key} = ${message.valueText ?? '(undecodable)'}`);
		
		this.#messageTree = updateMessageTree(this.#messageTree, message.key, message, message.key.endsWith('chat') ? 20 : 1);
		
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
	#clockTimer : number|undefined;

	constructor(sourceSpec:TargetSpec, ctx:PossiblyTUIAppContext) {
		super(ctx);
		this.#sourceSpec = sourceSpec;
		this.#dashboard = new Dashboard(ctx);
		this.#dashboard.startTime = Date.now();
		this.#dashboard.connectionStatus = {status: "connecting", target: sourceSpec };
		this._connect();
		this.#clockTimer = setInterval(() => {
			this.#dashboard.clockTime = Date.now()
		}, 1000);
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
		if( input.key == "r" ) {
			this._requestCleanExit(69);
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
		if( this.#clockTimer ) {
			clearInterval(this.#clockTimer);
			this.#clockTimer = undefined;
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
			this.#mqttClient = new MqttClient({url: new URL(`mqtt://${sourceSpec.targetHostname}:${sourceSpec.targetPort ?? 1883}`)});
			await this.#mqttClient.connect();
			this.#dashboard.connectionStatus = {status: "connected", target: sourceSpec };
			this.#dashboard.log("Connected to "+formatTargetSpec(sourceSpec)+"!");
			const subPrefix = sourceSpec.topic.endsWith('/') || sourceSpec.topic == '' ? sourceSpec.topic : sourceSpec.topic + '/';
			const subPat = `${subPrefix}#`;
			this.#dashboard.log(`Subscribing to ${subPat}`);
			this.#mqttClient.subscribe(subPat);
			this.#mqttClient.on('publish', evt => {
				const messageInfo : MQTTMessage = {
					received: Date.now(),
					key: evt.detail.topic,
					value: evt.detail.payload,
					valueText: attemptTextDecode(evt.detail.payload),
					retained: evt.detail.retain,
				};
				this.#dashboard.update(messageInfo);
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
	"Usage: dashboard --system-root=mqtt://<host>:<port>/[<topic>]\n";

function parseMain(args:string[]) : ProcessLikeSpawner {
	let mqttServer : TargetSpec|undefined;
	for( const arg of args ) {
		let m : RegExpExecArray|null;
		if( (m = /^--system-root=(.*)/.exec(arg)) != null ) {
			if( mqttServer == undefined ) {
				mqttServer = parseTargetSpec(m[1]);
			} else {
				return makeOutputSpawner("", "Too many --system-root specified!\n", 1);
			}
		} else if( arg == '--help' ) {
			return makeOutputSpawner(HELP_TEXT, "", 0);
		} else {
			return makeOutputSpawner("",`Unrecognized argument: ${arg}\n`,1);
		}
	}
	if( mqttServer == undefined ) {
		return makeOutputSpawner("", "No --system-root=... indicated\n", 1);
	}
	return makeTuiAppSpawner(dashboardAppSpawner(mqttServer));
}

if( import.meta.main ) {
	Deno.exit(await parseMain(Deno.args).spawn(Deno).wait());
}

