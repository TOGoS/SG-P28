import { Token, toTokens, toCommands } from './CommandTokenizer.ts';
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

async function collect<T>(iter:Iterable<T>|AsyncIterable<T>) : Promise<T[]> {
	const arr = [];
	for await( const item of iter ) arr.push(item);
	return arr;
}

async function* asyncGenerator<T>(items: T[]): AsyncIterable<T> {
	for (const item of items) {
		yield item;
	}
}

Deno.test('toTokens with simple input', async () => {
	const text = asyncGenerator(['hello world']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]);
});

Deno.test('toTokens with quoted strings', async () => {
	const text = asyncGenerator(['"hello world"']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "quoted-string", value: 'hello world' }
	]);
});

Deno.test('toTokens with mixed input', async () => {
	const text = asyncGenerator(['hello "world" # cement']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'world' },
		{ type: "whitespace" },
		{ type: "comment", value: "cement" }
	]);
});

Deno.test('toTokens with multi-chunk input', async () => {
	const text = asyncGenerator(['hello ', '"world', '" # com', 'ment']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'world' },
		{ type: "whitespace" },
		{ type: "comment", value: "comment" }
	]);
});

/*
Deno.test('toTokens with incomplete token at end', async () => {
	const text = asyncGenerator(['hello "world']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'world' }
	]);
});
*/

Deno.test('toTokens with newline tokens', async () => {
	const text = asyncGenerator(['hello\nworld\n']);
	const tokens = await collect(toTokens(text));
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "newline" },
		{ type: "bareword", value: "world" },
		{ type: "newline" }
	]);
});

Deno.test('toCommands with simple input', async () => {
	const tokens = asyncGenerator<Token>([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" },
		{ type: "newline" }
	]);
	const commands = await collect(toCommands(tokens));
	
	assertEquals(commands, [[
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]]);
});

Deno.test('toCommands with multiple commands', async () => {
	const tokens = asyncGenerator<Token>([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" },
		{ type: "newline" },
		{ type: "bareword", value: "foo" },
		{ type: "whitespace" },
		{ type: "bareword", value: "bar" },
		{ type: "newline" }
	]);
	const commands = await collect(toCommands(tokens));
	
	assertEquals(commands, [
		[
			{ type: "bareword", value: "hello" },
			{ type: "whitespace" },
			{ type: "bareword", value: "world" }
		],
		[
			{ type: "bareword", value: "foo" },
			{ type: "whitespace" },
			{ type: "bareword", value: "bar" }
		]
	]);
});

Deno.test('toCommands with comments and empty lines', async () => {
	const tokens = asyncGenerator<Token>([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" },
		{ type: "newline" },
		{ type: "comment", value: "comment" },
		{ type: "newline" },
		{ type: "bareword", value: "foo" },
		{ type: "whitespace" },
		{ type: "bareword", value: "bar" },
		{ type: "newline" }
	]);
	const commands = await collect(toCommands(tokens));
	
	assertEquals(commands, [
		[
			{ type: "bareword", value: "hello" },
			{ type: "whitespace" },
			{ type: "bareword", value: "world" }
		],
		[
			{ type: "bareword", value: "foo" },
			{ type: "whitespace" },
			{ type: "bareword", value: "bar" }
		]
	]);
});

Deno.test('toCommands with incomplete command at end', async () => {
	const tokens = asyncGenerator<Token>([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]);
	const commands = await collect(toCommands(tokens));
	
	assertEquals(commands, [[
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]]);
});

Deno.test('toCommands with mixed input', async () => {
	const tokens = asyncGenerator<Token>([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'world' },
		{ type: "whitespace" },
		{ type: "comment", value: "comment" },
		{ type: "newline" },
		{ type: "bareword", value: "foo" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'bar' },
		{ type: "newline" }
	]);
	const commands = await collect(toCommands(tokens));
	
	assertEquals(commands, [
		[
			{ type: "bareword", value: "hello" },
			{ type: "whitespace" },
			{ type: "quoted-string", value: 'world' }
		],
		[
			{ type: "bareword", value: "foo" },
			{ type: "whitespace" },
			{ type: "quoted-string", value: 'bar' }
		]
	]);
});
