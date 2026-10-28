//! Preloaded startup outputs and a separate native-filesystem data image.
use super::sd_loader;
use crate::{
    Proof,
    image::{self, Edit, Plan, Result, Source, extent, hash, put, require, word},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadRange {
    pub name: String,
    pub offset: usize,
    pub address: Option<usize>,
    pub source: Source,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootDefaults {
    pub address: usize,
    pub size: usize,
    pub flag: usize,
    pub initialize: Proof,
    pub calls: Vec<Proof>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeFile {
    pub table_cell: usize,
    pub table_address: usize,
    pub drive_map: usize,
    pub open: Proof,
    pub read: Proof,
    pub seek: Proof,
    pub close: Proof,
    pub create_semaphore: Proof,
    pub wait_semaphore: Proof,
    pub signal_semaphore: Proof,
}

impl NativeFile {
    fn routines(&self) -> [&Proof; 7] {
        [
            &self.open,
            &self.read,
            &self.seek,
            &self.close,
            &self.create_semaphore,
            &self.wait_semaphore,
            &self.signal_semaphore,
        ]
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preload {
    pub address_limit: usize,
    pub enabled_byte: usize,
    pub byte_limit: usize,
    pub byte_reader: Proof,
    pub indexed_reader: Proof,
    pub cache_maintenance: Proof,
    pub discards: Vec<Proof>,
    pub resources: Vec<Proof>,
    pub witnesses: Vec<Proof>,
    pub edits: Vec<Edit>,
    pub placements: Vec<image::Region>,
    pub ranges: Vec<ReadRange>,
    pub exclusions: Vec<image::Bss>,
    pub defaults: BootDefaults,
    pub native_file: NativeFile,
}

fn branch(at: usize, target: usize, link: bool) -> Result<u32> {
    let delta = target as i64 - at as i64 - 8;
    require(
        delta % 4 == 0 && (-0x2000000..0x2000000).contains(&delta),
        "Preloaded hook is outside ARM branch range",
    )?;
    Ok((if link { 0xeb000000 } else { 0xea000000 }) | ((delta >> 2) as u32 & 0xffffff))
}

impl Preload {
    pub fn install(
        &self,
        inverted: &[u8],
        plan: &Plan,
        dat_offset: usize,
        ram: &mut Vec<u8>,
    ) -> Result<Vec<u8>> {
        let layout = &sd_loader::LAYOUT.preloaded;
        let program_base = layout.address;
        let program_bytes = extent(sd_loader::IMAGE, layout.offset, layout.size)?;
        require(
            self.ranges.len() <= 16
                && !self.ranges.is_empty()
                && matches!(self.discards.len(), 1 | 3)
                && self.resources.len() == 2,
            "Incomplete preloaded data/transfer map",
        )?;
        require(
            self.byte_limit > 0
                && self.byte_limit <= 0x8000000
                && self.address_limit <= u32::MAX as usize,
            "Invalid mapping address bounds",
        )?;
        for view in &self.exclusions {
            require(
                view.address
                    .checked_add(view.size)
                    .is_some_and(|end| end <= self.address_limit),
                "Startup working view exceeds declared RAM",
            )?;
        }
        // Verify every original routine/table before applying any modifications.
        for proof in self
            .witnesses
            .iter()
            .chain([
                &self.byte_reader,
                &self.indexed_reader,
                &self.cache_maintenance,
            ])
            .chain(self.discards.iter())
            .chain(self.resources.iter())
            .chain(self.native_file.routines())
            .chain([&self.defaults.initialize])
            .chain(self.defaults.calls.iter())
        {
            hash(extent(ram, proof.address, proof.size)?, &proof.sha256)?;
        }
        let mut placed = plan.clone();
        placed.regions.extend(self.placements.clone());
        let mut ranges = Vec::new();
        let mut file = Vec::new();
        for mapping in &self.ranges {
            let size = mapping.source.decoded_size;
            require(
                mapping.source.size == size
                    && mapping.source.initialized_prefix.is_none()
                    && matches!(mapping.source.compression, image::Compression::Raw)
                    && dat_offset.checked_add(mapping.offset) == Some(mapping.source.dat_offset),
                "Read-map source does not match its firmware offset",
            )?;
            require(
                !ranges.iter().any(|&(offset, _, amount, _)| {
                    mapping.offset < offset + amount && offset < mapping.offset.saturating_add(size)
                }),
                "Read-map firmware offsets overlap",
            )?;
            let address = mapping.address.unwrap_or(0);
            require(
                mapping.address != Some(0)
                    && size > 0
                    && (address == 0
                        || address
                            .checked_add(size)
                            .is_some_and(|end| end <= self.address_limit))
                    && mapping
                        .offset
                        .checked_add(size)
                        .is_some_and(|end| end <= self.byte_limit + 0x20000),
                "Read-map range exceeds declared bounds",
            )?;
            require(
                address == 0
                    || !self
                        .exclusions
                        .iter()
                        .any(|b| address < b.address + b.size && b.address < address + size),
                "Preplaced input overlaps a startup working view",
            )?;
            let file_offset = if address != 0 {
                placed.regions.push(image::Region {
                    name: mapping.name.clone(),
                    address,
                    source: mapping.source.clone(),
                });
                placed.size = placed.size.max(address + size);
                0
            } else {
                let bytes = extent(inverted, mapping.source.dat_offset, size)?;
                hash(bytes, &mapping.source.sha256)?;
                let offset = file.len();
                file.extend_from_slice(bytes);
                offset
            };
            ranges.push((mapping.offset, address, size, file_offset));
        }
        let defaults = self
            .ranges
            .iter()
            .filter(|r| r.offset == 0xc0000)
            .collect::<Vec<_>>();
        require(
            defaults.len() == 1
                && defaults[0].address.is_none()
                && defaults[0].source.decoded_size == self.defaults.size
                && !self.defaults.calls.is_empty(),
            "Incomplete startup-defaults lifetime",
        )?;
        let end = self
            .defaults
            .address
            .checked_add(self.defaults.size)
            .ok_or_else(|| image::Error::Invalid("Startup defaults overflow".into()))?;
        require(
            end <= self.address_limit
                && !self
                    .exclusions
                    .iter()
                    .any(|b| self.defaults.address < b.address + b.size && b.address < end),
            "Startup defaults overlap an active working view",
        )?;
        placed.regions.push(image::Region {
            name: "startup defaults staging".into(),
            address: self.defaults.address,
            source: defaults[0].source.clone(),
        });
        placed.size = placed.size.max(end);
        // The image transform checks every source hash and all initialized/BSS
        // intersections, including fixed destinations and mapping inputs.
        let mut result = image::transform(inverted, &placed)?;
        require(
            extent(&result, program_base, layout.size)?
                .iter()
                .all(|b| *b == 0),
            "Preloaded program reservation is occupied",
        )?;
        require(
            !placed.bss.iter().any(|b| {
                program_base < b.address + b.size && b.address < program_base + layout.size
            }),
            "Preloaded program overlaps BSS",
        )?;
        let mut program = program_bytes.to_vec();
        let config = layout.symbols["preloaded_config"];
        for (index, value) in [
            self.enabled_byte,
            self.byte_limit,
            ranges.len(),
            self.cache_maintenance.address,
            self.defaults.initialize.address,
            self.defaults.flag,
            self.defaults.address,
            self.defaults.size,
            self.native_file.table_cell,
            self.native_file.table_address,
            self.native_file.open.address,
            self.native_file.read.address,
            self.native_file.seek.address,
            self.native_file.close.address,
            self.native_file.create_semaphore.address,
            self.native_file.wait_semaphore.address,
            self.native_file.signal_semaphore.address,
            self.address_limit,
            program_base,
            layout.size,
            self.native_file.drive_map,
        ]
        .into_iter()
        .enumerate()
        {
            put(
                &mut program,
                config + index * 4,
                u32::try_from(value)
                    .map_err(|_| image::Error::Invalid("Read-map config overflows ARM32".into()))?,
            )?;
        }
        for (index, &(offset, address, size, file_offset)) in ranges.iter().enumerate() {
            for (column, value) in [offset, address, size, file_offset].into_iter().enumerate() {
                put(
                    &mut program,
                    config + 84 + index * 16 + column * 4,
                    value as u32,
                )?;
            }
        }
        result[program_base..program_base + layout.size].copy_from_slice(&program);
        for site in &self.defaults.calls {
            require(
                site.size == 4
                    && word(&result, site.address)?
                        == branch(site.address, self.defaults.initialize.address, true)?,
                "Startup-defaults caller target differs",
            )?;
            put(
                &mut result,
                site.address,
                branch(
                    site.address,
                    program_base + layout.symbols["preloaded_initialize_configuration"],
                    true,
                )?,
            )?;
        }
        for site in &self.discards {
            let old = word(&result, site.address)?;
            require(
                site.size == 4 && old >> 24 == 0xeb,
                "Discarded transfer is not a direct call",
            )?;
            let target = site.address as i64 + 8 + (((old & 0xffffff) as i32) << 8 >> 6) as i64;
            require(
                target == self.indexed_reader.address as i64,
                "Discarded transfer calls another reader",
            )?;
            put(
                &mut result,
                site.address,
                branch(
                    site.address,
                    program_base + layout.symbols["preloaded_discard"],
                    true,
                )?,
            )?;
        }
        for proof in &self.resources {
            put(
                &mut result,
                proof.address,
                branch(
                    proof.address,
                    program_base + layout.symbols["preloaded_discard"],
                    false,
                )?,
            )?;
        }
        for (proof, symbol) in [
            (&self.byte_reader, "preloaded_bytes"),
            (&self.indexed_reader, "preloaded_indexed"),
        ] {
            put(
                &mut result,
                proof.address,
                branch(proof.address, program_base + layout.symbols[symbol], false)?,
            )?;
        }
        for edit in &self.edits {
            require(
                word(&result, edit.address)? == edit.old,
                "Preload selection old word differs",
            )?;
            put(&mut result, edit.address, edit.new)?;
        }
        *ram = result;
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Preload, Vec<u8>, Plan, Vec<u8>) {
        let mut input = vec![0x5a; 0xe0000];
        let mut regions = Vec::new();
        for (index, address) in [
            0x100, 0x104, 0x108, 0x10c, 0x200, 0x300, 0x400, 0x500, 0x600, 0x700,
        ]
        .into_iter()
        .enumerate()
        {
            let at = index * 4;
            let instruction = if address < 0x200 {
                branch(address, if address == 0x10c { 0x700 } else { 0x500 }, true).unwrap()
            } else {
                0xe12fff1e
            };
            put(&mut input, at, instruction).unwrap();
            regions.push(image::Region {
                name: format!("code-{address:x}"),
                address,
                source: Source {
                    dat_offset: at,
                    size: 4,
                    decoded_size: 4,
                    compression: image::Compression::Raw,
                    sha256: fujimod_firmware::sha256(&input[at..at + 4]),
                    initialized_prefix: None,
                },
            });
        }
        let plan = Plan {
            size: 0x200000,
            entry: 0x100,
            regions,
            bss: vec![],
            edits: vec![],
        };
        let ram = image::transform(&input, &plan).unwrap();
        let proof = |address| Proof {
            address,
            size: 4,
            sha256: fujimod_firmware::sha256(&ram[address..address + 4]),
        };
        let preload = Preload {
            address_limit: 0x1000000,
            enabled_byte: 0x800,
            byte_limit: 0x300000,
            byte_reader: proof(0x400),
            indexed_reader: proof(0x500),
            cache_maintenance: proof(0x600),
            discards: [0x100, 0x104, 0x108].into_iter().map(proof).collect(),
            resources: [0x200, 0x300].into_iter().map(proof).collect(),
            witnesses: vec![],
            edits: vec![],
            placements: vec![],
            ranges: vec![ReadRange {
                name: "configuration defaults".into(),
                offset: 0xc0000,
                address: None,
                source: Source {
                    dat_offset: 0xc0000,
                    size: 0x20000,
                    decoded_size: 0x20000,
                    compression: image::Compression::Raw,
                    sha256: fujimod_firmware::sha256(&input[0xc0000..]),
                    initialized_prefix: None,
                },
            }],
            exclusions: vec![image::Bss {
                name: "working view".into(),
                address: 0x200000,
                size: 0x10000,
            }],
            defaults: BootDefaults {
                address: 0x210000,
                size: 0x20000,
                flag: 0x800,
                initialize: proof(0x700),
                calls: vec![proof(0x10c)],
            },
            native_file: NativeFile {
                table_cell: 0x900,
                table_address: 0x1000,
                drive_map: 0x904,
                open: proof(0x600),
                read: proof(0x600),
                seek: proof(0x600),
                close: proof(0x600),
                create_semaphore: proof(0x600),
                wait_semaphore: proof(0x600),
                signal_semaphore: proof(0x600),
            },
        };
        (preload, input, plan, ram)
    }

    #[test]
    fn keeps_demand_data_outside_ram_and_places_only_transient_defaults() {
        let (preload, input, plan, mut ram) = fixture();
        let data = preload.install(&input, &plan, 0, &mut ram).unwrap();
        let config = sd_loader::LAYOUT.preloaded.address
            + sd_loader::LAYOUT.preloaded.symbols["preloaded_config"];
        assert_eq!(word(&ram, config + 8).unwrap(), 1);
        assert_eq!(word(&ram, config + 84 + 4).unwrap(), 0);
        assert_eq!(word(&ram, config + 84 + 12).unwrap(), 0);
        assert_eq!(data, input[0xc0000..]);
        assert_eq!(ram.len(), 0x230000);
        assert_eq!(&ram[0x210000..], &input[0xc0000..]);
        assert_eq!(word(&ram, 0x100).unwrap() >> 24, 0xeb);
        assert_eq!(word(&ram, 0x200).unwrap() >> 24, 0xea);
        assert_eq!(word(&ram, 0x154).unwrap(), 0);
    }

    #[test]
    fn changed_calls_and_sources_refuse_without_mutating_the_image() {
        let (preload, mut input, plan, mut ram) = fixture();
        input[0xc0000] ^= 1;
        let original = ram.clone();
        assert!(preload.install(&input, &plan, 0, &mut ram).is_err());
        assert_eq!(ram, original);
        let (preload, input, plan, mut ram) = fixture();
        ram[0x100] ^= 1;
        let original = ram.clone();
        assert!(preload.install(&input, &plan, 0, &mut ram).is_err());
        assert_eq!(ram, original);
    }

    #[test]
    fn wrong_namespace_bias_and_overlapping_or_escaping_ranges_refuse() {
        let (preload, input, plan, ram) = fixture();
        assert!(preload.install(&input, &plan, 4, &mut ram.clone()).is_err());
        for address in [0x100, 0x200000, usize::MAX] {
            let mut changed = preload.clone();
            changed.defaults.address = address;
            assert!(changed.install(&input, &plan, 0, &mut ram.clone()).is_err());
        }
        let mut changed = preload.clone();
        changed.ranges.push(changed.ranges[0].clone());
        assert!(changed.install(&input, &plan, 0, &mut ram.clone()).is_err());
    }
}
