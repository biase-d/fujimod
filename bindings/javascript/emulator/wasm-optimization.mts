import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Options {
  emsdk?: string;
  profiling: boolean;
  simd128: boolean;
}

/** Optimize the final linked module while preserving its JavaScript interface. */
export function optimizeWasm(path: string, options: Options) {
  if (!options.emsdk) throw Error('EMSDK must identify the pinned Emscripten SDK.');
  const tool = join(
    options.emsdk,
    'upstream',
    'bin',
    process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt',
  );
  const flags = [
    '-Oz',
    '--enable-threads',
    '--enable-bulk-memory',
    '--enable-mutable-globals',
    '--enable-reference-types',
    '--enable-exception-handling',
    '--enable-multivalue',
    '--enable-sign-ext',
    '--enable-nontrapping-float-to-int',
    // Typed function references let Binaryen refine the indirect-call graph.
    '--enable-gc',
    ...(options.simd128 ? ['--enable-simd'] : []),
    ...(options.profiling ? ['-g'] : []),
  ];
  const run = (args: string[]) => {
    const result = spawnSync(tool, args, { encoding: 'utf8', maxBuffer: 16 << 20 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(result.stderr || `wasm-opt exited ${result.status}.`);
    return result.stdout.trim();
  };
  const before = readFileSync(path);
  const original = new WebAssembly.Module(before);
  const directory = mkdtempSync(join(dirname(path), '.wasm-opt-'));
  try {
    const output = join(directory, 'camera.wasm');
    run([path, ...flags, '-o', output]);
    const after = readFileSync(output);
    const optimized = new WebAssembly.Module(after);
    const api = (module: WebAssembly.Module) =>
      JSON.stringify({
        imports: WebAssembly.Module.imports(module)
          .map((item) => JSON.stringify(item))
          .sort(),
        exports: WebAssembly.Module.exports(module)
          .map((item) => JSON.stringify(item))
          .sort(),
      });
    if (api(original) !== api(optimized)) throw Error('Wasm optimization changed its interface.');
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const receipt = {
      tool: run(['--version']),
      flags,
      input_bytes: before.length,
      output_bytes: after.length,
      input_sha256: hash(before),
      output_sha256: hash(after),
    };
    renameSync(output, path);
    return receipt;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
