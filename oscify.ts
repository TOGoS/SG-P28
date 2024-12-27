//// First order of business: turn ReadableStreams into async iterators to make them easier to deal with:

async function* toChunkIterator(stream : ReadableStreamDefaultReader<Uint8Array>) : AsyncIterable<Uint8Array> {
	while ( true ) {
		const res = await stream.read();
		if( res.done ) return;
		yield res.value;
	}
}

async function* toFixedSizeChunks(chunkSize : number, chunks : AsyncIterable<Uint8Array>) {
	let buffer = new Uint8Array(chunkSize);
	let offset = 0;
	let bytesRead = 0;
	let bytesEmitted = 0;
	const shortcutEnabled = false;
	for await (const inChunk of chunks) {
		bytesRead += inChunk.length;
		if( shortcutEnabled && buffer.length == 0 && inChunk.length == chunkSize ) {
			yield inChunk;
		} else {
			for( let i=0; i<inChunk.length; ) {
				buffer[offset++] = inChunk[i++];
				
				if( offset == chunkSize ) {
					yield buffer;
					bytesEmitted += buffer.length;
					buffer = new Uint8Array(chunkSize);
					offset = 0;
				}
			}
		}
	}
}

interface InputEvent {
	type : number;
	code : number;
	value : number;
}

const EVENT_SIZE = 24;
const EO_TYPE = 16;
const EO_CODE = 18;
const EO_VALUE = 20;

function decodeInputEvent(dataView:DataView, littleEndian:boolean) : InputEvent {
	return {
		type: dataView.getUint16(EO_TYPE, littleEndian),
		code: dataView.getUint16(EO_CODE, littleEndian),
		value: dataView.getInt32(EO_VALUE, littleEndian),
	};
}

const EV_ABS = 3;
const ABS_HAT0X = 16
const ABS_HAT1X = 18
const ABS_HAT0Y = 17
const ABS_HAT1Y = 19

//// OSC transport stuff

// Note: Could use a more general-purpose Danducer-based parser system, but meh,
// Consumer<T> is probably good enough for starters.

import { Message as OSCMessage } from "https://deno.land/x/osc@v0.1.0/mod.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

interface Consumer<T> {
	accept(item:T) : void;
}

class UDPSink implements Consumer<Uint8Array> {
	#conn : Deno.DatagramConn;
	#target : Deno.Addr;
	#debug : Consumer<string>;
	constructor(conn:Deno.DatagramConn, target:Deno.Addr, debug?:Consumer<string>) {
		this.#conn = conn;
		this.#target = target;
		this.#debug = debug || { accept(t) { } };
	}
	accept(data:Uint8Array) {
		this.#debug.accept(`Attempting to send ${data.length} bytes to ${JSON.stringify(this.#target)}: ${uint8ArrayToHex(data)}`);
		this.#conn.send(data, this.#target);
	}
}

class OSCSink implements Consumer<OSCMessage> {
	#sink : Consumer<Uint8Array>;
	constructor(sink : Consumer<Uint8Array>) {
		this.#sink = sink;
	}
	accept(msg:OSCMessage) {
		this.#sink.accept(msg.marshal());
	}
}

class MultiSink<T> implements Consumer<T> {
	#subs : Consumer<T>[];
	constructor(subs : Consumer<T>[] ) {
		this.#subs = subs;
	}
	accept(item: T): void {
		for( const sub of this.#subs ) {
			sub.accept(item);
		}
	}
}

const chanStats = new Map<string,number>();

class InputEventToOSCSink implements Consumer<InputEvent> {
	#oscSink : Consumer<OSCMessage>;
	#path : string;
	constructor(oscSink : Consumer<OSCMessage>, path:string) {
		this.#oscSink = oscSink;
		this.#path = path;
	}
	accept(event: InputEvent): void {
		if( event.type == EV_ABS ) {
			let weightIdx = -1;
			switch( event.code ) {
			case ABS_HAT0X: weightIdx = 0; break;
			case ABS_HAT1X: weightIdx = 1; break;
			case ABS_HAT0Y: weightIdx = 2; break;
			case ABS_HAT1Y: weightIdx = 3; break;
			}
			if( weightIdx >= 0 ) {
				// this.weights[weightIdx] = event.value;
				const destPath = this.#path+"/"+weightIdx;
				chanStats.set(destPath, (chanStats.get(destPath) || 0)+1);
				this.#oscSink.accept(new OSCMessage(destPath).append(event.value));
			}
		}
	}
}

function uint8ArrayToHex(data:Uint8Array) : string {
	const hexes = [];
	for( const b of data ) hexes.push(((b >> 4) & 0x0F).toString(16) + (b & 0x0F).toString(16));
	return hexes.join('');
}

function leftPad(template:string, insertMe:string) {
	const diff = template.length - insertMe.length;
	if( insertMe.length > template.length ) return insertMe.substring(-diff);
	return template.substring(0, diff) + insertMe;
}

