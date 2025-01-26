# SG2100-P28, a.k.a. WBBReader2

A Deno script to read data from a `/dev/input/eventX` device and send
it over OSC, for the purpose of having a group of cheap linux boxen
(maybe Raspberry Pis) collect events from a swarm of balance boards
to control some music or something.

Options in flux.

As of v0.28.28, can only read from one board per process.

Planned features:
- Automatically detect new boards as they are added
- Some board identification routine
  (maybe you step on each board in order).

I might find a way to use Pi Pico Ws to do this job,
in which case this will become abandonware.
