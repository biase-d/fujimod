# DMP SMAPH rendering

The renderer consumes MMIO descriptors, addressed command lists and DMA arrays.
The `gles::Engine` implements the 3D data-before-header packet grammar and is
shared by the processor-specific bus adapters. VG path/fill command banks retain
their separate grammar.

3D lists upload vector instruction memory, operand descriptors, boolean/integer
controls and float uniforms. The vector interpreter executes transforms,
lighting and point setup from those instructions, including relative uniform
addressing, comparisons, calls, conditionals and bounded loops. Attributes come
from packed immediate vectors or DMA groups with explicit formats, strides,
padding slots and index buffers.

The raster pipeline supports triangles, strips, fans, lines and points; homogeneous
clipping; perspective interpolation; tiled color and depth/stencil targets;
two 2D texture units and combiners; nearest, bilinear and mip filtering; fog;
alpha/depth/stencil tests; color masks; and blending. Native pixmap transfers
accept byte pitches and preserve row padding. Unknown registers, instructions,
formats and unsupported configurations return errors. A rejected list publishes
no target writes or updated program state.

Native builds use wgpu for integer scan conversion when a hardware adapter is
available and the primitive fits its integer bounds. Small primitives and wider
coordinates use the CPU path. Both execute the same edge equations and top-left
rule; interpolation, vector execution and fragment arithmetic share a CPU
implementation. Transcendentals use `libm`. Setting `FUJIMOD_DMP_CPU=1` selects
CPU scan conversion; WebAssembly uses the CPU path. Host GPU handles stay outside
emulated state and checkpoints. Diagnostic state reports the selected adapter.

Instruction fields follow the vector arithmetic/flow layout described by
[nihstro's shader bytecode definitions](https://github.com/neobrain/nihstro/blob/a969b1a6849b02679a1858847ba18bedd3a19d44/include/nihstro/shader_bytecode.h).
Arithmetic intermediates use IEEE float32, primary color conversion truncates; combiners use integer eight-bit components,
ADD_SIGNED subtracts 128, and each scaled stage saturates separately. Blended
RGBA8 output rounds to the nearest byte,
and triangle coverage uses four fractional coordinate bits. Smooth lines use
an eight-step distance filter with asymmetric endpoint clipping; points remain
squares. The line filter is an empirical model of the sampled widths and angles. The interpreter
bounds instruction execution, call/loop nesting, uploads and addressed buffers.

Run the library regressions with:

```sh
cargo test --release --lib -p fujimod-emulator-ip-dmp
```

They cover program uploads, exact triangle coverage, CPU/GPU pixel parity,
shared edges and subpixels, checkpoint continuation between vertices, refusal
rollback, linked-list cycles, masked fills and pitched native copies.
