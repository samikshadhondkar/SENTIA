import math
import wave
import struct

sample_rate = 22050
freq = 880.0
seconds = 1.0
frames = int(sample_rate * seconds)
amp = 32767

with wave.open('assets/audio/alarm.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sample_rate)
    for i in range(frames):
        t = i / sample_rate
        env = 0.8 if (i % 220) < 110 else 0.2
        sample = int(amp * env * math.sin(2 * math.pi * freq * t))
        w.writeframesraw(struct.pack('<h', sample))
print('created assets/audio/alarm.wav')
