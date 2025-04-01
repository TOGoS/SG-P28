import ProcessLike from './src/main/ts/process/ProcessLike.ts'

interface TopicPath {
	mode: "relative"|"absolute",
	path: string,
}

interface MQTTishMessage {
	topic   : TopicPath;
	payload : Uint8Array;
}

/// ProtoProcess definitions
interface GenericOutputConfig<O,E> {
	stdout : WritableStream<O>;
	stderr : WritableStream<E>;
}

interface GenericIOConfig<I,O,E> {
	stdin  : ReadableStream<I>;
	stdout : WritableStream<O>;
	stderr : WritableStream<E>;
}

type ConventionalIOConfig = GenericIOConfig<Uint8Array, Uint8Array, Uint8Array>;
type ConventionalOutputConfig = GenericOutputConfig<Uint8Array, Uint8Array>;

type ProtoProcess<IOConfig> = (io:IOConfig) => ProcessLike;

//// MQTTish message encoding/decoding

// Not actually sure what the best way to model this is;
// could Danduce it, but JS generator might be better
// if I can get away with it.

async function* chunksToMqttishMessages(chunks:AsyncIterable<Uint8Array>) : AsyncIterable<MQTTishMessage> {
	for await( const chunk of chunks ) {
		// TODO
	}
}
async function* mqttishMessagesToChunks(chunks:AsyncIterable<MQTTishMessage>) : AsyncIterable<Uint8Array> {
	for await( const chunk of chunks ) {
		// TODO
	}
}

/// TODO: Spawn an OS process, pipe i/o to our own

const textEncoder = new TextEncoder();
function nonClosing<T>(writer:{
	write  : (chunk   : T  ) => Promise<void>,
	abort? : (reason? : any) => Promise<void>,
}) : WritableStream<T> {
	// Need to create a 'real' WritableStream;
	// if you try to just implement the interface,
	// Deno's implementation of pipeTo won't accept it.
	return new WritableStream({
		close() {
			// Don't actually close it!
			return Promise.resolve();
		},
		write(chunk:T) {
			return writer.write(chunk);
		},
		// deno-lint-ignore no-explicit-any
		abort(reason?: any) {
			return (writer.abort?.(reason)) ?? Promise.resolve();
		},
	});
}

// writers to be re-used.
// need to wrap in a new WritableStream for each use.
const outWriter = Deno.stdout.writable.getWriter();
const errWriter = Deno.stderr.writable.getWriter();

function demoLsCommandIoPiping(io:ConventionalOutputConfig) : Promise<number> {
	console.log(`## ${demoLsCommandIoPiping.name}`)
	const cmd = new Deno.Command("ls", {
		stdin : "null" ,
		stdout: "piped",
		stderr: "piped",
	});
	console.log("io.stdout:", io.stdout);
	const proc = cmd.spawn();
	return Promise.all([
		// io.stdin.pipeTo(proc.stdin).catch(_e => {/*ignore*/}),
		proc.stdout.pipeTo(io.stdout),
		proc.stderr.pipeTo(io.stderr),
	]).then(_ignore => proc.status.then(s => s.code));
}

if( import.meta.main ) {
	await demoLsCommandIoPiping({
		stdout: nonClosing(outWriter),
		stderr: nonClosing(errWriter),
	});
}

/// DONE one that also reads from stdin

function demoCatCommandIoPiping(io:ConventionalIOConfig) : Promise<number> {
	console.log(`## ${demoCatCommandIoPiping.name}`)
	const cmd = new Deno.Command("cat", {
		stdin : "piped",
		stdout: "piped",
		stderr: "piped",
	});
	const proc = cmd.spawn();
	return Promise.all([
		io.stdin.pipeTo(proc.stdin),
		proc.stdout.pipeTo(io.stdout),
		proc.stderr.pipeTo(io.stderr),
	]).then(_ignore => proc.status.then(s => s.code));
}

if( import.meta.main ) {
	await demoCatCommandIoPiping({
		stdin : ReadableStream.from([textEncoder.encode("Hello, demo cat!\n")]),
		stdout: nonClosing(outWriter),
		stderr: nonClosing(errWriter),
	});
}

/// TODO: Again, but model as a protoprocess

