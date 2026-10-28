//! X-Processor Pro display timing output: a discovery frame clock.
//!
//! Each output block retains register writes. Writing control word +0 with
//! bit 16 clear starts a frame clock; while bit 16 stays clear the output
//! pulses its frame interrupt every `frame_ticks`. Firmware subscribes
//! frame callbacks and waits for the first one after clearing bit 16. Pixel
//! timing, scanout and status registers are not modeled.
use fujimod_emulator_devices::{Cx, Device};
use serde_json::{Value, json};

/// Register window size in bytes.
pub const REGISTERS: u64 = 0x1000;
const HOLD: u32 = 1 << 16;

pub struct VideoTiming {
    base: u64,
    irq: u32,
    frame_ticks: u64,
    registers: Vec<u32>,
    next: Option<u64>,
}

impl VideoTiming {
    pub fn new(base: u64, irq: u32, frame_ticks: u64) -> Result<Self, String> {
        if base & 0xfff != 0 || frame_ticks == 0 {
            return Err("Invalid X-Processor Pro video timing output".into());
        }
        Ok(Self {
            base,
            irq,
            frame_ticks,
            registers: vec![0; (REGISTERS / 4) as usize],
            next: None,
        })
    }
    fn running(&self) -> bool {
        self.next.is_some()
    }
}

impl Device for VideoTiming {
    fn name(&self) -> &'static str {
        "xpp-video-timing"
    }
    fn read(&mut self, cx: &mut Cx<'_>, address: u64, size: u8) -> u64 {
        let o = address - self.base;
        if size != 4 || o & 3 != 0 {
            cx.unmodeled();
            return 0;
        }
        u64::from(self.registers[(o / 4) as usize])
    }
    fn write(&mut self, cx: &mut Cx<'_>, address: u64, size: u8, value: u64) {
        let o = address - self.base;
        if size != 4 || o & 3 != 0 {
            cx.unmodeled();
            return;
        }
        self.registers[(o / 4) as usize] = value as u32;
        if o == 0 {
            if value as u32 & HOLD == 0 {
                if !self.running() {
                    let due = cx.now() + self.frame_ticks;
                    self.next = Some(due);
                    cx.schedule(due, 0);
                }
            } else {
                self.next = None;
            }
        }
    }
    fn event(&mut self, cx: &mut Cx<'_>, _: u64) {
        if let Some(due) = self.next
            && due <= cx.now()
        {
            cx.set_irq(self.irq, true);
            cx.set_irq(self.irq, false);
            let next = due + self.frame_ticks;
            self.next = Some(next);
            cx.schedule(next, 0);
        }
    }
    fn next_deadline(&self, _: u64) -> Option<u64> {
        self.next
    }
    fn save(&self) -> Value {
        json!({ "registers": self.registers, "next": self.next })
    }
    fn restore(&mut self, value: &Value) -> Result<(), String> {
        let registers: Vec<u32> =
            serde_json::from_value(value["registers"].clone()).map_err(|e| e.to_string())?;
        if registers.len() != self.registers.len() {
            return Err("X-Processor Pro video timing checkpoint size differs".into());
        }
        self.registers = registers;
        self.next = serde_json::from_value(value["next"].clone()).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fujimod_emulator_devices::test_host::{TestHost, read, write};

    #[test]
    fn clearing_hold_bit_schedules_frames_and_setting_hold_stops() {
        let base = 0xfff5a000;
        let mut v = VideoTiming::new(base, 112, 1000).unwrap();
        let mut h = TestHost::new();

        assert_eq!(v.next_deadline(0), None);

        // Writing with HOLD set keeps it stopped
        write(&mut v, &mut h, base, HOLD);
        assert_eq!(v.next_deadline(0), None);

        // Writing with HOLD clear starts the frame clock
        write(&mut v, &mut h, base, 0);
        assert_eq!(v.next_deadline(0), Some(1000));
        assert_eq!(read(&mut v, &mut h, base), 0);

        // Advance to deadline and fire event
        h.now = 1000;
        let mut cx = h.cx();
        v.event(&mut cx, 0);
        assert_eq!(v.next_deadline(1000), Some(2000));

        // Setting HOLD bit cancels the schedule
        write(&mut v, &mut h, base, HOLD);
        assert_eq!(v.next_deadline(1000), None);
    }

    #[test]
    fn checkpoint_restores_running_schedule_and_registers() {
        let base = 0xfff65000;
        let mut v = VideoTiming::new(base, 117, 500).unwrap();
        let mut h = TestHost::new();

        write(&mut v, &mut h, base, 0);
        write(&mut v, &mut h, base + 4, 0x12345678);
        assert_eq!(v.next_deadline(0), Some(500));

        let saved = v.save();
        let mut resumed = VideoTiming::new(base, 117, 500).unwrap();
        resumed.restore(&saved).unwrap();
        assert_eq!(resumed.save(), saved);
        assert_eq!(resumed.next_deadline(0), Some(500));
        assert_eq!(read(&mut resumed, &mut h, base + 4), 0x12345678);
    }
}

