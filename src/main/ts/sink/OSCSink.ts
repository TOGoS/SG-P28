import OSCMessage from "../osc/Message.ts";
import { Consumer } from "./Consumer.ts";

export class OSCSink implements Consumer<OSCMessage> {
	#sink: Consumer<Uint8Array>;
	constructor(sink: Consumer<Uint8Array>) {
		this.#sink = sink;
	}
	accept(msg: OSCMessage) {
		this.#sink.accept(msg.marshal());
	}
}
