import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { leftPad } from "./leftPad.ts";

Deno.test({
	name: "leftPad with zero-length template",
	fn() { assertEquals("", leftPad("", "anything")); }
});
Deno.test({
	name: "leftPad something reasonable",
	fn() { assertEquals("horsemaster", leftPad("horseHELLO!", "master")); }
});
