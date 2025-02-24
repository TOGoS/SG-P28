import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { chunksToSimpleCommands } from "./simplecommandparser.ts";

const simpleTestCases : {[input:string]: string[][]} = {
	'# comment': [],
	'foo bar': [['foo', 'bar']],
	'foo "bar baz" quux': [['foo', 'bar baz', 'quux']],
	'foo "bar\\nbaz"': [['foo', 'bar\nbaz']],
};

async function collect<T>(iter:Iterable<T>|AsyncIterable<T>) : Promise<T[]> {
	const arr = [];
	for await( const item of iter ) arr.push(item);
	return arr;
}	

Deno.test('simple test cases', async () => {
	for( const input in simpleTestCases ) {
		const expectedResult = simpleTestCases[input];
		const parsed : string[][] = await collect(chunksToSimpleCommands([input]));
		assertEquals(parsed, expectedResult);
	}
});
