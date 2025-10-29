# SG-P28 Devlog

## 2025-09-18

I was using the [SG-P27 devlog](https://gitlab.com/TOGoS/SG-P27/-/blob/master/DEVLOG.org).

Now this project has its own DEVLOG.

Refactored [dashboard.ts](./dashboard.ts) earlier today to use [TUIAppFramework3](https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/tuiappframework3.ts),
but it was doing all its own rendering.

Now I have updated it to use [Components2](https://deno.land/x/scratch38s15@0.0.14/src/lib/ts/termdraw/boxdrawcomponents2.ts)
to turn an abstract and flexible representation of the view
into text on the screen.

![Screenshot: Now using the component library!](http://picture-files.nuke24.net/uri-res/raw/urn:bitprint:KCWIDYRGAAS4IOHGVTTSDO6QKT4XEHWA.KORUFDXS7LU747E2Q6ICE45GA2LAJA45NMJIIDQ/20250919T21-TUI3Dashboard.png)

It's horribly inefficient and kind of a lot of code to set up
the dumb flex components.  Should be fixable with enough functions
and some memoization, though.  Later.

## 2025-10-05

An update: I had "do something for SMP" on my to-do list all day,
but couldn't bring myself to start because my office was too messy,
so I organized it a little bit.

It's still pretty messy, but I finally moved a filing cabinet into the corner so it's less in the way.

Then I finally got the WBBs out (didn't turn them on--just got them out).

Then I fired up `wbbconnector-demo`, which crashed with a surprising `StateIsNotOnlineError`.
I ran it again and it did not crash, so I suspected something was wrong with my
`mkPromiseChain` function, which should have ensured that `connect` actually completed
before `publish` was ever called.

After a bit of printf debugging I realized that the promise chain itself was working fine,
but that `MQTTLogger#subLogger` was creating a new `MQTTLogger` that shared the `MqttClient`
but not the same action queue / promise chain thing, which meant that connecting,
then creating a sublogger, than logging with that would disregard whether the connection
had completed.

Fixed by constructing `MQTTLogger`s with the action queue rather than the MQTT client itself.

## 2025-10-10

Created `start-system-in-screen`.
Which at least shows how to start 'the whole system' as it currently exists.

Some dinking around in dashboard.ts.

Maybe the thing to do is have a tree of topic -> message log.
Then walk the tree to figure out what's going on re: devices.


## 2025-10-12

### TODO

- [\] Fix logging somewhat - MQTTLogger#subLogger should either
  do something different, or not be used for logging from functions
  - Eh, 
- [X] Improve online/offline display in dashboard.ts
  - Color-coded!
- [X] Have a clock so I can tell if dashboard itself is updating!
  - This led to realizing there is probably a race condition in the TUI framework
- [ ] Indicate time since value changed somehow

## 2025-10-13

### TODOs from README, relevance unclear

Here for posterity.

- [ ] maybe readers should allow multiple targets?
  - shouldn't need to restart reader when target changes
  - 2025-10-13: I think multioscify now does this?
- [ ] An orchestrator that automatically controls `multioscify` based on path guesses from `wbbconnector`
  - Probably will want to use shared environment variables defined in a `.env.sh` to configure
    all these things
  - 2025-10-13: No formal configuration system, and no 'orchestrator', yet,
    but you can manually send commands to multioscify with `mosquitto_pub` or whatever.

### Dashboard sometimes stops updating

Sometimes dashboard would stop updating.

I suspect a bug in `TUIRenderStateManager#requestRedraw`.

Could debug by switching dashboard.ts to use local version of S38-S15.

In the meantime, I have disabled dashboard's internal viewstate update debouncing,
so that if TUIRenderStateManager misses one, we'll poke it again shortly.

### Various progress!

![Dashboard screenshot, with colored status text, retain, age metadata](http://picture-files.nuke24.net/uri-res/raw/urn:bitprint:EZT2W6RMQNE5FZWRNLRYFCFYCQ3XLB7D.QZSYSGGYEVIYJFDHJ7TE7MXGMER3MS4DA5RLRGQ/0251013T1810-DashboardWithWBBsConnected.png)

Notes:
- There's a clock in the top-right; if it stops updating, it's because
  dashboard itself stopped working properly.
- Values representing connection status are color-coded

Yellow square brackets indicate metadata about values:
- "R" indicates that the message is retained
- The number afterwards indicates the age of the message

The TUI framework is still horribly inefficient,
but even when redrawing the dashboard a couple times per second,
it is only using 2% CPU, so maybe not a bottleneck just yet.


## 2025-10-15

### Minor updates

Standardizing on 'connected' / 'disconnected' / 'lost' statuses
for MQTT-connected devices (reports about sub-devices, like WBBs,
don't necessarily need to follow this).

For the WBBs, I changed the reported statuses a bit
so include more detail and indicate 'getting-device-handle[-again]'
instead of leaving the device's status blank.

[WBBConnector](./wbbconnector.ts) and [MultiOscify](./multioscify.ts)
both re-publish their status (and in multioscify's case, a summary of sub-processes)
every two seconds, so that you can tell from dashboard if they are actually
still running or have hung (which wbbconnector sometimes does).

![Dashboard showing the system actually reading WBB events](http://picture-files.nuke24.net/uri-res/raw/urn:bitprint:I4PF3JXVWCSYWKNYBWHGNLIGYKDWZNYB.KSLCQHN5G63NLDOILMR5MDIJKDF3AW3FABMF3EA/20251015T2120-ActuallyReadingFromAWBB.png)

### Checkmarks

- [X] wbbconnector: Standardize WBB connection statuses;
  sometimes status is undefined, other times it's 'offline';
  shouldn't that be 'disconnected' if the good state is 'connected'?
  - [Homie](https://homieiot.github.io/specification/) uses '$state' instead of 'status',
    and 'connected'/'disconnected'/'lost' instead of 'online'/'offline'.
	 - For the most part I don't give a shit about Homie; it seems a bit
	   over-engineered and sprinkles dollar signs seemingly at random.
	 - Maybe I intended at some point to standardize on 'connected'/'disconnected'.
	   I don't really care to distinguish between 'disconnected' and 'lost',
	   though maybe I should just let everything be 'lost' by default.
- [X] Dashboard: Indicate retain flag
- [X] Dashboard: Indicate freshness of values somehow, at least the 'status' ones
- [X] Have multioscify publish more info to MQTT
  - [X] Maybe a 'summary' attribute, indicating basics of configuration, current status
  - [X] What it's up to; currently it just sits there, not clear if doing anything!
  - [X] Read values!

## TODO

- [ ] Sometimes multioscify says 0 oscifiers running,
  even though one will have the state of 'running'!
- [ ] Do something about connector getting stuck at "Getting device for"
- [ ] TUO library: Fix race condition 
- [ ] Dashboard: Remove log; it's not super useful
- [ ] Dashboard: Remove framing; can just have horizontal rules between sections on screen
- [ ] Dashboard: Add command input at bottom
- [ ] TUI library: Make sure we're only redrawing changed parts of the screen
- [ ] TUI library: More efficient (batched) textToRaster function?
- [ ] TUI library: Improve efficiency of component framework by memoizing trivially memoizable stuff
- [ ] TUI library: Unit tests for all changes!!

## 2025-10-29

### Dummy Batteries

Following Stewie's example, I ordered a couple of these: https://www.amazon.com/dp/B09YTVTZ1V
Installed one into 58-BD-A3-AC-20-AD, and it seems to be working.
Installed one into 00-21-BD-D1-5C-A9, and it seems to be working, too!

### Controlling MultiOscity

I always have to look up 'how to tell multioscify what to do'.

What you need to do is, once the WBB is connected and has a `/dev/input` device,
and you have decided where you want OSC packets to go, do something like:

```
mosquitto_pub -h localhost -t smp/multioscify1/readers/wbb01/target/set -m osc+udp://192.168.9.151:5577/wbb01
mosquitto_pub -h localhost -t smp/multioscify1/readers/wbb01/inputpath/set -m /dev/input/event13
```

This should be automated somehow, I suppose.

### Notes on WBBConnector

Gets stuck at `getting-device-handle` if you just push the button in front
(this may be a matter of needing another `statusUpdated` call).

Once the devices are connected, the status checks that happen every few seconds are 'noisy'.
By which I mean I can actually hear them happening due to the radio waves
messing with the signals to my amplifier, just like how mocing my mouse is audible.

It might be nice if it backed off for a while, or maybe if the connection interval
could be controlled via MQTT.

Not sure where this orchestration should happen.
I suppose dashboard should have ways to do all the
things that would otherwise have to be done manually,
since it is the dashboard.
