import { toTokens, toCommands } from './CommandTokenizer.ts';
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

async function* asyncGenerator<T>(items: T[]): AsyncIterable<T> {
	for (const item of items) {
		yield item;
	}
}

Deno.test('toTokens with simple input', async () => {
	const text = asyncGenerator(['hello world']);
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]);
});

Deno.test('toTokens with quoted strings', async () => {
	const text = asyncGenerator(['"hello world"']);
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
	assertEquals(tokens, [
		{ type: "quoted-string", value: 'hello world' }
	]);
});

Deno.test('toTokens with mixed input', async () => {
	const text = asyncGenerator(['hello "world" # cement']);
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
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
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
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
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "quoted-string", value: 'world' }
	]);
});
*/

Deno.test('toTokens with newline tokens', async () => {
	const text = asyncGenerator(['hello\nworld\n']);
	const tokens = [];
	for await (const token of toTokens(text)) {
		tokens.push(token);
	}
	
	assertEquals(tokens, [
		{ type: "bareword", value: "hello" },
		{ type: "newline" },
		{ type: "bareword", value: "world" },
		{ type: "newline" }
	]);
});

Deno.test('toCommands with simple input', async () => {
	const tokens = asyncGenerator([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" },
		{ type: "newline" }
	]);
	const commands = [];
	for await (const command of toCommands(tokens)) {
		commands.push(command);
	}
	
	assertEquals(commands, [[
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]]);
});

Deno.test('toCommands with multiple commands', async () => {
	const tokens = asyncGenerator([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" },
		{ type: "newline" },
		{ type: "bareword", value: "foo" },
		{ type: "whitespace" },
		{ type: "bareword", value: "bar" },
		{ type: "newline" }
	]);
	const commands = [];
	for await (const command of toCommands(tokens)) {
		commands.push(command);
	}
	
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
	const tokens = asyncGenerator([
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
	const commands = [];
	for await (const command of toCommands(tokens)) {
		commands.push(command);
	}
	
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
	const tokens = asyncGenerator([
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]);
	const commands = [];
	for await (const command of toCommands(tokens)) {
		commands.push(command);
	}
	
	assertEquals(commands, [[
		{ type: "bareword", value: "hello" },
		{ type: "whitespace" },
		{ type: "bareword", value: "world" }
	]]);
});

Deno.test('toCommands with mixed input', async () => {
	const tokens = asyncGenerator([
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
	const commands = [];
	for await (const command of toCommands(tokens)) {
		commands.push(command);
	}
	
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
