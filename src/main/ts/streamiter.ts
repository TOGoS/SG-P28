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
