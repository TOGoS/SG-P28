// export type ProcSig = Deno.Signal;
// Let's not be tied to Deno; duplicate the options here:
export type ProcSig =
	| "SIGABRT"
	| "SIGALRM"
	| "SIGBREAK"
	| "SIGBUS"
	| "SIGCHLD"
	| "SIGCONT"
	| "SIGEMT"
	| "SIGFPE"
	| "SIGHUP"
	| "SIGILL"
	| "SIGINFO"
	| "SIGINT"
	| "SIGIO"
	| "SIGPOLL"
	| "SIGUNUSED"
	| "SIGKILL"
	| "SIGPIPE"
	| "SIGPROF"
	| "SIGPWR"
	| "SIGQUIT"
	| "SIGSEGV"
	| "SIGSTKFLT"
	| "SIGSTOP"
	| "SIGSYS"
	| "SIGTERM"
	| "SIGTRAP"
	| "SIGTSTP"
	| "SIGTTIN"
	| "SIGTTOU"
	| "SIGURG"
	| "SIGUSR1"
	| "SIGUSR2"
	| "SIGVTALRM"
	| "SIGWINCH"
	| "SIGXCPU"
	| "SIGXFSZ";

export type ProcessID = string;

type ProcessLike = {
	kill(sig: ProcSig): void;
	readonly id    : ProcessID;
	readonly name? : string;
	wait() : Promise<number>;
}

export default ProcessLike;
