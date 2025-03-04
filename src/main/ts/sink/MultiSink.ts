import { Consumer } from "./Consumer.ts";

export class MultiSink<T> implements Consumer<T> {
	#subs: Consumer<T>[];
	constructor(subs: Consumer<T>[]) {
		this.#subs = subs;
	}
	accept(item: T): void {
		for (const sub of this.#subs) {
			sub.accept(item);
		}
	}
}
