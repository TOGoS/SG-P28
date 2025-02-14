type Token = 
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
  
export async function* toTokens(text: AsyncIterable<string>): AsyncIterable<Token> {
	const tokenRegex = /^(?:(?<newline>\n)|(?<space>[ \t]+)|(?<bareword>\w+)|(?<quote>"(?<quotedChars>(?:[^"\\]|\\["\\bfnrt]|\\u[0-9a-fA-F]{4})*)")|(?<comment>#\s(?<commentText>[^\n]*)))/;
	let buffer = '';
	
	let match;
	for await (const chunk of text) {
		buffer += chunk;
		while ((match = tokenRegex.exec(buffer)) !== null) {
			const fullMatch = match[0];
			
			// Some tokens are self-delimiting;
			// we can yield them right away
			if (match.groups?.quote) {
				yield { type: "quoted-string", value: decodeQuotedChars(match.groups.quotedChars) };
			} else if (match.groups?.newline) {
				yield { type: "newline" };
			} else if( fullMatch.length == buffer.length ) {
				break;
			} else if (match.groups?.space) {
				yield { type: "whitespace" };
			} else if (match.groups?.bareword) {
				yield { type: "bareword", value: match.groups.bareword };
			} else if (match.groups?.comment) {
				yield { type: "comment", value: match.groups.commentText };
			}
			buffer = buffer.slice(fullMatch.length);
		}
	}
	// Yield any remaining buffer as a bareword token if it's not empty
	if (match != null) {
		if (match.groups?.space) {
			yield { type: "whitespace" };
		} else if (match.groups?.bareword) {
			yield { type: "bareword", value: match.groups.bareword };
		} else if (match.groups?.comment) {
			yield { type: "comment", value: match.groups.commentText };
		} else {
			throw new Error(`Unexpected dangling bits: ${match[0]}`);
		}
	}
}

function trimCommand(command:Token[]) : Token[] {
	let i=command.length;
	while( command.length > i && command[i-1].type == "whitespace" ) --i;
	return command.slice(0, i);
}

export async function* toCommands(tokens: AsyncIterable<Token>): AsyncIterable<Token[]> {
	let command: Token[] = [];
	for await (const token of tokens) {
		if (token.type === 'newline') {
			if (command.length > 0) {
				yield trimCommand(command);
				command = [];
			}
		} else if (token.type !== 'comment') {
			command.push(token);
		}
	}
	if (command.length > 0) {
		yield trimCommand(command);
	}
}
