
export interface Consumer<T> {
	accept(item: T): void;
}

export default Consumer;
