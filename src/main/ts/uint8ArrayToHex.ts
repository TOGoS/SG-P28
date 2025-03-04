export function uint8ArrayToHex(data: Uint8Array): string {
	const hexes = [];
	for (const b of data) hexes.push(((b >> 4) & 0x0F).toString(16) + (b & 0x0F).toString(16));
	return hexes.join('');
}
