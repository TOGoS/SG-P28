export type Token = 
  | { type: "bareword", value: string }
  | { type: "newline" }
  | { type: "whitespace" }
  | { type: "quoted-string", value: string }
  | { type: "comment", value: string };

function decodeQuotedChars(chars: string) {
	return chars.replace(/\\(["\\\/bfnrt])/g, (match, p1) => {
		switch (p1) {
			case '"': return '"';
			case '\\': return '\\';
			case '/': return '/';
			case 'b': return '\b';
			case 'f': return '\f';
			case 'n': return '\n';
			case 'r': return '\r';
			case 't': return '\t';
			default: return match;
		}
	}).replace(/\\u([0-9a-fA-F]{4})/g, (match, p1) => {
		return String.fromCharCode(parseInt(p1, 16));
	});
}

const tokenRegex = /^(?:(?<newline>\n)|(?<space>[ \t\r]+)|(?<bareword>\w+)|(?<quote>"(?<quotedChars>(?:[^"\\]|\\["\\bfnrt]|\\u[0-9a-fA-F]{4})*)")|(?<comment>#\s(?<commentText>[^\n]*)))/;



function tokenize(input:string, isEnd:boolean) : {tokens:Token[], remaining:string} {
	const tokens : Token[] = [];
	let match : RegExpExecArray|null;
	
	// A problem: If nothing matches, and never will,
	// this just continues on to gobble up more chars.
	// A nice hand-rolled parser might be better.
	
	while ((match = tokenRegex.exec(input)) !== null) {
		const fullMatch = match[0];
		
		if( fullMatch.length == 0 ) {
			throw new Error(`Match length = 0 at: '${input}'`);
		}
		
		// Some tokens are self-delimiting;
		// we can yield them right away
		if (match.groups?.quote) {
			tokens.push({ type: "quoted-string", value: decodeQuotedChars(match.groups.quotedChars) });
		} else if (match.groups?.newline) {
			tokens.push({ type: "newline" });
		} else if( !isEnd && fullMatch.length == input.length  ) {
			// Remnaining token types could extend beyond the end,
			// so can't say for sure.  Quit for now.
			break;
		} else if (match.groups?.space) {
			tokens.push({ type: "whitespace" });
		} else if (match.groups?.bareword) {
			tokens.push({ type: "bareword", value: match.groups.bareword });
		} else if (match.groups?.comment) {
			tokens.push({ type: "comment", value: match.groups.commentText });
		} else {
			throw new Error(`Failed to tokenize: '${input}'`);
		}
		input = input.slice(fullMatch.length);
	}
	return {
		tokens,
		remaining: input
	};
}

export async function* toTokens(text: Iterable<string>|AsyncIterable<string>): AsyncIterable<Token> {
	let buffer = '';
	for await (const chunk of text) {
		buffer += chunk;
		const trez = tokenize(buffer, false);
		for( const t of trez.tokens ) yield t;
		buffer = trez.remaining;
	}
	const trez = tokenize(buffer, true);
	for( const t of trez.tokens ) yield t;
	buffer = trez.remaining;
	if( buffer.length > 0 ) {
		throw new Error(`Unexpected dangling bits: ${buffer}`);
	}
}

function trimCommand(command:Token[]) : Token[] {
	let len = command.length;
	while( len > 0 && command[len-1].type == "whitespace" ) --len;
	return command.slice(0, len);
}

export async function* toCommands(tokens: AsyncIterable<Token>): AsyncIterable<Token[]> {
	let command: Token[] = [];
	for await (const token of tokens) {
		if (token.type === 'newline') {
			command = trimCommand(command);
			if (command.length > 0) {
				yield command;
				command = [];
			}
		} else if (token.type !== 'comment') {
			command.push(token);
		}
	}
	command = trimCommand(command);
	if (command.length > 0) yield command;
}
