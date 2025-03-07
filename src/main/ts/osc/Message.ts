// Adapted from https://deno.land/x/osc@v0.1.0

//// Buffer stuff, copied from std@0.165.0

function assert(expr: unknown, msg = ""): asserts expr {
	if (!expr) {
		throw new Error(msg);
	}
}

function copy(src: Uint8Array, dst: Uint8Array, off = 0): number {
	off = Math.max(0, Math.min(off, dst.byteLength));
	const dstBytesAvailable = dst.byteLength - off;
	if (src.byteLength > dstBytesAvailable) {
		src = src.subarray(0, dstBytesAvailable);
	}
	dst.set(src, off);
	return src.byteLength;
}

const MAX_SIZE = 2 ** 32 - 2;

interface Reader {
	/** Reads up to `p.byteLength` bytes into `p`. It resolves to the number of
	 * bytes read (`0` < `n` <= `p.byteLength`) and rejects if any error
	 * encountered. Even if `read()` resolves to `n` < `p.byteLength`, it may
	 * use all of `p` as scratch space during the call. If some data is
	 * available but not `p.byteLength` bytes, `read()` conventionally resolves
	 * to what is available instead of waiting for more.
	 *
	 * When `read()` encounters end-of-file condition, it resolves to EOF
	 * (`null`).
	 *
	 * When `read()` encounters an error, it rejects with an error.
	 *
	 * Callers should always process the `n` > `0` bytes returned before
	 * considering the EOF (`null`). Doing so correctly handles I/O errors that
	 * happen after reading some bytes and also both of the allowed EOF
	 * behaviors.
	 *
	 * Implementations should not retain a reference to `p`.
	 *
	 * Use iterateReader() from https://deno.land/std@$STD_VERSION/streams/conversion.ts to turn a Reader into an
	 * AsyncIterator.
	 */
	read(p: Uint8Array): Promise<number | null>;
}

class Buffer implements Reader {
	#buf: Uint8Array; // contents are the bytes buf[off : len(buf)]
	#off = 0; // read at buf[off], write at buf[buf.byteLength]
	
	constructor(ab?:Uint8Array) {
		this.#buf = ab === undefined ? new Uint8Array(0) : new Uint8Array(ab);
	}
	
	/** Returns a slice holding the unread portion of the buffer.
	 *
	 * The slice is valid for use only until the next buffer modification (that
	 * is, only until the next call to a method like `read()`, `write()`,
	 * `reset()`, or `truncate()`). If `options.copy` is false the slice aliases the buffer content at
	 * least until the next buffer modification, so immediate changes to the
	 * slice will affect the result of future reads.
	 * @param options Defaults to `{ copy: true }`
	 */
	bytes(options = { copy: true }): Uint8Array {
		if (options.copy === false) return this.#buf.subarray(this.#off);
		return this.#buf.slice(this.#off);
	}

	/** Returns whether the unread portion of the buffer is empty. */
	empty(): boolean {
		return this.#buf.byteLength <= this.#off;
	}

	/** A read only number of bytes of the unread portion of the buffer. */
	get length(): number {
		return this.#buf.byteLength - this.#off;
	}

	/** The read only capacity of the buffer's underlying byte slice, that is,
	 * the total space allocated for the buffer's data. */
	get capacity(): number {
		return this.#buf.buffer.byteLength;
	}

	/** Discards all but the first `n` unread bytes from the buffer but
	 * continues to use the same allocated storage. It throws if `n` is
	 * negative or greater than the length of the buffer. */
	truncate(n: number) {
		if (n === 0) {
			this.reset();
			return;
		}
		if (n < 0 || n > this.length) {
			throw Error("bytes.Buffer: truncation out of range");
		}
		this.#reslice(this.#off + n);
	}

	reset() {
		this.#reslice(0);
		this.#off = 0;
	}

