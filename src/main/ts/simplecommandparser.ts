import { toLines } from "./streamiter.ts";

const commentRe = /^(#(?:[!\s]+.*)?)?\s*$/;
const whitespaceRe = /^\s+/;
const barewordRe = /^(?:[A-Za-z0-9+]+)/;
const quotedRe = /^"((?:[^\"\\]|\\[\\"tfrn])*)"/;

export async function* linesToSimpleCommands(lines:Iterable<string>|AsyncIterable<string>) : AsyncIterable<string[]> {
	for await( let line of lines ) {
		let m : RegExpExecArray|null;
		if( commentRe.exec(line) != null ) {
			continue;
		}
		const args : string[] = [];
		let requireWhitespace = false;
		while( commentRe.exec(line) == null ) {
			if( (m = whitespaceRe.exec(line)) != null ) {
				line = line.substring(m[0].length);
			} else if( requireWhitespace ) {
				throw new Error(`Whitespace required between tokens, but none present before '${line}'`);
			}
			
			if( (m = barewordRe.exec(line)) != null ) {
				line = line.substring(m[0].length);
				args.push(m[0]);
				requireWhitespace= true;
			} else if( (m = quotedRe.exec(line)) != null ) {
				line = line.substring(m[0].length);
				args.push(m[1].replaceAll(/\\(.)/g, (escSeq, escCode) => {
					switch(escCode) {
					case '\\': return '\\';
					case '\"': return '\"';
					case 'f': return "\f";
					case 't': return "\t";
					case 'n': return "\n";
					case 'r': return "\r";
					default:
						throw new Error(`Unrecognized escape sequence: '${escSeq}'`);
					}
				}));
				requireWhitespace= true;
			} else {
				throw new Error(`Unrecognized simple command token syntax: ${line}`);
			}
		}
		yield args;
	}
}

export function chunksToSimpleCommands(chunks:Iterable<string>|AsyncIterable<string>) : AsyncIterable<string[]> {
	return linesToSimpleCommands(toLines(chunks));
}
