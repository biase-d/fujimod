use super::*;
fn pair(words: &mut Vec<u32>, index: u16, value: u32) {
    words.extend([value, 0xf0000 | index as u32]);
}
fn packed(v: Vector) -> [u32; 3] {
    let f = v.map(|f| {
        let b = f.to_bits();
        if b & 0x7fffffff == 0 {
            0
        } else {
            ((b >> 31) << 23) | (((b >> 23 & 255) - 64) << 16) | (b >> 7 & 65535)
        }
    });
    [
        (f[2] >> 16) | (f[3] << 8),
        (f[1] >> 8 & 65535) | (f[2] << 16),
        f[0] | (f[1] << 24),
    ]
}
fn upload(words: &mut Vec<u32>, index: u16, data: &[u32], increment: bool) {
    words.push(data[0]);
    words.push(
        (if increment { 1 << 31 } else { 0 })
            | ((data.len() as u32 - 1) << 20)
            | 0xf0000
            | index as u32,
    );
    words.extend_from_slice(&data[1..]);
    if data.len() % 2 == 0 {
        words.push(0xa5a5a5a5);
    }
}
fn setup() -> Vec<u32> {
    let mut words = Vec::new();
    for (r, v) in [
        (0x250, 0x03020100),
        (0x251, 0x0b0a0908),
        (0x252, 0x0f0e0d0c),
        (0x253, 0x1f1f1f1f),
        (0x254, 0x1f1f1f1f),
        (0x255, 0x1f1f1f1f),
        (0x256, 0x1f1f1f1f),
        (0x241, 0x430000),
        (0x243, 0x430000),
        (0x24d, 0x3f0000),
        (0x24e, 0x3f0000),
        (0x267, 0x001f001f),
        (0x31e, 0x00200020),
        (0x31d, 0x10000),
        (0x307, 0xf00),
        (0x300, 0x100),
        (0x301, 0x01010000),
        (0x402, 1 << 28),
        (0x48b, 0x10),
        (0x432, 15),
        (0x49b, 0),
        (0x4a5, 0),
    ] {
        pair(&mut words, r, v);
    }
    upload(
        &mut words,
        0x49c,
        &[0x4c000000, 0x4c201000, 0x88000000],
        false,
    );
    upload(&mut words, 0x4a6, &[0x8d86c36f], false);
    words
}
#[test]
fn uploaded_mov_program_draws_triangle_with_exact_top_left_coverage() {
    let mut words = setup();
    for position in [
        [-0.75, -0.75, 0., 1.],
        [0.75, -0.75, 0., 1.],
        [0., 0.75, 0., 1.],
    ] {
        upload(&mut words, 0x433, &packed(position), true);
        upload(&mut words, 0x433, &packed([1., 0., 0., 1.]), true);
    }
    let writes = Engine::default()
        .execute(&words, &mut |a, n| {
            assert_eq!(a, 0x10000);
            Ok(vec![0; n])
        })
        .unwrap();
    assert_eq!(writes.len(), 1);
    let bytes = &writes[0].1;
    assert_eq!(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| **p == [255, 0, 0, 255])
            .count(),
        288
    );
    assert!(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| *p == [0; 4] || *p == [255, 0, 0, 255])
    );
}

#[test]
fn unused_nonfinite_uniform_words_survive_upload_checkpoint_and_draw() {
    let mut words = setup();
    pair(&mut words, 0x490, 0x80000006);
    for value in [0x3f800000, 0x7fffffff, 0x7fffffff, 0x00001d00] {
        pair(&mut words, 0x491, value);
    }
    for position in [
        [-0.75, -0.75, 0., 1.],
        [0.75, -0.75, 0., 1.],
        [0., 0.75, 0., 1.],
    ] {
        upload(&mut words, 0x433, &packed(position), true);
        upload(&mut words, 0x433, &packed([1., 0., 0., 1.]), true);
    }

    let mut engine = Engine::default();
    let writes = engine
        .execute(&words, &mut |a, n| {
            assert_eq!(a, 0x10000);
            Ok(vec![0; n])
        })
        .unwrap();
    assert_eq!(
        engine.uniforms[6],
        [0x00001d00, 0x7fffffff, 0x7fffffff, 0x3f800000]
    );
    assert_eq!(
        writes[0]
            .1
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| **p == [255, 0, 0, 255])
            .count(),
        288
    );

    let checkpoint = serde_json::to_value(&engine).unwrap();
    let restored: Engine = serde_json::from_value(checkpoint).unwrap();
    assert_eq!(restored.uniforms[6], engine.uniforms[6]);
}

