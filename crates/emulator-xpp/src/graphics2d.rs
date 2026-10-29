//! X-Processor Pro 2D graphics accelerator register interface.
//!
//! Provides blit trigger registers, timed completion status and level interrupt handling.
use fujimod_emulator_devices::{Cx, Device};
use serde_json::{Value, json};

/// Register window size in bytes.
pub const REGISTERS: u64 = 0x3000;

/// Functional guest ticks for 2D blit completion (allows caller thread to suspend).
pub const BLIT_TICKS: u64 = 200;

const STATUS_COMPLETE: u32 = 0x8000_0000;
const STATUS_SECONDARY: u32 = 0x4000_0000;
const STATUS_BUSY: u32 = 0x0400_0000;

pub struct Graphics2d {
    base: u64,
    irq: u32,
    status: u32,
    pending_status: u32,
    next: Option<u64>,
    registers: Vec<u32>,
}

impl Graphics2d {
    pub fn new(base: u64, irq: u32) -> Result<Self, String> {
        if base & 0xfff != 0 || !(32..512).contains(&irq) {
            return Err("Invalid X-Processor Pro 2D graphics accelerator wiring".into());
        }
        Ok(Self {
            base,
            irq,
            status: 0,
            pending_status: 0,
            next: None,
            registers: vec![0; (REGISTERS / 4) as usize],
        })
    }

    fn update_irq(&self, cx: &mut Cx<'_>) {
        let active = (self.status & (STATUS_COMPLETE | STATUS_SECONDARY | STATUS_BUSY)) != 0;
        cx.set_irq(self.irq, active);
    }

    fn trigger(&mut self, cx: &mut Cx<'_>, flag: u32) {
        self.pending_status |= flag;
        let due = cx.now() + BLIT_TICKS;
        self.next = Some(due);
        cx.schedule(due, 0);
    }
}

impl Device for Graphics2d {
    fn name(&self) -> &'static str {
        "xpp-graphics-2d"
    }

    fn read(&mut self, cx: &mut Cx<'_>, address: u64, size: u8) -> u64 {
        let o = address - self.base;
        if size != 4 || o & 3 != 0 || o + 4 > REGISTERS {
            cx.unmodeled();
            return 0;
        }
        match o {
            0x34 => u64::from(self.status),
            0x58 => 0, // Busy register: 0 indicates idle / not busy
            _ => u64::from(self.registers[(o / 4) as usize]),
        }
    }

    fn write(&mut self, cx: &mut Cx<'_>, address: u64, size: u8, value: u64) {
        let o = address - self.base;
        if size != 4 || o & 3 != 0 || o + 4 > REGISTERS {
            cx.unmodeled();
            return;
        }
        let val32 = value as u32;
        self.registers[(o / 4) as usize] = val32;

        match o {
            0x10d0 | 0x10e0 | 0x20f0 => {
                // Blit trigger channel 0/1/general
                self.trigger(cx, STATUS_COMPLETE);
            }
            0x1800 | 0x1020 => {
                // Acknowledge completion
                self.status &= !STATUS_COMPLETE;
                self.update_irq(cx);
            }
            0xc18 => {
                if val32 != 0 {
                    self.trigger(cx, STATUS_SECONDARY);
                } else {
                    self.status &= !STATUS_SECONDARY;
                    self.update_irq(cx);
                }
            }
            0x1c => {
                if val32 != 0 {
                    self.trigger(cx, STATUS_BUSY);
                } else {
                    self.status &= !STATUS_BUSY;
                    self.update_irq(cx);
                }
            }
            _ => {}
        }
    }

    fn event(&mut self, cx: &mut Cx<'_>, _: u64) {
        if let Some(due) = self.next
            && due <= cx.now()
        {
            self.status |= self.pending_status;
            self.pending_status = 0;
            self.next = None;
            self.update_irq(cx);
        }
    }

    fn next_deadline(&self, _: u64) -> Option<u64> {
        self.next
    }

    fn save(&self) -> Value {
        json!({
            "status": self.status,
            "pending_status": self.pending_status,
            "next": self.next,
            "registers": self.registers,
        })
    }

    fn restore(&mut self, value: &Value) -> Result<(), String> {
        self.status = serde_json::from_value(value["status"].clone()).map_err(|e| e.to_string())?;
        self.pending_status =
            serde_json::from_value(value["pending_status"].clone()).map_err(|e| e.to_string())?;
        self.next = serde_json::from_value(value["next"].clone()).map_err(|e| e.to_string())?;
        let registers: Vec<u32> =
            serde_json::from_value(value["registers"].clone()).map_err(|e| e.to_string())?;
        if registers.len() != self.registers.len() {
            return Err("X-Processor Pro 2D graphics checkpoint size differs".into());
        }
        self.registers = registers;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fujimod_emulator_devices::test_host::{TestHost, read, write};

    #[test]
    fn trigger_schedules_completion_and_holds_level_irq_until_acknowledged() {
        let base = 0xfff88000;
        let mut g = Graphics2d::new(base, 92).unwrap();
        let mut h = TestHost::new();

        assert_eq!(read(&mut g, &mut h, base + 0x34), 0);
        assert_eq!(read(&mut g, &mut h, base + 0x58), 0);

        // Writing to trigger 0x10d0 schedules completion at now + BLIT_TICKS
        write(&mut g, &mut h, base + 0x10d0, 1);
        assert_eq!(g.next_deadline(0), Some(BLIT_TICKS));
        assert_eq!(read(&mut g, &mut h, base + 0x34), 0); // Not complete yet

        // Advance to deadline and fire event -> line goes HIGH
        h.now = BLIT_TICKS;
        let mut cx = h.cx();
        g.event(&mut cx, 0);
        assert_eq!(read(&mut g, &mut h, base + 0x34), u64::from(STATUS_COMPLETE));
        assert_eq!(h.irqs, vec![(0, 92)]);

        // Clear via 0x1800 -> line goes LOW
        write(&mut g, &mut h, base + 0x1800, 0);
        assert_eq!(read(&mut g, &mut h, base + 0x34), 0);
        assert_eq!(h.effects.last(), Some(&"irq-low"));

        // Writing to 0x1c triggers busy flag
        write(&mut g, &mut h, base + 0x1c, 0xf100201);
        assert_eq!(g.next_deadline(BLIT_TICKS), Some(BLIT_TICKS * 2));
        h.now = BLIT_TICKS * 2;
        let mut cx = h.cx();
        g.event(&mut cx, 0);
        assert_eq!(read(&mut g, &mut h, base + 0x34), u64::from(STATUS_BUSY));

        // Clear via 0x1c with 0 -> line goes LOW
        write(&mut g, &mut h, base + 0x1c, 0);
        assert_eq!(read(&mut g, &mut h, base + 0x34), 0);
        assert_eq!(h.effects.last(), Some(&"irq-low"));
    }

    #[test]
    fn checkpoint_preserves_status_and_schedule() {
        let base = 0xfff88000;
        let mut g = Graphics2d::new(base, 92).unwrap();
        let mut h = TestHost::new();

        write(&mut g, &mut h, base + 0x1214, 0x12345678);
        write(&mut g, &mut h, base + 0x10d0, 1);
        assert_eq!(g.next_deadline(0), Some(BLIT_TICKS));

        let saved = g.save();
        let mut resumed = Graphics2d::new(base, 92).unwrap();
        resumed.restore(&saved).unwrap();

        assert_eq!(resumed.next_deadline(0), Some(BLIT_TICKS));
        assert_eq!(read(&mut resumed, &mut h, base + 0x1214), 0x12345678);
    }
}
