import { Consumer } from "./Consumer.ts";
import { uint8ArrayToHex } from "../uint8ArrayToHex.ts";

export class UDPSink implements Consumer<Uint8Array> {
	#conn: Deno.DatagramConn;
	#target: Deno.Addr;
	#debug: Consumer<string>;
	constructor(conn: Deno.DatagramConn, target: Deno.Addr, debug?: Consumer<string>) {
		this.#conn = conn;
		this.#target = target;
		this.#debug = debug || { accept(t) { } };
	}
	accept(data: Uint8Array) {
		this.#debug.accept(`Attempting to send ${data.length} bytes to ${JSON.stringify(this.#target)}: ${uint8ArrayToHex(data)}`);
		this.#conn.send(data, this.#target);
	}
}