#[test]
fn failed_list_rolls_back_program_registers_and_outputs() {
    let mut engine = Engine::default();
    let before = serde_json::to_value(&engine).unwrap();
    let mut words = setup();
    pair(&mut words, 0xdead, 1);
    assert!(
        engine
            .execute(&words, &mut |_, _| panic!("no draw DMA"))
            .is_err()
    );
    assert_eq!(serde_json::to_value(&engine).unwrap(), before);
}
#[test]
fn packet_padding_is_opaque_and_truncation_refuses() {
    let mut engine = Engine::default();
    let mut words = vec![];
    upload(&mut words, 0x49c, &[0x84000000, 0x88000000], false);
    assert!(engine.execute(&words, &mut |_, _| panic!()).is_ok());
    words.pop();
    assert!(engine.execute(&words, &mut |_, _| panic!()).is_err());
}

#[test]
fn host_gpu_and_cpu_produce_identical_pixels_and_preserve_constant_alpha() {
    let mut words = setup();
    for position in [
        [-0.83, -0.71, -0.5, 1.],
        [0.72, -0.65, -0.5, 1.],
        [-0.13, 0.91, -0.5, 1.],
    ] {
        upload(&mut words, 0x433, &packed(position), true);
        upload(&mut words, 0x433, &packed([1., 0.25, 0.5, 1.]), true);
    }
    let mut cpu = Engine {
        cpu_only: true,
        ..Default::default()
    };
    let expected = cpu.execute(&words, &mut |_, n| Ok(vec![0; n])).unwrap();
    let actual = Engine::default()
        .execute(&words, &mut |_, n| Ok(vec![0; n]))
        .unwrap();
    assert_eq!(actual, expected);
    assert!(
        actual[0]
            .1
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[0] == 0 || p[0] == 255)
    );
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("Raster backend: {:?}", super::gpu::backend_name());
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn host_coverage_matches_integer_reference_at_shared_edges_and_subpixels() {
    for seed in 1..24i64 {
        let q = [
            [seed, seed * 3],
            [16 * 32 - seed, seed + 2],
            [seed * 5, 16 * 32 - seed * 2],
        ];
        let edges = [(q[1], q[2]), (q[2], q[0]), (q[0], q[1])];
        let inclusive = edges.map(|(a, b)| b[1] > a[1] || (b[1] == a[1] && b[0] < a[0]));
        if let Some(mask) = super::gpu::coverage(q, [0, 0, 32, 32], inclusive).unwrap() {
            for y in 0..32 {
                for x in 0..32 {
                    let p = [x as i64 * 16 + 8, y as i64 * 16 + 8];
                    let inside = edges.iter().enumerate().all(|(i, (a, b))| {
                        let v = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
                        v > 0 || v == 0 && inclusive[i]
                    });
                    assert_eq!(mask[y * 32 + x], u32::from(inside));
                }
            }
        }
    }
}

#[test]
fn linked_streams_execute_and_cycles_refuse_without_dma_output() {
    let mut words = vec![];
    pair(&mut words, 0x438, 1);
    pair(&mut words, 0x43a, 0x400);
    pair(&mut words, 0x43c, 1);
    let mut engine = Engine::default();
    let end = [0x12345678u32, 0xf0210];
    assert!(
        engine
            .execute(&words, &mut |a, n| {
                assert_eq!((a, n), (0x2000, 8));
                Ok(end.iter().flat_map(|w| w.to_le_bytes()).collect())
            })
            .unwrap()
            .is_empty()
    );
    // A length-24 link that points to itself never acquires a framebuffer.
    words[0] = 3;
    let raw: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    assert!(engine.execute(&words, &mut |_, _| Ok(raw.clone())).is_err());
}

