import evdev
from os import listdir
from os.path import isdir, join

input_dev_paths = [f for f in [join("/dev/input", fn) for fn in listdir("/dev/input") if fn.startswith("event")] if isdir(f) == False]
for devpath in input_dev_paths:
    print(devpath+":")
    try:
        dev = evdev.InputDevice(devpath)
        print("  name: "+dev.name)
        print("  uniq: "+dev.uniq)
        print("  phys: "+dev.phys)
    except:
        print("  (error reading)")
