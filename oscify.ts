/// <reference lib="Deno.window"/>

import { toChunkIterator, toFixedSizeChunks } from "./src/main/ts/streamiter.ts";
import InputEvent, { EVENT_SIZE, decodeInputEvent } from './src/main/ts/InputEvent.ts';

//// First order of business: turn ReadableStreams into async iterators to make them easier to deal with:


//// OSC transport stuff

// Note: Could use a more general-purpose Danducer-based parser system, but meh,
// Consumer<T> is probably good enough for starters.

import OSCMessage from "./src/main/ts/osc/Message.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import { UDPSink } from "./src/main/ts/sink/UDPSink.ts";
import { OSCSink } from "./src/main/ts/sink/OSCSink.ts";
import { MultiSink } from "./src/main/ts/sink/MultiSink.ts";
import { InputEventToOSCSink } from "./src/main/ts/sink/InputEventToOSCSink.ts";
import { uint8ArrayToHex } from "./src/main/ts/uint8ArrayToHex.ts";
import { leftPad } from "./src/main/ts/leftPad.ts";
import { parseTargetSpec } from "./src/main/ts/sink/sinkspec.ts";

export const chanStats = new Map<string,number>();

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

const eventSinks = [];
for( const targetSpec of targetSpecs ) {
	const target = parseTargetSpec(targetSpec);
	if (target.type === "Console") {
		eventSinks.push({
			accept(item: InputEvent) {
				console.log(`input-event type=${item.type} code=${item.code} value=${item.value}`);
			}
		});
	} else if (target.type === "OSC+Console") {
		eventSinks.push(new InputEventToOSCSink({
			accept(item: OSCMessage) {
				console.log(`osc-packet ${uint8ArrayToHex(item.marshal())}`);
			}
		}, target.path, chanStats));
	} else if (target.type === "OSC+UDP") {
		const localHostname = target.localHostname ?? "localhost";
		const localPort = target.localPort ?? Math.random() * 65535 | 0;
		console.log(`Using udp://${target.localHostname ?? "localhost"}:${localPort} as local port`);
		const udpSink = new UDPSink(
			Deno.listenDatagram({ transport: "udp", port: localPort, hostname: localHostname }),
			{
				transport: "udp",
				hostname: target.targetHostname,
				port: target.targetPort
			},
			target.debugging ? {
				accept(text: string) { console.log("udpSink: " + text); }
			} : undefined
		);
		const oscSink = new OSCSink(udpSink);
		eventSinks.push(
			new InputEventToOSCSink(oscSink, target.path, chanStats)
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
