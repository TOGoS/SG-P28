# SG2100-P28, a.k.a. WBBReader2

## oscify.ts

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

## wbbconnector.ts

A Deno script that will talk to bluetoothd over D-bus to automatically
connect to a preconfigured list of bluetooth devices,
watch for their corresponding `/dev/input/event*` device file to appear,
and start reading events from them.

To run:

```
deno run --unstable-net --check=all --allow-all wbbconnector.ts v2 "--target=osc+udp://192.168.9.9:9901;debug=on/wbb" "00:21:BD:D1:5C:A9" "58:BD:A3:AC:20:AD"
```

Replace `192.168.9.9:9901` with the host:port to which you want to send OSC packets.
Replace the MAC addresses with those of whatever devices you want to connect.

To connect the Wii Balance Boards, start `wbbconnector`,
then power the on and hit the red button on the bottom of each.
It can take a while before the devices show up.
Once they do, you should see a change in the program's output from

> Checking on 58:BD:A3:AC:20:AD (undefined)

to

> Checking on 58:BD:A3:AC:20:AD (connected)

and eventually some stuff like

```
# wbb-connector-v2: FS watch event: {"kind":"create","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: inputEventDeviceAppeared: Associating 58:BD:A3:AC:20:AD with /dev/input/event3
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"create","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/js0"],"flag":null}
# wbb-connector-v2: FS watch event: {"kind":"modify","paths":["/dev/input/event3"],"flag":null}
# wbb-connector-v2: readEvents(/dev/input/event3): Opening '/dev/input/event3'...
```

and, if/when it successfully reads some events (because you're pushing on the pressure pads):

```
# target: sendUdp: Sent UDP packet to {"transport":"udp","hostname":"192.168.9.9","port":9901}: 2f7762622f35383a42443a41333a41433a32303a41442f32000000002c690000000001cd
```

or similar.


Currently this program crashes after a device disconnects.

## FAQ

### I get Permission Denied errors when I try to read from /dev/input/eventN devices!

Maybe try `usermod -a -G input $your_username`.
