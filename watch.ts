/// <reference lib="Deno.window"/>

for await (const event of Deno.watchFs("/dev/input")) {
	console.log("fs event: "+JSON.stringify(event));
}