Deno.test({
	name: "leftPad with zero-length template",
	fn() { assertEquals("", leftPad("", "anything")); }
});
Deno.test({
	name: "leftPad something reasonable",
	fn() { assertEquals("horsemaster", leftPad("horseHELLO!", "master")); }
});

const paths : string[] = [];
const targetSpecs : string[] = [];
// Data collected on Steam Deck seems little endian.
// Probably the most common and a reasonable default.
let littleEndian = true;
let interMessageDelayMs = 0;
let loopOverInputs = false;
for( const arg of Deno.args ) {
	let m : RegExpExecArray|null;
	if( '--little-endian' == arg ) {
		littleEndian = true;
	} else if( '--big-endian' == arg ) {
		littleEndian = false;
	} else if( '--loop' == arg ) {
		loopOverInputs = true;
	} else if( /^[^-]/.exec(arg) !== null ) {
		paths.push(arg);
	} else if( (m = /--delay=(\d+)ms/.exec(arg)) !== null ) {
		interMessageDelayMs = +m[1];
	} else if( (m = /--target=(.*)/.exec(arg)) !== null ) {
		targetSpecs.push(m[1]);
	} else {
		console.error(`Unrecognized argument: ${arg}`);
		Deno.exit(1);
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

const eventSinks = [];
for( const targetSpec of targetSpecs ) {
	let m : RegExpExecArray|null;
	if( "debug" == targetSpec ) {
		eventSinks.push({
			accept(item:InputEvent) {
				console.log(`input-event type=${item.type} code=${item.code} value=${item.value}`);
			}
		})
	} else if( (m = /^osc\+debug:(?<path>\/.*)$/.exec(targetSpec)) !== null ) {
		const path : string = m.groups!["path"];
		eventSinks.push(new InputEventToOSCSink({
			accept(item:OSCMessage) {
				console.log(`osc-packet ${uint8ArrayToHex(item.marshal())}`)
			}
		}, path));
	} else if( (m = OSCUDP_TARGET_REGEX.exec(targetSpec)) !== null ) {
		// 'bracketedhostname' is to support IPv6 addresses in URIs, like http://[fe80::9908:15:1bb5:39db%18]:1234/some-path
		// Possibly parsing should be stricter.
		const hostname : string = m.groups!["hostname"] || m.groups!["bracketedhostname"];
		const port : number = +m.groups!["port"];
		const path : string = m.groups!["path"];
		// TODO: If localhost not explicitly specified, determine whether this will need to use IPv4 or IPv6
		// and create the listenDatagram using the corresponding localhost address.
		// Otherwise you might get
		// 'Error: An address incompatible with the requested protocol was used. (os error 10047)'
		const localHostname = m.groups!["localhost"] || "localhost";
		const debugging = (m.groups!["debug"] || "off") == "on";
		// TODO: Allow local port to be overridden, pick one at random,
		// nd/or pass the allow reuse flag, if that's a thing
		const udpSink = new UDPSink(
			Deno.listenDatagram({transport: "udp", port: port-1, hostname: localHostname }),
			{
				transport: "udp",
				hostname,
				port
			},
			debugging ? {
				accept(text:string) { console.log("udpSink: "+text); }
			} : undefined
		);
		const oscSink = new OSCSink(udpSink);
		eventSinks.push(
			new InputEventToOSCSink(oscSink, path)
		);
	} else {
		throw new Error(`Unrecognized target spec: '${targetSpec}'`);
	}
}

const eventSink = new MultiSink(eventSinks);


if( paths.length == 0 ) {
	console.warn("No inputs specified");
}
if( eventSinks.length == 0 ) {
	console.warn("No targets specified");
}


const textEncoder = new TextEncoder();

do {
		for( const eventDevPath of paths ) {
		const instream = await Deno.open(eventDevPath, { read: true });
		const inreadable = instream.readable.getReader();
		try {
			let eventCount = 0;
			let byteCount = 0;
			let minValue = Infinity;
			let maxValue = -Infinity;
			for await(const chunk of toFixedSizeChunks(EVENT_SIZE, toChunkIterator(inreadable))) {
				byteCount += chunk.length;
				eventCount += 1;
				const dataView = new DataView(chunk.buffer, 0, chunk.byteLength);
				const event = decodeInputEvent(dataView, littleEndian);
				//console.log(`Event: ${JSON.stringify(event)}`);
				eventSink.accept(event);

				minValue = Math.min(minValue, event.value);
				maxValue = Math.max(maxValue, event.value);

				let statMsg = `Packets sent: ${leftPad("     ",""+eventCount)}; Vmin: ${leftPad("     ",""+minValue)}; Vmax: ${leftPad("     ",""+maxValue)};`;
				for( const [k,count] of chanStats.entries() ) {
					statMsg += ` ${k} (${count})`;
				}
				Deno.stdout.write(textEncoder.encode(`${statMsg}\r`));
				await delay(interMessageDelayMs);
			}
			console.log(`Read ${byteCount} bytes, and ${eventCount} events`);
		} finally {
			inreadable.cancel();
		}
	}
} while( loopOverInputs );
