//! Earliest ARM card entry indication, then ordinary firmware GPIO ownership.
use crate::{
    Generation, Recipe, green_led,
    image::{self, Result, extent, put, require, word},
};
use green_led::initialization::Write;
use serde::Deserialize;

const PROGRAM: &[u8] = include_bytes!("../assets/early-led-arm.generated.bin");
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Layout {
    schema: u32,
    size: usize,
    config: usize,
    capacity: usize,
    resume: usize,
}

fn program(writes: &[Write], instruction: u32, target: u32, literal: u32) -> Result<Vec<u8>> {
    let layout: Layout =
        serde_json::from_str(include_str!("../assets/early-led-arm.generated.json"))
            .map_err(|e| image::Error::Invalid(e.to_string()))?;
    require(
        layout.schema == 1
            && layout.size == PROGRAM.len()
            && layout.capacity == 24
            && layout.resume + 16 <= layout.config
            && layout.config + 292 <= PROGRAM.len()
            && !writes.is_empty()
            && writes.len() <= layout.capacity,
        "Invalid early LED layout",
    )?;
    require(
        extent(PROGRAM, layout.config, 292)?.iter().all(|b| *b == 0),
        "Early LED configuration is occupied",
    )?;
    let mut bytes = PROGRAM.to_vec();
    put(&mut bytes, layout.config, writes.len() as u32)?;
    for (i, w) in writes.iter().enumerate() {
        require(
            w.address >= 0xf0000000 && w.address < 0xfffff000 && w.address.is_multiple_of(4),
            "Invalid early LED register",
        )?;
        for (j, value) in [w.address, w.clear, w.value].into_iter().enumerate() {
            put(&mut bytes, layout.config + 4 + i * 12 + j * 4, value)?;
        }
    }
    put(&mut bytes, layout.resume, instruction)?;
    put(&mut bytes, layout.resume + 8, target)?;
    put(&mut bytes, layout.resume + 12, literal)?;
    Ok(bytes)
}

/// Install into the uninitialized gap before application RAM. No stack is needed.
/// Stock GPIO initialization and endpoint writers retain ownership after entry.
pub fn image(recipe: &Recipe, source: &[u8], ram: &mut [u8]) -> Result<(usize, usize)> {
    require(
        matches!(recipe.generation, Generation::Exr2 | Generation::Xpp),
        "RAM LED entry requires EXR II or X-Processor Pro",
    )?;
    let writes = green_led::verified_writes(recipe, source)?;
    let plan = recipe
        .plan
        .as_ref()
        .ok_or_else(|| image::Error::Invalid("Missing RAM plan".into()))?;
    require(
        plan.entry == 0 && word(ram, 0)? == 0xe59ff018,
        "Changed ARM reset vector",
    )?;
    let target = word(ram, 0x20)?;
    let loader = plan
        .regions
        .iter()
        .find(|r| r.address == 0)
        .ok_or_else(|| image::Error::Invalid("Missing reset loader".into()))?;
    let original = loader.source.read(&fujimod_firmware::invert(source))?;
    require(
        word(&original, 0)? == word(ram, 0)?
            && word(&original, 0x20)? == target
            && (target as usize) < original.len(),
        "Changed stock reset target",
    )?;
    let at = 0x103000;
    let end = at + PROGRAM.len();
    require(
        plan.regions
            .iter()
            .all(|r| end <= r.address || r.address + r.source.decoded_size <= at)
            && plan
                .bss
                .iter()
                .all(|r| end <= r.address || r.address + r.size <= at)
            && extent(ram, at, PROGRAM.len())?.iter().all(|b| *b == 0),
        "Early LED reservation overlaps firmware",
    )?;
    let bytes = program(&writes, 0xe1a00000, target, 0)?;
    green_led::preserve_loader_green(recipe, source, ram)?;
    ram[at..end].copy_from_slice(&bytes);
    put(ram, 0x20, at as u32)?;
    Ok((at, bytes.len()))
}

/// Wrap a compiled first-stage branch (or the EXR initial literal load).
/// Keep the original instruction's effect and preserve incoming registers/flags.
pub(crate) fn stage(
    recipe: &Recipe,
    source: &[u8],
    bytes: &mut Vec<u8>,
    base: u32,
    entry: usize,
    limit: usize,
) -> Result<()> {
    let writes = green_led::verified_writes(recipe, source)?;
    let at = (bytes.len() + 3) & !3;
    require(
        at + PROGRAM.len() <= limit,
        "Early LED exceeds first-stage reservation",
    )?;
    let first = word(bytes, entry)?;
    let (instruction, target, literal) = if first >> 24 == 0xea {
        let delta = ((first & 0xffffff) as i32) << 8 >> 6;
        let offset = entry as i64 + 8 + i64::from(delta);
        require(
            offset >= 0 && (offset as usize) < bytes.len(),
            "First-stage branch escapes image",
        )?;
        (0xe1a00000, base.wrapping_add(offset as u32), 0)
    } else {
        require(
            matches!(recipe.generation, Generation::Exr | Generation::ExrPro)
                && entry == 0
                && first & 0xfffff000 == 0xe59f0000,
            "Changed first-stage entry",
        )?;
        (
            0xe59f0004,
            base.wrapping_add(4),
            word(bytes, 8 + (first & 0xfff) as usize)?,
        )
    };
    let program = program(&writes, instruction, target, literal)?;
    bytes.resize(at, 0);
    bytes.extend_from_slice(&program);
    require(at < 0x2000000, "Early LED branch exceeds ARM range")?;
    let delta = at as i64 - entry as i64 - 8;
    require(
        (-0x2000000..0x2000000).contains(&delta),
        "Early LED branch exceeds ARM range",
    )?;
    put(bytes, entry, 0xea000000 | ((delta >> 2) as u32 & 0xffffff))
}
