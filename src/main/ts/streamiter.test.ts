import { toChunkIterator, toFixedSizeChunks, toLines, decodeUtf8 } from './streamiter.ts';
import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.165.0/testing/asserts.ts";

async function* asyncGenerator<T>(items: T[]): AsyncIterable<T> {
	for (const item of items) {
		yield item;
	}
}

Deno.test('toChunkIterator', async () => {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2, 3]));
			controller.enqueue(new Uint8Array([4, 5, 6]));
			controller.close();
		}
	}).getReader();

	const chunks = [];
	for await (const chunk of toChunkIterator(stream)) {
		chunks.push(chunk);
	}

	assertEquals(chunks, [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]);
});

Deno.test('toFixedSizeChunks', async () => {
	const chunks = asyncGenerator([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])]);
	const fixedSizeChunks = [];
	for await (const chunk of toFixedSizeChunks(3, chunks)) {
		fixedSizeChunks.push(chunk);
	}

	assertEquals(fixedSizeChunks, [
		new Uint8Array([1, 2, 3]),
		new Uint8Array([4, 5, 6]),
		new Uint8Array([7, 8, 9])
	]);
});

Deno.test('toLines', async () => {
	const chunks = asyncGenerator([new Uint8Array([97, 98, 99, 10, 100, 101, 102, 10, 103, 104, 105])]);
	const lines = [];
	for await (const line of toLines(chunks)) {
		lines.push(line);
	}

	assertEquals(lines, ['abc', 'def', 'ghi']);
});

Deno.test('toUtf8Strings', async () => {
	const chunks = asyncGenerator([
		new Uint8Array([0xE2, 0x82, 0xAC]), // €
		new Uint8Array([0xC2, 0xA2]), // ¢
		new Uint8Array([0xF0, 0x9F, 0x92, 0xA9]) // 💩
	]);

	const utf8Strings = [];
	for await (const str of decodeUtf8(chunks)) {
		utf8Strings.push(str);
	}
	
	assertEquals('€¢💩', utf8Strings.join(''));
});

Deno.test('toUtf8Strings with multi-byte sequences spanning chunks', async () => {
	const chunks = asyncGenerator([
		new Uint8Array([0xE2, 0x82]), // partial €
		new Uint8Array([0xAC, 0xC2]), // complete € and partial ¢
		new Uint8Array([0xA2, 0xF0, 0x9F]), // complete ¢ and partial 💩
		new Uint8Array([0x92, 0xA9]) // complete 💩
	]);

	const utf8Strings = [];
	for await (const str of decodeUtf8(chunks)) {
		utf8Strings.push(str);
	}

	assertEquals('€¢💩', utf8Strings.join(''));
});

Deno.test('toUtf8Strings with incomplete multi-byte sequence', async () => {
	const chunks = asyncGenerator([
		new Uint8Array([0xE2, 0x82]), // partial €
		new Uint8Array([0xAC, 0xC2]), // complete € and partial ¢
		new Uint8Array([0xA2, 0xF0, 0x9F]), // complete ¢ and partial 💩
		new Uint8Array([0x92]) // incomplete 💩
	]);
	
	assertRejects(async () => {
		const utf8Strings = [];
		for await (const str of decodeUtf8(chunks)) {
			utf8Strings.push(str);
		}
	});
});