	#tryGrowByReslice(n: number) {
		const l = this.#buf.byteLength;
		if (n <= this.capacity - l) {
			this.#reslice(l + n);
			return l;
		}
		return -1;
	}

	#reslice(len: number) {
		assert(len <= this.#buf.buffer.byteLength);
		this.#buf = new Uint8Array(this.#buf.buffer, 0, len);
	}

	/** Reads the next `p.length` bytes from the buffer or until the buffer is
	 * drained. Returns the number of bytes read. If the buffer has no data to
	 * return, the return is EOF (`null`). */
	readSync(p: Uint8Array): number | null {
		if (this.empty()) {
			// Buffer is empty, reset to recover space.
			this.reset();
			if (p.byteLength === 0) {
				// this edge case is tested in 'bufferReadEmptyAtEOF' test
				return 0;
			}
			return null;
		}
		const nread = copy(this.#buf.subarray(this.#off), p);
		this.#off += nread;
		return nread;
	}

	/** Reads the next `p.length` bytes from the buffer or until the buffer is
	 * drained. Resolves to the number of bytes read. If the buffer has no
	 * data to return, resolves to EOF (`null`).
	 *
	 * NOTE: This methods reads bytes synchronously; it's provided for
	 * compatibility with `Reader` interfaces.
	 */
	read(p: Uint8Array): Promise<number | null> {
		const rr = this.readSync(p);
		return Promise.resolve(rr);
	}

	writeSync(p: Uint8Array): number {
		const m = this.#grow(p.byteLength);
		return copy(p, this.#buf, m);
	}
	
	#grow(n: number) {
		const m = this.length;
		// If buffer is empty, reset to recover space.
		if (m === 0 && this.#off !== 0) {
			this.reset();
		}
		// Fast: Try to grow by means of a reslice.
		const i = this.#tryGrowByReslice(n);
		if (i >= 0) {
			return i;
		}
		const c = this.capacity;
		if (n <= Math.floor(c / 2) - m) {
			// We can slide things down instead of allocating a new
			// ArrayBuffer. We only need m+n <= c to slide, but
			// we instead let capacity get twice as large so we
			// don't spend all our time copying.
			copy(this.#buf.subarray(this.#off), this.#buf);
		} else if (c + n > MAX_SIZE) {
			throw new Error("The buffer cannot be grown beyond the maximum size.");
		} else {
			// Not enough space anywhere, we need to allocate.
			const buf = new Uint8Array(Math.min(2 * c + n, MAX_SIZE));
			copy(this.#buf.subarray(this.#off), buf);
			this.#buf = buf;
		}
		// Restore this.#off and len(this.#buf).
		this.#off = 0;
		this.#reslice(Math.min(m + n, MAX_SIZE));
		return m;
	}

	/** Grows the buffer's capacity, if necessary, to guarantee space for
	 * another `n` bytes. After `.grow(n)`, at least `n` bytes can be written to
	 * the buffer without another allocation. If `n` is negative, `.grow()` will
	 * throw. If the buffer can't grow it will throw an error.
	 *
	 * Based on Go Lang's
	 * [Buffer.Grow](https://golang.org/pkg/bytes/#Buffer.Grow). */
	grow(n: number) {
		if (n < 0) {
			throw Error("Buffer.grow: negative count");
		}
		const m = this.#grow(n);
		this.#reslice(m);
	}
}

/** Generate longest proper prefix which is also suffix array. */
function createLPS(pat: Uint8Array): Uint8Array {
	const lps = new Uint8Array(pat.length);
	lps[0] = 0;
	let prefixEnd = 0;
	let i = 1;
	while (i < lps.length) {
		if (pat[i] == pat[prefixEnd]) {
			prefixEnd++;
			lps[i] = prefixEnd;
			i++;
		} else if (prefixEnd === 0) {
			lps[i] = 0;
			i++;
		} else {
			prefixEnd = lps[prefixEnd - 1];
		}
	}
	return lps;
}

class BytesList {
	#len = 0;
	#chunks: {
		value: Uint8Array;
		start: number; // start offset from head of chunk
		end: number; // end offset from head of chunk
		offset: number; // offset of head in all bytes
	}[] = [];
	constructor() {}

	/**
	 * Total size of bytes
	 */
	size() {
		return this.#len;
	}
	/**
	 * Push bytes with given offset infos
	 */
	add(value: Uint8Array, start = 0, end = value.byteLength) {
		if (value.byteLength === 0 || end - start === 0) {
			return;
		}
		checkRange(start, end, value.byteLength);
		this.#chunks.push({
			value,
			end,
			start,
			offset: this.#len,
		});
		this.#len += end - start;
	}

	/**
	 * Drop head `n` bytes.
	 */
	shift(n: number) {
		if (n === 0) {
			return;
		}
		if (this.#len <= n) {
			this.#chunks = [];
			this.#len = 0;
			return;
		}
		const idx = this.getChunkIndex(n);
		this.#chunks.splice(0, idx);
		const [chunk] = this.#chunks;
		if (chunk) {
			const diff = n - chunk.offset;
			chunk.start += diff;
		}
		let offset = 0;
		for (const chunk of this.#chunks) {
			chunk.offset = offset;
			offset += chunk.end - chunk.start;
		}
		this.#len = offset;
	}

	/**
	 * Find chunk index in which `pos` locates by binary-search
	 * returns -1 if out of range
	 */
	getChunkIndex(pos: number): number {
		let max = this.#chunks.length;
		let min = 0;
		while (true) {
			const i = min + Math.floor((max - min) / 2);
			if (i < 0 || this.#chunks.length <= i) {
				return -1;
			}
			const { offset, start, end } = this.#chunks[i];
			const len = end - start;
			if (offset <= pos && pos < offset + len) {
				return i;
			} else if (offset + len <= pos) {
				min = i + 1;
			} else {
				max = i - 1;
			}
		}
	}

	/**
	 * Get indexed byte from chunks
	 */
	get(i: number): number {
		if (i < 0 || this.#len <= i) {
			throw new Error("out of range");
		}
		const idx = this.getChunkIndex(i);
		const { value, offset, start } = this.#chunks[idx];
		return value[start + i - offset];
	}

	/**
	 * Iterator of bytes from given position
	 */
	*iterator(start = 0): IterableIterator<number> {
		const startIdx = this.getChunkIndex(start);
		if (startIdx < 0) return;
		const first = this.#chunks[startIdx];
		let firstOffset = start - first.offset;
		for (let i = startIdx; i < this.#chunks.length; i++) {
			const chunk = this.#chunks[i];
			for (let j = chunk.start + firstOffset; j < chunk.end; j++) {
				yield chunk.value[j];
			}
			firstOffset = 0;
		}
	}

	/**
	 * Returns subset of bytes copied
	 */
	slice(start: number, end: number = this.#len): Uint8Array {
		if (end === start) {
			return new Uint8Array();
		}
		checkRange(start, end, this.#len);
		const result = new Uint8Array(end - start);
		const startIdx = this.getChunkIndex(start);
		const endIdx = this.getChunkIndex(end - 1);
		let written = 0;
		for (let i = startIdx; i < endIdx; i++) {
			const chunk = this.#chunks[i];
			const len = chunk.end - chunk.start;
			result.set(chunk.value.subarray(chunk.start, chunk.end), written);
			written += len;
		}
		const last = this.#chunks[endIdx];
		const rest = end - start - written;
		result.set(last.value.subarray(last.start, last.start + rest), written);
		return result;
	}
	/**
	 * Concatenate chunks into single Uint8Array copied.
	 */
	concat(): Uint8Array {
		const result = new Uint8Array(this.#len);
		let sum = 0;
		for (const { value, start, end } of this.#chunks) {
			result.set(value.subarray(start, end), sum);
			sum += end - start;
		}
		return result;
	}
}

function checkRange(start: number, end: number, len: number) {
	if (start < 0 || len < start || end < 0 || len < end || end < start) {
		throw new Error("invalid range");
	}
}

/** Read delimited bytes from a Reader. */
async function* readDelim(
	reader: Reader,
	delim: Uint8Array,
): AsyncIterableIterator<Uint8Array> {
	// Avoid unicode problems
	const delimLen = delim.length;
	const delimLPS = createLPS(delim);
	const chunks = new BytesList();
	const bufSize = Math.max(1024, delimLen + 1);

	// Modified KMP
	let inspectIndex = 0;
	let matchIndex = 0;
	while (true) {
		const inspectArr = new Uint8Array(bufSize);
		const result = await reader.read(inspectArr);
		if (result === null) {
			// Yield last chunk.
			yield chunks.concat();
			return;
		} else if (result < 0) {
			// Discard all remaining and silently fail.
			return;
		}
		chunks.add(inspectArr, 0, result);
		let localIndex = 0;
		while (inspectIndex < chunks.size()) {
			if (inspectArr[localIndex] === delim[matchIndex]) {
				inspectIndex++;
				localIndex++;
				matchIndex++;
				if (matchIndex === delimLen) {
					// Full match
					const matchEnd = inspectIndex - delimLen;
					const readyBytes = chunks.slice(0, matchEnd);
					yield readyBytes;
					// Reset match, different from KMP.
					chunks.shift(inspectIndex);
					inspectIndex = 0;
					matchIndex = 0;
				}
			} else {
				if (matchIndex === 0) {
					inspectIndex++;
					localIndex++;
				} else {
					matchIndex = delimLPS[matchIndex - 1];
				}
			}
		}
	}
}

//// 

export enum MessageType {
	Int32 = "i",
	Int64 = "h",
	Float32 = "f",
	Double = "d",
	String = "s",
	True = "T",
	False = "F",
	Binary = "b",
	TimeTag = "t",
	Null = "N",
}

type MsgType = number | bigint | string | boolean | null | Uint8Array;

export default class Message {
	private buf = new Buffer();
	private args: { v: MsgType; t: MessageType }[] = [];
	
	constructor(private addr: string) {}
	
	public append(
		a: number,
		t?: MessageType.Int32 | MessageType.Float32 | MessageType.Double
	): Message;
	public append(a: bigint): Message;
	public append(a: string): Message;
	public append(a: boolean): Message;
	public append(a: null): Message;
	public append(a: Uint8Array): Message;
	public append(a: MsgType, t?: MessageType): Message {
		let _t: MessageType;
		switch (typeof a) {
			case "boolean": // True False
				_t = a ? MessageType.True : MessageType.False;
				break;
			case "string": // String
				_t = MessageType.String;
				break;
			case "number": // Int32 Float32 Double
				if (Number.isInteger(a)) _t = MessageType.Int32; // Int32
				else if (t === MessageType.Double) _t = MessageType.Double; // Double
				else _t = MessageType.Float32; // Float32
				break;
			case "bigint": // Int64
				_t = MessageType.Int64;
				break;
			case "object": // NULL
				if (a === null) _t = MessageType.Null;
				else if (a instanceof Uint8Array) _t = MessageType.Binary;
				else return this;
				break;
			default:
				return this;
		}
		this.args.push({ v: a, t: _t });
		return this;
	}
	
	private static pad_count(len: number) {
		return 4 - ((len % 4) % 4);
	}
	
	private pad(buf?: Buffer) {
		const b = buf ?? this.buf;
		b.writeSync(new Uint8Array(Message.pad_count(b.length)));
	}
	
	public marshal() {
		this.buf.writeSync(str2bytes(this.addr));
		this.pad();
		let type_tag = ",";
		const payload = new Buffer();
		for (const t of this.args) {
			type_tag += t.t;
			switch (t.t) {
				case MessageType.True:
				case MessageType.False:
				case MessageType.Null:
					break;
				case MessageType.Int32: {
					const dv = new DataView(new ArrayBuffer(4));
					dv.setInt32(0, t.v as number);
					payload.writeSync(new Uint8Array(dv.buffer));
					break;
				}
				case MessageType.Int64: {
					const dv = new DataView(new ArrayBuffer(8));
					dv.setBigInt64(0, t.v as bigint);
					payload.writeSync(new Uint8Array(dv.buffer));
					break;
				}
				case MessageType.Float32: {
					const dv = new DataView(new ArrayBuffer(4));
					dv.setFloat32(0, t.v as number);
					payload.writeSync(new Uint8Array(dv.buffer));
					break;
				}
				case MessageType.Double: {
					const dv = new DataView(new ArrayBuffer(8));
					dv.setFloat64(0, t.v as number);
					payload.writeSync(new Uint8Array(dv.buffer));
					break;
				}
				case MessageType.String:
					payload.writeSync(str2bytes(t.v as string));
					this.pad(payload);
					break;
				case MessageType.Binary: {
					const v = t.v as Uint8Array;
					const dv = new DataView(new ArrayBuffer(4));
					dv.setInt32(0, v.length);
					payload.writeSync(new Uint8Array(dv.buffer));
					payload.writeSync(v);
					this.pad(payload);
					break;
				}
			}
		}
		this.buf.writeSync(str2bytes(type_tag));
		this.pad();
		this.buf.writeSync(payload.bytes());
		return this.buf.bytes();
	}
	
	public static async fromBuffer(b: Uint8Array) {
		const [addr, n1] = await this.readStr(b);
		const [tags, n2] = await this.readStr(b.slice(n1));
		if (tags[0] !== ",") return {};
		const buf = new Buffer(b.slice(n1 + n2));
		const args: MsgType[] = [];
		for (const tag of tags.slice(1).split("")) {
			switch (tag as MessageType) {
				case MessageType.String: {
					const [str, n] = await this.readStr(buf.bytes({ copy: true }));
					buf.readSync(new Uint8Array(n));
					args.push(str);
					break;
				}
				case MessageType.Binary: {
					const v1 = new Uint8Array(4);
					buf.readSync(v1);
					const len = new DataView(v1.buffer).getInt32(0);
					const v2 = new Uint8Array(len + this.pad_count(len));
					buf.readSync(v2);
					args.push(v2.slice(0, len));
					break;
				}
				case MessageType.Int32: {
					const v = new Uint8Array(4);
					buf.readSync(v);
					args.push(new DataView(v.buffer).getInt32(0));
					break;
				}
				case MessageType.Int64: {
					const v = new Uint8Array(8);
					buf.readSync(v);
					args.push(new DataView(v.buffer).getBigInt64(0));
					break;
				}
				case MessageType.Float32: {
					const v = new Uint8Array(4);
					buf.readSync(v);
					args.push(new DataView(v.buffer).getFloat32(0));
					break;
				}
				case MessageType.Double: {
					const v = new Uint8Array(8);
					buf.readSync(v);
					args.push(new DataView(v.buffer).getFloat64(0));
					break;
				}
				case MessageType.True:
					args.push(true);
					break;
				case MessageType.False:
					args.push(false);
					break;
				default:
					break;
			}
		}
		return { addr, args };
	}
	
	private static async readStr(b: Uint8Array): Promise<[string, number]> {
		const source = readDelim(new Buffer(b), new Uint8Array([0]));
		for await (const t of source)
			return [
				new TextDecoder().decode(t),
				t.byteLength + this.pad_count(t.byteLength),
			];
		return ["", -1];
	}
}

function str2bytes(s: string) {
	return new TextEncoder().encode(s);
}