#[test]
fn checkpoint_between_vertices_retains_uploaded_program_and_primitive_assembly() {
    let positions = [
        [-0.75, -0.75, 0., 1.],
        [0.75, -0.75, 0., 1.],
        [0., 0.75, 0., 1.],
    ];
    let mut first = setup();
    for position in &positions[..2] {
        upload(&mut first, 0x433, &packed(*position), true);
        upload(&mut first, 0x433, &packed([1., 0., 0., 1.]), true);
    }
    let mut engine = Engine::default();
    assert!(
        engine
            .execute(&first, &mut |_, _| panic!(
                "incomplete triangle must not fetch a target"
            ))
            .unwrap()
            .is_empty()
    );
    let mut restored: Engine =
        serde_json::from_value(serde_json::to_value(&engine).unwrap()).unwrap();
    let mut last = vec![];
    upload(&mut last, 0x433, &packed(positions[2]), true);
    upload(&mut last, 0x433, &packed([1., 0., 0., 1.]), true);
    let expected = engine.execute(&last, &mut |_, n| Ok(vec![0; n])).unwrap();
    assert_eq!(
        restored.execute(&last, &mut |_, n| Ok(vec![0; n])).unwrap(),
        expected
    );
}

#[test]
fn flat_shading_uses_the_provoking_vertex_color() {
    let mut words = setup();
    pair(&mut words, 0x258, 1);
    for (position, color) in [
        ([-0.75, -0.75, 0., 1.], [1., 0., 0., 1.]),
        ([0.75, -0.75, 0., 1.], [0., 1., 0., 1.]),
        ([0., 0.75, 0., 1.], [0., 0., 1., 1.]),
    ] {
        upload(&mut words, 0x433, &packed(position), true);
        upload(&mut words, 0x433, &packed(color), true);
    }
    let writes = Engine::default()
        .execute(&words, &mut |_, n| Ok(vec![0; n]))
        .unwrap();
    assert_eq!(
        writes[0]
            .1
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| **p == [255, 255, 0, 0])
            .count(),
        288
    );
}

#[test]
fn completion_ranges_preserve_concurrent_pixels_and_masked_channels() {
    for mask in [15, 1] {
        for acceleration in [false, true] {
            let mut words = setup();
            pair(&mut words, 0x307, mask << 8);
            for position in [
                [-0.75, -0.75, 0., 1.],
                [0.75, -0.75, 0., 1.],
                [0., 0.75, 0., 1.],
            ] {
                upload(&mut words, 0x433, &packed(position), true);
                upload(&mut words, 0x433, &packed([0.; 4]), true);
            }
            let mut engine = Engine::default();
            engine.set_host_acceleration(acceleration);
            let snapshots = engine.execute(&words, &mut |_, n| Ok(vec![0; n])).unwrap();
            assert_eq!(snapshots.len(), 1);
            assert!(snapshots[0].1.iter().all(|&byte| byte == 0));
            let ranges = engine.written_ranges();
            assert_eq!(
                ranges.iter().map(|(_, n)| n).sum::<usize>(),
                288 * if mask == 15 { 4 } else { 1 }
            );
            // Another producer changes memory after submission and before the
            // completion commits. Equal-valued GPU stores still take effect;
            // untouched pixels and disabled channels retain the later write.
            let mut memory = vec![0x5a; 32 * 32 * 4];
            let mut written = vec![false; memory.len()];
            for &(address, length) in ranges {
                let offset = (address - 0x10000) as usize;
                memory[offset..offset + length]
                    .copy_from_slice(&snapshots[0].1[offset..offset + length]);
                written[offset..offset + length].fill(true);
                if mask == 1 {
                    assert_eq!((length, offset % 4), (1, 3));
                }
            }
            assert!(
                memory
                    .iter()
                    .zip(&written)
                    .all(|(&byte, &written)| byte == if written { 0 } else { 0x5a })
            );
            assert_eq!(&memory[memory.len() - 4..], &[0x5a; 4]);
        }
    }
}
