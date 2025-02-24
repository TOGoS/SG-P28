export async function* toChunkIterator(stream : ReadableStreamDefaultReader<Uint8Array>) : AsyncIterable<Uint8Array> {
	while ( true ) {
		const res = await stream.read();
		if( res.done ) return;
		yield res.value;
	}
}

export async function* toFixedSizeChunks(chunkSize : number, chunks : AsyncIterable<Uint8Array>) {
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

export async function* toLines(chunks: Iterable<string>|AsyncIterable<string>): AsyncIterable<string> {
	let buffer = "";
	for await (const chunk of chunks) {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop()!;
		for (const line of lines) {
			yield line;
		}
	}
	if (buffer.length > 0) {
		yield buffer;
	}
}

function join(a:Uint8Array, b:Uint8Array) : Uint8Array {
	if( a.length == 0 ) return b;
	if( b.length == 0 ) return a;
	const c = new Uint8Array(a.length + b.length);
	c.set(a);
	c.set(b, a.length);
	return c;
}

export async function* decodeUtf8(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer : Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	
	for await( const chunk of chunks ) {
		const combined = join(buffer, chunk);
		
		// Find the last byte that starts with 0b0 or 0b10
		let boundary = combined.length;
		while( boundary > 0 && (combined[boundary - 1] & 0b11000000) === 0b10000000 ) {
			boundary--;
		}
		
		// Decode the complete part of the buffer
		const decodedString = decoder.decode(combined.subarray(0, boundary), { stream: true });
		yield decodedString;
		
		// Buffer the incomplete part
		buffer = combined.subarray(boundary);
	}
	
	// If anything remains, it was invalid UTF-8.
	// So this should throw an error.
	if( buffer.length > 0 ) {
		yield decoder.decode(buffer);
	}
}
