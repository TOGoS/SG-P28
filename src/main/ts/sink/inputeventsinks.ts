import InputEvent from "../InputEvent.ts";
import Consumer from "./Consumer.ts";
import { InputEventToOSCSink } from "./InputEventToOSCSink.ts";
import { TargetSpec } from "./sinkspec.ts";
import OSCMessage from "../osc/Message.ts";
import { uint8ArrayToHex } from "../uint8ArrayToHex.ts";
import { UDPSink } from "./UDPSink.ts";
import { OSCSink } from "./OSCSink.ts";

function consumerToCallable<T>(cons:Consumer<T>) : (input:T) => void {
	return (input) => cons.accept(input);
}

export function makeInputEventSink(target:TargetSpec, opts : {
	datagramConnPromise : PromiseLike<Deno.DatagramConn>,
	chanStats?: Map<string,number>,
}) : (evt:InputEvent) => void {
	if (target.type === "Debug") {
		return (item: InputEvent) => {
			console.log(`input-event type=${item.type} code=${item.code} value=${item.value}`);
		};
	} else if (target.type === "OSC+Debug") {
		return consumerToCallable(new InputEventToOSCSink({
			accept(item: OSCMessage) {
				console.log(`osc-packet ${uint8ArrayToHex(item.marshal())}`);
			}
		}, target.path, opts.chanStats));
	} else if (target.type === "OSC+UDP") {
		const sinkProm = opts.datagramConnPromise.then(datagramConn => {
			const udpSink = new UDPSink(
				datagramConn,
				{
					transport: "udp",
					hostname: target.targetHostname,
					port: target.targetPort
				},
				target.debugging ? {
					accept(text: string) { console.log("udpSink: " + text); }
				} : undefined
			);
			const oscSink = new OSCSink(udpSink);
			const sink = new InputEventToOSCSink(oscSink, target.path, opts.chanStats);
			return consumerToCallable(sink);	
		});
		return (evt:InputEvent) => {
			sinkProm.then(sink => sink(evt));
		};
	} else {
		throw new Error(`Unrecognized target spec: '${target}'`);
	}
}