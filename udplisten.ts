// Can I receive my own UDP packets?

function uint8ArrayToHex(data:Uint8Array) : string {
	const hexes = [];
	for( const b of data ) hexes.push(((b >> 4) & 0x0F).toString(16) + (b & 0x0F).toString(16));
	return hexes.join('');
}


const listener = Deno.listenDatagram({
	transport: "udp",
	hostname: "127.0.0.1",
	port: 9901,
});
while( true ) {
	const [data, sourceAddr] = await listener.receive();
	console.log(`Received ${data.length} bytes from ${JSON.stringify(sourceAddr)}: ${uint8ArrayToHex(data)}`);
}
