export type ProcSig = Deno.Signal;
export type ProcStat = Deno.CommandStatus;
export type ProcessID = string;

type ProcessLike = {
	kill(sig: ProcSig): void;
	readonly id    : ProcessID;
	readonly name? : string;
	wait() : Promise<number>;
}

export default ProcessLike;
