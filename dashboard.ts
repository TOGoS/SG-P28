import * as ansicodes from 'https://deno.land/x/tui@2.1.11/src/utils/ansi_codes.ts';
import { MqttClient, MqttPackets } from "jsr:@ymjacky/mqtt5@0.0.19";
import { inputEvents } from 'https://deno.land/x/scratch38s15@0.0.8/src/lib/ts/terminput/inputeventparser.ts';
import TOGTUICanvas, { TOGTUIRenderer } from 'https://deno.land/x/scratch38s15@0.0.8/src/lib/ts/termdraw/TOGTUICanvas.ts';
import BoxDrawr from 'https://deno.land/x/scratch38s15@0.0.6/src/lib/ts/termdraw/BoxDrawr.ts';
import { parseTargetSpec } from "./src/main/ts/sink/sinkspec.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

class Dashboard {
	#canvas : TOGTUICanvas;
	constructor(out:WritableStreamDefaultWriter) {
		this.#canvas = new TOGTUICanvas(out, this.render.bind(this));
	}
	get canvas() { return this.#canvas; }
	
	#needClear : boolean = true;
	#attrMap : Map<string,string> = new Map();
	#logMessages : string[] = [];
	#screenSize : {columns:number, rows:number} = {rows: 40, columns: 80};
	
	enterTui() {
		this.#canvas.enterTui();
	}
	exitTui() {
		this.#canvas.exitTui();
	}
	update(key:string, value:Uint8Array) {
		this.#attrMap.set(key, textDecoder.decode(value));
		this.#canvas.requestRedraw();
	}
	async render(out:WritableStreamDefaultWriter) : Promise<void> {
		if( this.#needClear ) {
			this.#needClear = false;
			await out.write(textEncoder.encode(ansicodes.CLEAR_SCREEN));
		}
		out.write(textEncoder.encode(ansicodes.moveCursor(0,0)));
		for( const [k,v] of this.#attrMap.entries() ) {
			out.write(textEncoder.encode(`${k} : ${v}\n`));
		}
		return Promise.resolve();
	}
	log(text:string) {
		this.#logMessages.push(text);
	}
	set screenSize(size:{rows:number, columns:number}) {
		this.#screenSize = size;
		this.#canvas.requestRedraw();
	}
}

const out = Deno.stdout.writable.getWriter();
const dashboard = new Dashboard(out);
const sourceSpec = parseTargetSpec("mqtt://localhost:1883/");
const abortController = new AbortController();
const abortSignal = abortController.signal;
if( sourceSpec.type == "MQTT" ) {
	const mqttClient = new MqttClient({url: new URL(`mqtt://${sourceSpec.targetHostname}:${sourceSpec.targetPort}`)});
	abortSignal.addEventListener("abort", () => {
		mqttClient.disconnect();
	});
	await mqttClient.connect();
	mqttClient.subscribe("#");
	mqttClient.on('publish', evt => {
		dashboard.update(evt.detail.topic, evt.detail.payload);
	});
} else {
	throw new Error(`Unrecognized source spec: ${JSON.stringify(sourceSpec)}`)
}

const input = Deno.stdin.readable;
// abortSignal.addEventListener("abort", () => { input.cancel(); });

try {
	Deno.stdin.setRaw(true);
	dashboard.enterTui();
	for await(const evt of inputEvents(input)) {
		dashboard.log(`Read event: ${JSON.stringify(evt)}`);
		if( evt.key == "\x03" || evt.key == "q" ) {
			abortController.abort();
			break;
		} else if( evt.key == "r" ) { // 'r' for redraw
			dashboard.screenSize = Deno.consoleSize();
		}
	}
} catch( e ) {
	if( e instanceof Error && e.name == 'BadResource' ) {
		// Presumably from closing the input stream;
		dashboard.log(`Ignoring error: ${e}`)
	} else {
		throw e;
	}
} finally {
	dashboard.exitTui();
	Deno.stdin.setRaw(false);
}