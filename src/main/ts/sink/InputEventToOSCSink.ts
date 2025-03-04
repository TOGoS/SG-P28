import { Message as OSCMessage } from "https://deno.land/x/osc@v0.1.0/mod.ts";
import { Consumer } from "./Consumer.ts";
import InputEvent, { EV_ABS, ABS_HAT0X, ABS_HAT1X, ABS_HAT0Y, ABS_HAT1Y } from "../InputEvent.ts";

export class InputEventToOSCSink implements Consumer<InputEvent> {
	#oscSink: Consumer<OSCMessage>;
	#path: string;
	#chanStats: Map<string,number>;
	constructor(oscSink: Consumer<OSCMessage>, path: string, chanStats : Map<string,number>) {
		this.#oscSink = oscSink;
		this.#path = path;
		this.#chanStats = chanStats;
	}
	accept(event: InputEvent): void {
		if (event.type == EV_ABS) {
			let weightIdx = -1;
			switch (event.code) {
				case ABS_HAT0X: weightIdx = 0; break;
				case ABS_HAT1X: weightIdx = 1; break;
				case ABS_HAT0Y: weightIdx = 2; break;
				case ABS_HAT1Y: weightIdx = 3; break;
			}
			if (weightIdx >= 0) {
				// this.weights[weightIdx] = event.value;
				const destPath = this.#path + "/" + weightIdx;
				this.#chanStats.set(destPath, (this.#chanStats.get(destPath) || 0) + 1);
				this.#oscSink.accept(new OSCMessage(destPath).append(event.value));
			}
		}
	}
}
