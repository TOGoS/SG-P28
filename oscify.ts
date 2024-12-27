// First order of business: turn ReadableStreams into async iterators to make them easier to deal with:

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

const paths = [];
// Data collected on Steam Deck seems little endian.
// Probably the most common and a reasonable default.
let littleEndian = true;
for( const arg of Deno.args ) {
	if( '--little-endian' == arg ) {
		littleEndian = true;
	} else if( '--big-endian' == arg ) {
		littleEndian = false;
	} else if( /^[^-]/.exec(arg) !== null ) {
		paths.push(arg);
	} else {
		console.error(`Unrecognized argument: ${arg}`);
		Deno.exit(1);
	}
}
if( paths.length == 0 ) {
	console.warn("No inputs specified");
}

for( const eventDevPath of paths ) {
	const instream = await Deno.open(eventDevPath, { read: true });
	const inreadable = instream.readable.getReader();
	try {
		let eventCount = 0;
		let byteCount = 0;
		const weights = [0,0,0,0];
		for await(const chunk of toFixedSizeChunks(EVENT_SIZE, toChunkIterator(inreadable))) {
			byteCount += chunk.length;
			eventCount += 1;
			const dataView = new DataView(chunk.buffer, 0, chunk.byteLength);
			const event = decodeInputEvent(dataView, littleEndian);
			console.log(`Event: ${JSON.stringify(event)}`);
			if( event.type == EV_ABS ) {
				switch( event.code ) {
				case ABS_HAT0X: weights[0] = event.value; break;
				case ABS_HAT1X: weights[1] = event.value; break;
				case ABS_HAT0Y: weights[2] = event.value; break;
				case ABS_HAT1Y: weights[3] = event.value; break;
				}
			}
			console.log(`Weights: ${JSON.stringify(weights)}`);
		}
		console.log(`Read ${byteCount} bytes, and ${eventCount} events`);
	} finally {
		inreadable.cancel();
	}
}
